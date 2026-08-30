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
import { safeRuntimeError } from '../runtime-error'
import { materializeWorkItemPayload } from '../usecases/leases'
import { RunnerConflictError, type WorkItemRecord } from '../usecases/ports'
import { runnerOperationAuthorized } from './runner-auth'

type WorkItemRoutes = OpenAPIHono<DepsEnv>

const WORK_ITEM_STATES = ['available', 'leased', 'succeeded', 'failed', 'cancelled'] as const

const JsonObjectSchema = z.record(z.string(), z.unknown())

const WorkItemSchema = z
  .object({
    id: z.string().openapi({ example: '0195f5d6-7c20-7000-8000-000000000012' }),
    projectId: z.string().openapi({ example: '0195f5d6-7c20-7000-8000-000000000001' }),
    sessionId: z.string().nullable().openapi({ example: '0195f5d6-7c20-7000-8000-00000000000e' }),
    environmentId: z.string().nullable().openapi({ example: '0195f5d6-7c20-7000-8000-000000000005' }),
    runnerId: z.string().nullable().openapi({ example: '0195f5d6-7c20-7000-8000-000000000011' }),
    leaseId: z.string().nullable().openapi({ example: '0195f5d6-7c20-7000-8000-000000000013' }),
    type: z.string().openapi({ example: 'session.start' }),
    state: z.enum(WORK_ITEM_STATES).openapi({ example: 'available' }),
    priority: z.number().int().openapi({ example: 0 }),
    attempts: z.number().int().openapi({ example: 1 }),
    maxAttempts: z.number().int().openapi({ example: 3 }),
    payload: JsonObjectSchema,
    result: JsonObjectSchema.nullable(),
    error: JsonObjectSchema.nullable(),
    availableAt: z.string().datetime(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .openapi('WorkItem')

const WorkItemParamsSchema = z.object({
  workItemId: z
    .string()
    .openapi({ param: { name: 'workItemId', in: 'path' }, example: '0195f5d6-7c20-7000-8000-000000000012' }),
})

const WorkItemListQuerySchema = z.object({
  state: z
    .enum(WORK_ITEM_STATES)
    .optional()
    .openapi({ param: { name: 'state', in: 'query' }, example: 'available' }),
  sessionId: z
    .string()
    .optional()
    .openapi({ param: { name: 'sessionId', in: 'query' }, example: '0195f5d6-7c20-7000-8000-00000000000e' }),
  runnerId: z
    .string()
    .optional()
    .openapi({ param: { name: 'runnerId', in: 'query' }, example: '0195f5d6-7c20-7000-8000-000000000011' }),
  search: z
    .string()
    .min(1)
    .max(120)
    .optional()
    .openapi({ param: { name: 'search', in: 'query' }, example: 'session.start' }),
  createdFrom: z
    .string()
    .datetime()
    .optional()
    .openapi({ param: { name: 'createdFrom', in: 'query' }, example: '2026-05-01T00:00:00.000Z' }),
  createdTo: z
    .string()
    .datetime()
    .optional()
    .openapi({ param: { name: 'createdTo', in: 'query' }, example: '2026-05-31T23:59:59.999Z' }),
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

const WorkItemListResponseSchema = listResponseSchema('WorkItemListResponse', WorkItemSchema)

function serializeWorkItem(record: WorkItemRecord) {
  return {
    id: record.id,
    projectId: record.projectId,
    sessionId: record.sessionId,
    environmentId: record.environmentId,
    runnerId: record.runnerId,
    leaseId: record.leaseId,
    type: record.type,
    state: record.state as (typeof WORK_ITEM_STATES)[number],
    priority: record.priority,
    attempts: record.attempts,
    maxAttempts: record.maxAttempts,
    payload: record.payload,
    result: record.result,
    error: record.error,
    availableAt: record.availableAt,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  }
}

const listWorkItemsRoute = createRoute({
  method: 'get',
  path: '/',
  operationId: 'listWorkItems',
  tags: ['Work items'],
  summary: 'List queued self-hosted work items',
  ...AuthenticatedOperation,
  request: { query: WorkItemListQuerySchema },
  responses: {
    200: { description: 'Work item list', content: { 'application/json': { schema: WorkItemListResponseSchema } } },
    400: { description: 'Validation error', content: { 'application/json': { schema: ErrorResponseSchema } } },
    401: { description: 'Authentication required', content: { 'application/json': { schema: ErrorResponseSchema } } },
  },
})

const readWorkItemRoute = createRoute({
  method: 'get',
  path: '/{workItemId}',
  operationId: 'readWorkItem',
  tags: ['Work items'],
  summary: 'Read a queued self-hosted work item',
  ...AuthenticatedOperation,
  request: { params: WorkItemParamsSchema },
  responses: {
    200: { description: 'Work item', content: { 'application/json': { schema: WorkItemSchema } } },
    401: { description: 'Authentication required', content: { 'application/json': { schema: ErrorResponseSchema } } },
    404: { description: 'Work item not found', content: { 'application/json': { schema: ErrorResponseSchema } } },
    409: { description: 'Conflict', content: { 'application/json': { schema: ErrorResponseSchema } } },
  },
})

// Registration order is load-bearing: requireAuth is the per-route auth wall and
// static segments register before parameter segments. The assembler in app.ts
// calls this at the work-items resource's original mount position.
export function registerWorkItemRoutes(routes: WorkItemRoutes) {
  return routes
    .openapi(listWorkItemsRoute, async (c) => {
      const deps = c.get('deps')
      const auth = await requireAuth(c)
      if (auth instanceof Response) {
        return auth
      }
      const { state, sessionId, runnerId, search, createdFrom, createdTo, limit = 50, cursor } = c.req.valid('query')
      let parsedCursor: ReturnType<typeof parseListCursor> | null = null
      try {
        parsedCursor = cursor ? parseListCursor(cursor) : null
      } catch {
        return errorResponse(c, 400, 'validation_error', 'Invalid list cursor', {
          fields: { cursor: 'Cursor is invalid.' },
        })
      }
      const page = await deps.workItems.list({
        projectId: auth.project.id,
        ...(state ? { state } : {}),
        ...(sessionId ? { sessionId } : {}),
        ...(runnerId ? { runnerId } : {}),
        ...(search ? { search } : {}),
        ...(createdFrom ? { createdFrom } : {}),
        ...(createdTo ? { createdTo } : {}),
        limit,
        cursor: parsedCursor,
      })
      const last = page.rows.at(-1)
      const nextCursor = page.hasMore && last ? formatListCursor({ createdAt: last.createdAt, id: last.id }) : null
      return c.json(
        { data: page.rows.map(serializeWorkItem), pagination: { limit, nextCursor, hasMore: page.hasMore } },
        200,
      )
    })
    .openapi(readWorkItemRoute, async (c) => {
      const { workItemId } = c.req.valid('param')
      const deps = c.get('deps')
      const auth = await requireAuth(c)
      if (auth instanceof Response) {
        return auth
      }
      const workItem = await deps.workItems.find(auth.project.id, workItemId)
      if (!workItem) {
        return errorResponse(c, 404, 'not_found', 'Work item not found')
      }
      // The runner that holds the active lease receives the raw payload with
      // envFrom references materialized into env and workspaceManifest.
      const leaseRunnerId =
        workItem.state === 'leased' ? await deps.workItems.activeLeaseRunnerId(auth.project.id, workItemId) : null
      if (leaseRunnerId && isRunnerOidcAuth(c.env, auth)) {
        const runner = await deps.runners.find(auth.project.id, leaseRunnerId)
        if (runner && runnerOperationAuthorized(c.env, auth, runner)) {
          try {
            const payload = await materializeWorkItemPayload(
              deps,
              { organizationId: auth.organization.id, projectId: auth.project.id },
              workItem,
            )
            return c.json({ ...serializeWorkItem(workItem), payload }, 200)
          } catch (error) {
            if (error instanceof RunnerConflictError) {
              return errorResponse(c, 409, 'conflict', error.message)
            }
            return errorResponse(c, 409, 'conflict', safeRuntimeError(error).message)
          }
        }
      }
      return c.json(serializeWorkItem(workItem), 200)
    })
}
