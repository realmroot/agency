import { createRoute, type OpenAPIHono, z } from '@hono/zod-openapi'
import { isRunnerOidcAuth, requireAuth } from '../auth/session'
import { errorResponse } from '../errors'
import {
  AuthenticatedOperation,
  type DepsEnv,
  ErrorResponseSchema,
  formatListCursor,
  listResponseSchema,
  parseListCursor,
} from '../openapi'
import { wakeSerialHttpTriggerForSettledSession } from '../usecases/dispatch-triggers'
import { claimLease } from '../usecases/leases'
import { type LeaseRecord, RunnerConflictError, RunnerValidationError } from '../usecases/ports'
import { dispatchPrompt } from '../usecases/runtime/cloud-turn'
import { runnerForbidden, runnerOperationAuthorized, runnerRuntimeAuthorized } from './runner-auth'

type LeaseRoutes = OpenAPIHono<DepsEnv>

const LEASE_STATES = ['active', 'completed', 'failed', 'cancelled', 'expired'] as const
const MAX_LEASE_DURATION_SECONDS = 900

const JsonObjectSchema = z.record(z.string(), z.unknown())

const LeaseSchema = z
  .object({
    id: z.string().openapi({ example: '0195f5d6-7c20-7000-8000-000000000013' }),
    workItemId: z.string().openapi({ example: '0195f5d6-7c20-7000-8000-000000000012' }),
    runnerId: z.string().openapi({ example: '0195f5d6-7c20-7000-8000-000000000011' }),
    state: z.enum(LEASE_STATES).openapi({ example: 'active' }),
    expiresAt: z.string().datetime(),
    renewedAt: z.string().datetime().nullable(),
    resumeToken: z.string().nullable().openapi({ example: 'runtime-session-uuid' }),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .openapi('Lease')

const CreateLeaseSchema = z
  .object({
    workItemId: z.string().min(1).openapi({ example: '0195f5d6-7c20-7000-8000-000000000012' }),
    runnerId: z.string().min(1).openapi({ example: '0195f5d6-7c20-7000-8000-000000000011' }),
    leaseDurationSeconds: z.number().int().min(15).max(MAX_LEASE_DURATION_SECONDS).optional().openapi({ example: 60 }),
  })
  .strict()
  .openapi('CreateLeaseRequest')

const UpdateLeaseSchema = z
  .object({
    state: z.enum(['active', 'completed', 'failed', 'cancelled', 'interrupted']).optional().openapi({
      description:
        'Lease transition. `interrupted` is an action, not a resting state: it requeues the work item for recovery and the lease settles as `expired` in the resource.',
    }),
    leaseDurationSeconds: z.number().int().min(15).max(MAX_LEASE_DURATION_SECONDS).optional().openapi({ example: 60 }),
    expiresAt: z.string().datetime().optional(),
    resumeToken: z.string().min(1).max(2048).optional().openapi({ example: 'runtime-session-uuid' }),
    result: JsonObjectSchema.optional().openapi({ example: { exitCode: 0 } }),
    error: JsonObjectSchema.optional().openapi({ example: { message: 'Command failed' } }),
  })
  .strict()
  .openapi('UpdateLeaseRequest')

const LeaseParamsSchema = z.object({
  leaseId: z
    .string()
    .openapi({ param: { name: 'leaseId', in: 'path' }, example: '0195f5d6-7c20-7000-8000-000000000013' }),
})

const LeaseListQuerySchema = z.object({
  runnerId: z
    .string()
    .optional()
    .openapi({ param: { name: 'runnerId', in: 'query' }, example: '0195f5d6-7c20-7000-8000-000000000011' }),
  state: z
    .enum(LEASE_STATES)
    .optional()
    .openapi({ param: { name: 'state', in: 'query' }, example: 'active' }),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(100)
    .optional()
    .openapi({ param: { name: 'limit', in: 'query' }, example: 50 }),
  cursor: z
    .string()
    .min(1)
    .max(512)
    .optional()
    .openapi({ param: { name: 'cursor', in: 'query' } }),
})

const LeaseListResponseSchema = listResponseSchema('LeaseListResponse', LeaseSchema)

function serializeLease(record: LeaseRecord) {
  return {
    id: record.id,
    workItemId: record.workItemId,
    runnerId: record.runnerId,
    state: record.state as (typeof LEASE_STATES)[number],
    expiresAt: record.expiresAt,
    renewedAt: record.renewedAt,
    resumeToken: record.resumeToken,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  }
}

const createLeaseRoute = createRoute({
  method: 'post',
  path: '/',
  operationId: 'createLease',
  tags: ['Leases'],
  summary: 'Claim a specific available work item for a runner',
  ...AuthenticatedOperation,
  request: { body: { required: true, content: { 'application/json': { schema: CreateLeaseSchema } } } },
  responses: {
    201: { description: 'Created lease', content: { 'application/json': { schema: LeaseSchema } } },
    400: { description: 'Validation error', content: { 'application/json': { schema: ErrorResponseSchema } } },
    401: { description: 'Authentication required', content: { 'application/json': { schema: ErrorResponseSchema } } },
    403: { description: 'Forbidden', content: { 'application/json': { schema: ErrorResponseSchema } } },
    404: {
      description: 'Work item or runner not found',
      content: { 'application/json': { schema: ErrorResponseSchema } },
    },
    409: {
      description: 'Work item is no longer available',
      content: { 'application/json': { schema: ErrorResponseSchema } },
    },
  },
})

const listLeasesRoute = createRoute({
  method: 'get',
  path: '/',
  operationId: 'listLeases',
  tags: ['Leases'],
  summary: 'List work leases',
  ...AuthenticatedOperation,
  request: { query: LeaseListQuerySchema },
  responses: {
    200: { description: 'Lease list', content: { 'application/json': { schema: LeaseListResponseSchema } } },
    400: { description: 'Validation error', content: { 'application/json': { schema: ErrorResponseSchema } } },
    401: { description: 'Authentication required', content: { 'application/json': { schema: ErrorResponseSchema } } },
    403: { description: 'Forbidden', content: { 'application/json': { schema: ErrorResponseSchema } } },
  },
})

const readLeaseRoute = createRoute({
  method: 'get',
  path: '/{leaseId}',
  operationId: 'readLease',
  tags: ['Leases'],
  summary: 'Read a work lease',
  ...AuthenticatedOperation,
  request: { params: LeaseParamsSchema },
  responses: {
    200: { description: 'Lease', content: { 'application/json': { schema: LeaseSchema } } },
    401: { description: 'Authentication required', content: { 'application/json': { schema: ErrorResponseSchema } } },
    403: { description: 'Forbidden', content: { 'application/json': { schema: ErrorResponseSchema } } },
    404: { description: 'Lease not found', content: { 'application/json': { schema: ErrorResponseSchema } } },
  },
})

const updateLeaseRoute = createRoute({
  method: 'patch',
  path: '/{leaseId}',
  operationId: 'updateLease',
  tags: ['Leases'],
  summary: 'Renew or finish a work lease',
  ...AuthenticatedOperation,
  request: {
    params: LeaseParamsSchema,
    body: { required: true, content: { 'application/json': { schema: UpdateLeaseSchema } } },
  },
  responses: {
    200: { description: 'Updated lease', content: { 'application/json': { schema: LeaseSchema } } },
    400: { description: 'Validation error', content: { 'application/json': { schema: ErrorResponseSchema } } },
    401: { description: 'Authentication required', content: { 'application/json': { schema: ErrorResponseSchema } } },
    403: { description: 'Forbidden', content: { 'application/json': { schema: ErrorResponseSchema } } },
    404: { description: 'Lease not found', content: { 'application/json': { schema: ErrorResponseSchema } } },
    409: { description: 'Conflict', content: { 'application/json': { schema: ErrorResponseSchema } } },
  },
})

// Registration order is load-bearing: requireAuth is the per-route auth wall and
// static segments register before parameter segments. The assembler in app.ts
// calls this at the leases resource's original mount position.
export function registerLeaseRoutes(routes: LeaseRoutes) {
  return routes
    .openapi(createLeaseRoute, async (c) => {
      const body = c.req.valid('json')
      const deps = c.get('deps')
      const auth = await requireAuth(c)
      if (auth instanceof Response) {
        return auth
      }
      await deps.leases.expireStale(auth.project.id)
      const runner = await deps.runners.find(auth.project.id, body.runnerId)
      if (!runner) {
        return errorResponse(c, 404, 'not_found', 'Runner not found')
      }
      if (!runnerRuntimeAuthorized(c.env, auth, runner)) {
        return runnerForbidden(c)
      }
      try {
        const lease = await claimLease(deps, auth, runner, {
          workItemId: body.workItemId,
          leaseDurationSeconds: body.leaseDurationSeconds,
        })
        return c.json(serializeLease(lease), 201)
      } catch (error) {
        if (error instanceof RunnerConflictError) {
          return errorResponse(c, error.status, error.status === 404 ? 'not_found' : 'conflict', error.message)
        }
        if (error instanceof RunnerValidationError) {
          return errorResponse(
            c,
            400,
            'validation_error',
            error.message,
            error.fields ? { fields: error.fields } : undefined,
          )
        }
        throw error
      }
    })
    .openapi(listLeasesRoute, async (c) => {
      const deps = c.get('deps')
      const auth = await requireAuth(c)
      if (auth instanceof Response) {
        return auth
      }
      const { runnerId, state, limit = 50, cursor } = c.req.valid('query')
      if (isRunnerOidcAuth(c.env, auth)) {
        if (!runnerId) {
          return errorResponse(c, 400, 'validation_error', 'Runner tokens must filter leases by runnerId')
        }
        const runner = await deps.runners.find(auth.project.id, runnerId)
        if (!runner || !runnerOperationAuthorized(c.env, auth, runner)) {
          return runnerForbidden(c)
        }
      }
      await deps.leases.expireStale(auth.project.id)
      let parsedCursor: ReturnType<typeof parseListCursor> | null = null
      try {
        parsedCursor = cursor ? parseListCursor(cursor) : null
      } catch {
        return errorResponse(c, 400, 'validation_error', 'Invalid list cursor', {
          fields: { cursor: 'Cursor is invalid.' },
        })
      }
      const page = await deps.leases.list({
        projectId: auth.project.id,
        ...(runnerId ? { runnerId } : {}),
        ...(state ? { state } : {}),
        limit,
        cursor: parsedCursor,
      })
      const last = page.rows.at(-1)
      const nextCursor = page.hasMore && last ? formatListCursor({ createdAt: last.createdAt, id: last.id }) : null
      return c.json(
        { data: page.rows.map(serializeLease), pagination: { limit, nextCursor, hasMore: page.hasMore } },
        200,
      )
    })
    .openapi(readLeaseRoute, async (c) => {
      const { leaseId } = c.req.valid('param')
      const deps = c.get('deps')
      const auth = await requireAuth(c)
      if (auth instanceof Response) {
        return auth
      }
      const lease = await deps.leases.find(auth.project.id, leaseId)
      if (!lease) {
        return errorResponse(c, 404, 'not_found', 'Lease not found')
      }
      if (isRunnerOidcAuth(c.env, auth)) {
        const runner = await deps.runners.find(auth.project.id, lease.runnerId)
        if (!runner || !runnerOperationAuthorized(c.env, auth, runner)) {
          return runnerForbidden(c)
        }
      }
      return c.json(serializeLease(lease), 200)
    })
    .openapi(updateLeaseRoute, async (c) => {
      const { leaseId } = c.req.valid('param')
      const body = c.req.valid('json')
      const deps = c.get('deps')
      const auth = await requireAuth(c)
      if (auth instanceof Response) {
        return auth
      }
      await deps.leases.expireStale(auth.project.id)
      const lease = await deps.leases.find(auth.project.id, leaseId)
      if (!lease) {
        return errorResponse(c, 404, 'not_found', 'Lease not found')
      }
      const runner = await deps.runners.find(auth.project.id, lease.runnerId)
      if (!runner) {
        return errorResponse(c, 404, 'not_found', 'Runner not found')
      }
      if (!runnerRuntimeAuthorized(c.env, auth, runner)) {
        return runnerForbidden(c)
      }
      const requestedState = body.state ?? 'active'
      if (requestedState === 'active' && body.expiresAt) {
        const ceiling = new Date(Date.now() + MAX_LEASE_DURATION_SECONDS * 1000).toISOString()
        if (body.expiresAt <= new Date().toISOString() || body.expiresAt > ceiling) {
          return errorResponse(
            c,
            400,
            'validation_error',
            'Lease expiry must be in the future and within the maximum lease duration',
            { fields: { expiresAt: 'Expiry must be in the future and within 900 seconds.' } },
          )
        }
      }
      const rawPayload = await deps.workItems.rawPayload(auth.project.id, lease.workItemId)
      let updated: LeaseRecord | null
      try {
        updated = await deps.leases.finish(
          {
            organizationId: auth.organization.id,
            projectId: auth.project.id,
            leaseId,
            state: requestedState,
            ...(body.expiresAt ? { expiresAt: body.expiresAt } : {}),
            ...(body.leaseDurationSeconds !== undefined ? { leaseDurationSeconds: body.leaseDurationSeconds } : {}),
            ...(body.resumeToken ? { resumeToken: body.resumeToken } : {}),
            ...(body.result ? { result: body.result } : {}),
            ...(body.error ? { error: body.error } : {}),
          },
          new Date().toISOString(),
        )
      } catch (error) {
        if (error instanceof RunnerConflictError) {
          return errorResponse(c, error.status, error.status === 404 ? 'not_found' : 'conflict', error.message)
        }
        throw error
      }
      if (!updated) {
        return errorResponse(c, 409, 'conflict', 'Lease is no longer active')
      }
      if (
        requestedState === 'completed' &&
        rawPayload?.type === 'session.start' &&
        rawPayload.runtime === 'enbor' &&
        typeof rawPayload.sessionId === 'string' &&
        typeof rawPayload.prompt === 'string' &&
        rawPayload.prompt
      ) {
        const session = await deps.sessionOrchestration.findSession(auth.project.id, rawPayload.sessionId)
        if (session?.state === 'idle') {
          await dispatchPrompt(deps, auth, session, rawPayload.prompt)
        }
      }
      if (requestedState !== 'active' && typeof rawPayload?.sessionId === 'string') {
        await wakeSerialHttpTriggerForSettledSession(deps, auth.project.id, rawPayload.sessionId)
      }
      return c.json(serializeLease(updated), 200)
    })
}
