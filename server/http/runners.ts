import { createRoute, type OpenAPIHono, z } from '@hono/zod-openapi'
import { RUNNER_AUTH_MODES } from '@server/domain/runner-queue'
import type { Context } from 'hono'
import { isRunnerOidcAuth, requireAuth } from '../auth/session'
import type { Env } from '../env'
import { errorResponse } from '../errors'
import {
  AuthenticatedOperation,
  type DepsEnv,
  ErrorResponseSchema,
  formatListCursor,
  listQuerySchema,
  listResponseSchema,
  NullableSecretRefSchema,
  parseListCursor,
  SecretRefSchema,
} from '../openapi'
import { type RunnerAuthRecord, RunnerConflictError, RunnerValidationError } from '../usecases/ports'
import { recordRunnerHeartbeat, registerRunner, updateRunner } from '../usecases/runners'
import { requestId } from './request-context'
import { runnerForbidden, runnerOidcContext, runnerOperationAuthorized, runnerRuntimeAuthorized } from './runner-auth'

type RunnerRoutes = OpenAPIHono<DepsEnv>

const RUNNER_STATES = ['active', 'draining', 'disabled', 'offline'] as const

const JsonObjectSchema = z.record(z.string(), z.unknown())

const RuntimeUsageWindowSchema = z
  .object({
    label: z.string().openapi({ example: '5-Hour' }),
    utilization: z.number().openapi({ example: 23 }),
    resetsAt: z.string().openapi({ example: '2026-06-09T08:30:00.000Z' }),
  })
  .openapi('RuntimeUsageWindow')

const RuntimeUsageSchema = z
  .object({
    runtime: z.string().openapi({ example: 'claude-code' }),
    windows: z.array(RuntimeUsageWindowSchema),
  })
  .openapi('RuntimeUsage')

const RUNTIME_STATES = ['ready', 'missing', 'unauthenticated', 'unauthorized', 'limited', 'unhealthy'] as const

const RunnerRuntimeSchema = z
  .object({
    runtime: z.string().min(1).max(60).openapi({ example: 'codex' }),
    models: z
      .array(z.string().min(1).max(200))
      .max(100)
      .openapi({ example: ['gpt-5.3-codex'] }),
    version: z.string().max(120).optional().openapi({ example: '0.42.0' }),
    state: z.enum(RUNTIME_STATES).openapi({ example: 'ready' }),
    detail: z.string().max(400).optional().openapi({ example: 'host CLI enumerated 2 models' }),
  })
  .strict()
  .openapi('RunnerRuntime')

const RunnerSchema = z
  .object({
    id: z.string().openapi({ example: 'runner_abc123' }),
    projectId: z.string().openapi({ example: 'project_abc123' }),
    name: z.string().openapi({ example: 'mac-mini-build-runner' }),
    environmentId: z.string().nullable().openapi({ example: 'env_abc123' }),
    secretRef: NullableSecretRefSchema,
    authMode: z.enum(RUNNER_AUTH_MODES).openapi({ example: 'realmroot' }),
    state: z.enum(RUNNER_STATES).openapi({ example: 'active' }),
    currentLoad: z.number().int().openapi({ example: 0 }),
    maxConcurrent: z.number().int().openapi({ example: 2 }),
    runtimeUsage: z.array(RuntimeUsageSchema).openapi({ example: [] }),
    runtimes: z.array(RunnerRuntimeSchema).openapi({ example: [] }),
    metadata: JsonObjectSchema.openapi({ example: { pool: 'default' } }),
    lastHeartbeatAt: z.string().datetime().nullable(),
    archivedAt: z.string().datetime().nullable(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .openapi('Runner')

// Singleton liveness sub-resource: the runner's current heartbeat state.
const RunnerHeartbeatSchema = z
  .object({
    runnerId: z.string().openapi({ example: 'runner_abc123' }),
    state: z.enum(RUNNER_STATES).openapi({ example: 'active' }),
    currentLoad: z.number().int().openapi({ example: 1 }),
    runtimeUsage: z.array(RuntimeUsageSchema).openapi({ example: [] }),
    runtimes: z.array(RunnerRuntimeSchema).openapi({ example: [] }),
    lastHeartbeatAt: z.string().datetime().nullable(),
  })
  .openapi('RunnerHeartbeat')

const CreateRunnerSchema = z
  .object({
    name: z.string().min(1).max(120).openapi({ example: 'mac-mini-build-runner' }),
    environmentId: z.string().min(1).optional().openapi({ example: 'env_abc123' }),
    secretRef: SecretRefSchema.optional(),
    authMode: z.enum(RUNNER_AUTH_MODES).optional().openapi({ example: 'realmroot' }),
    maxConcurrent: z.number().int().min(1).max(100).optional().openapi({ example: 2 }),
    metadata: JsonObjectSchema.optional().openapi({ example: { pool: 'default' } }),
  })
  .strict()
  .openapi('CreateRunnerRequest')

const UpdateRunnerSchema = z
  .object({
    name: z.string().min(1).max(120).optional(),
    state: z.enum(['active', 'draining', 'disabled']).optional(),
    maxConcurrent: z.number().int().min(1).max(100).optional(),
    metadata: JsonObjectSchema.optional(),
    archived: z.boolean().optional(),
  })
  .strict()
  .openapi('UpdateRunnerRequest')

const PutHeartbeatSchema = z
  .object({
    state: z.enum(['active', 'draining', 'offline']).optional().openapi({ example: 'active' }),
    runtimeUsage: z.array(RuntimeUsageSchema).max(20).optional(),
    runtimes: z.array(RunnerRuntimeSchema).max(20).optional(),
    metadata: JsonObjectSchema.optional().openapi({ example: { hostname: 'runner-1' } }),
  })
  .strict()
  .openapi('PutRunnerHeartbeatRequest')

const ParamsSchema = z.object({
  runnerId: z.string().openapi({ param: { name: 'runnerId', in: 'path' }, example: 'runner_abc123' }),
})

const RunnerListQuerySchema = listQuerySchema().extend({
  state: z
    .enum(RUNNER_STATES)
    .optional()
    .openapi({ param: { name: 'state', in: 'query' }, example: 'active' }),
  environmentId: z
    .string()
    .optional()
    .openapi({ param: { name: 'environmentId', in: 'query' }, example: 'env_abc123' }),
})

const RunnerListResponseSchema = listResponseSchema('RunnerListResponse', RunnerSchema)

type RunnerRuntimeDto = z.infer<typeof RunnerRuntimeSchema>

// Drops absent optional keys so the strict port RunnerRuntime shape is
// satisfied under exactOptionalPropertyTypes.
function normalizeRuntimes(runtimes: RunnerRuntimeDto[]) {
  return runtimes.map((entry) => ({
    runtime: entry.runtime,
    models: entry.models,
    state: entry.state,
    ...(entry.version !== undefined ? { version: entry.version } : {}),
    ...(entry.detail !== undefined ? { detail: entry.detail } : {}),
  }))
}

// Stored runtime declarations carry free-form state strings; the wire schema
// pins them to the inventory-state enum.
function serializeRuntimes(runtimes: RunnerAuthRecord['runtimes']): RunnerRuntimeDto[] {
  return runtimes.map((entry) => ({
    runtime: entry.runtime,
    models: entry.models,
    ...(entry.version !== undefined ? { version: entry.version } : {}),
    state: entry.state as RunnerRuntimeDto['state'],
    ...(entry.detail !== undefined ? { detail: entry.detail } : {}),
  }))
}

// The wire DTO drops tenancy + OIDC binding columns the auth record carries.
function serializeRunner(runner: RunnerAuthRecord) {
  return {
    id: runner.id,
    projectId: runner.projectId,
    name: runner.name,
    environmentId: runner.environmentId,
    secretRef: runner.secretRef,
    authMode: runner.authMode,
    state: runner.state as (typeof RUNNER_STATES)[number],
    currentLoad: runner.currentLoad,
    maxConcurrent: runner.maxConcurrent,
    runtimeUsage: runner.runtimeUsage,
    runtimes: serializeRuntimes(runner.runtimes),
    metadata: runner.metadata,
    lastHeartbeatAt: runner.lastHeartbeatAt,
    archivedAt: runner.archivedAt,
    createdAt: runner.createdAt,
    updatedAt: runner.updatedAt,
  }
}

function serializeHeartbeat(runner: RunnerAuthRecord) {
  return {
    runnerId: runner.id,
    state: runner.state as (typeof RUNNER_STATES)[number],
    currentLoad: runner.currentLoad,
    runtimeUsage: runner.runtimeUsage,
    runtimes: serializeRuntimes(runner.runtimes),
    lastHeartbeatAt: runner.lastHeartbeatAt,
  }
}

const createRunnerRoute = createRoute({
  method: 'post',
  path: '/',
  operationId: 'createRunner',
  tags: ['Runners'],
  summary: 'Register a self-hosted runner',
  ...AuthenticatedOperation,
  request: { body: { required: true, content: { 'application/json': { schema: CreateRunnerSchema } } } },
  responses: {
    201: { description: 'Created runner', content: { 'application/json': { schema: RunnerSchema } } },
    400: { description: 'Validation error', content: { 'application/json': { schema: ErrorResponseSchema } } },
    401: { description: 'Authentication required', content: { 'application/json': { schema: ErrorResponseSchema } } },
    403: {
      description: 'Runner device token required',
      content: { 'application/json': { schema: ErrorResponseSchema } },
    },
    409: { description: 'Conflict', content: { 'application/json': { schema: ErrorResponseSchema } } },
  },
})

const listRunnersRoute = createRoute({
  method: 'get',
  path: '/',
  operationId: 'listRunners',
  tags: ['Runners'],
  summary: 'List self-hosted runners',
  ...AuthenticatedOperation,
  request: { query: RunnerListQuerySchema },
  responses: {
    200: { description: 'Runner list', content: { 'application/json': { schema: RunnerListResponseSchema } } },
    400: { description: 'Validation error', content: { 'application/json': { schema: ErrorResponseSchema } } },
    401: { description: 'Authentication required', content: { 'application/json': { schema: ErrorResponseSchema } } },
    403: { description: 'Forbidden', content: { 'application/json': { schema: ErrorResponseSchema } } },
  },
})

const readRunnerRoute = createRoute({
  method: 'get',
  path: '/{runnerId}',
  operationId: 'readRunner',
  tags: ['Runners'],
  summary: 'Read a self-hosted runner',
  ...AuthenticatedOperation,
  request: { params: ParamsSchema },
  responses: {
    200: { description: 'Runner', content: { 'application/json': { schema: RunnerSchema } } },
    401: { description: 'Authentication required', content: { 'application/json': { schema: ErrorResponseSchema } } },
    403: { description: 'Forbidden', content: { 'application/json': { schema: ErrorResponseSchema } } },
    404: { description: 'Runner not found', content: { 'application/json': { schema: ErrorResponseSchema } } },
  },
})

const updateRunnerRoute = createRoute({
  method: 'patch',
  path: '/{runnerId}',
  operationId: 'updateRunner',
  tags: ['Runners'],
  summary: 'Update or archive a self-hosted runner',
  ...AuthenticatedOperation,
  request: {
    params: ParamsSchema,
    body: { required: true, content: { 'application/json': { schema: UpdateRunnerSchema } } },
  },
  responses: {
    200: { description: 'Updated runner', content: { 'application/json': { schema: RunnerSchema } } },
    400: { description: 'Validation error', content: { 'application/json': { schema: ErrorResponseSchema } } },
    401: { description: 'Authentication required', content: { 'application/json': { schema: ErrorResponseSchema } } },
    403: { description: 'Forbidden', content: { 'application/json': { schema: ErrorResponseSchema } } },
    404: { description: 'Runner not found', content: { 'application/json': { schema: ErrorResponseSchema } } },
    409: { description: 'Conflict', content: { 'application/json': { schema: ErrorResponseSchema } } },
  },
})

const readHeartbeatRoute = createRoute({
  method: 'get',
  path: '/{runnerId}/heartbeat',
  operationId: 'readRunnerHeartbeat',
  tags: ['Runners'],
  summary: 'Read the current runner heartbeat state',
  ...AuthenticatedOperation,
  request: { params: ParamsSchema },
  responses: {
    200: { description: 'Runner heartbeat', content: { 'application/json': { schema: RunnerHeartbeatSchema } } },
    401: { description: 'Authentication required', content: { 'application/json': { schema: ErrorResponseSchema } } },
    403: { description: 'Forbidden', content: { 'application/json': { schema: ErrorResponseSchema } } },
    404: { description: 'Runner not found', content: { 'application/json': { schema: ErrorResponseSchema } } },
  },
})

const putHeartbeatRoute = createRoute({
  method: 'put',
  path: '/{runnerId}/heartbeat',
  operationId: 'putRunnerHeartbeat',
  tags: ['Runners'],
  summary: 'Replace the current runner heartbeat state',
  ...AuthenticatedOperation,
  request: {
    params: ParamsSchema,
    body: { required: true, content: { 'application/json': { schema: PutHeartbeatSchema } } },
  },
  responses: {
    200: { description: 'Runner heartbeat', content: { 'application/json': { schema: RunnerHeartbeatSchema } } },
    400: { description: 'Validation error', content: { 'application/json': { schema: ErrorResponseSchema } } },
    401: { description: 'Authentication required', content: { 'application/json': { schema: ErrorResponseSchema } } },
    403: { description: 'Forbidden', content: { 'application/json': { schema: ErrorResponseSchema } } },
    404: { description: 'Runner not found', content: { 'application/json': { schema: ErrorResponseSchema } } },
    409: { description: 'Conflict', content: { 'application/json': { schema: ErrorResponseSchema } } },
  },
})

const RunnerChannelMetadataSchema = z
  .object({
    upgrade: z.literal('websocket').openapi({ example: 'websocket' }),
  })
  .openapi('RunnerChannelMetadata')

const connectRunnerChannelRoute = createRoute({
  method: 'get',
  path: '/{runnerId}/channel',
  operationId: 'connectRunnerChannel',
  tags: ['Runners'],
  summary: 'Open the runner relay WebSocket channel',
  ...AuthenticatedOperation,
  request: { params: ParamsSchema },
  responses: {
    101: { description: 'Runner relay channel accepted as a WebSocket upgrade' },
    200: {
      description: 'Runner relay channel metadata for OpenAPI clients',
      content: { 'application/json': { schema: RunnerChannelMetadataSchema } },
    },
    401: { description: 'Authentication required', content: { 'application/json': { schema: ErrorResponseSchema } } },
    403: { description: 'Forbidden', content: { 'application/json': { schema: ErrorResponseSchema } } },
    404: { description: 'Runner not found', content: { 'application/json': { schema: ErrorResponseSchema } } },
    426: {
      description: 'WebSocket upgrade required',
      content: { 'application/json': { schema: ErrorResponseSchema } },
    },
  },
})

// The runner relay channel owns the WebSocket upgrade: authorise the runner, then
// forward the upgrade to the per-runner Session DO (idFromName(runnerId)). One
// channel per runner multiplexes every CLI session it hosts — the sessionId rides
// per-frame — so the channel outlives any single lease and a completed session
// still reads while the runner is online. Non-upgrade callers get the metadata.
async function connectRunnerChannel(c: Context<DepsEnv>) {
  if (c.req.header('upgrade')?.toLowerCase() !== 'websocket') {
    return errorResponse(c, 426, 'conflict', 'Runner relay channel requires a WebSocket upgrade')
  }
  const runnerId = c.req.param('runnerId')
  if (!runnerId) {
    return errorResponse(c, 400, 'validation_error', 'Runner id is required')
  }
  const deps = c.get('deps')
  const auth = await requireAuth(c)
  if (auth instanceof Response) {
    return auth
  }
  const runner = await deps.runners.find(auth.project.id, runnerId)
  if (!runner) {
    return errorResponse(c, 404, 'not_found', 'Runner not found')
  }
  if (!runnerRuntimeAuthorized(c.env, auth, runner)) {
    return runnerForbidden(c)
  }
  if (!runner.environmentId) {
    return errorResponse(c, 409, 'conflict', 'Runner must be bound to an environment before opening a channel')
  }
  return upgradeRunnerRelayChannel(
    c.env,
    c.req.raw,
    runnerId,
    auth.organization.id,
    auth.project.id,
    runner.environmentId,
    runner.metadata.commandAcknowledgement === true,
  )
}

function upgradeRunnerRelayChannel(
  env: Env,
  request: Request,
  runnerId: string,
  organizationId: string,
  projectId: string,
  environmentId: string,
  commandAcknowledgement: boolean,
) {
  const stub = env.RUNNER_POOL.get(env.RUNNER_POOL.idFromName(environmentId))
  const url = new URL('https://runner-pool/runner-connect')
  url.searchParams.set('runnerId', runnerId)
  url.searchParams.set('organizationId', organizationId)
  url.searchParams.set('projectId', projectId)
  url.searchParams.set('environmentId', environmentId)
  url.searchParams.set('commandAcknowledgement', commandAcknowledgement ? 'true' : 'false')
  return stub.fetch(new Request(url, request))
}

function validationOr(c: Parameters<Parameters<RunnerRoutes['openapi']>[1]>[0], error: unknown) {
  if (error instanceof RunnerValidationError) {
    return c.json(
      {
        error: {
          type: 'validation_error',
          message: error.message,
          ...(error.fields ? { details: { fields: error.fields } } : {}),
        },
      },
      400,
    )
  }
  if (error instanceof RunnerConflictError) {
    return c.json({ error: { type: 'conflict', message: error.message } }, 409)
  }
  throw error
}

// Registration order is load-bearing: requireAuth is the per-route auth wall and
// static segments register before parameter segments. The assembler in app.ts
// calls this at the runners resource's original mount position.
export function registerRunnerRoutes(routes: RunnerRoutes) {
  return routes
    .openapi(createRunnerRoute, async (c) => {
      const body = c.req.valid('json')
      const deps = c.get('deps')
      const auth = await requireAuth(c)
      if (auth instanceof Response) {
        return auth
      }
      if (!isRunnerOidcAuth(c.env, auth)) {
        return runnerForbidden(c)
      }
      try {
        const { runner, reregistered } = await registerRunner(deps, auth, runnerOidcContext(c.env, auth), {
          name: body.name,
          ...(body.environmentId ? { environmentId: body.environmentId } : { environmentId: undefined }),
          ...(body.secretRef ? { secretRef: body.secretRef } : { secretRef: undefined }),
          ...(body.authMode ? { authMode: body.authMode } : { authMode: undefined }),
          maxConcurrent: body.maxConcurrent ?? 1,
          metadata: body.metadata ?? {},
        })
        await deps.audit.record(auth, {
          action: reregistered ? 'runner.update' : 'runner.create',
          resourceType: 'runner',
          resourceId: runner.id,
          outcome: 'success',
          requestId: requestId(c),
          metadata: { environmentId: runner.environmentId },
        })
        return c.json(serializeRunner(runner), 201)
      } catch (error) {
        return validationOr(c, error)
      }
    })
    .openapi(listRunnersRoute, async (c) => {
      const deps = c.get('deps')
      const auth = await requireAuth(c)
      if (auth instanceof Response) {
        return auth
      }
      const {
        archived,
        state,
        search,
        createdFrom,
        createdTo,
        limit = 50,
        cursor,
        environmentId,
      } = c.req.valid('query')
      const runnerToken = isRunnerOidcAuth(c.env, auth)
      if (runnerToken && !auth.oidc.runnerId && !auth.oidc.clientId) {
        return errorResponse(c, 403, 'forbidden', 'Runner token is not authorized for this resource')
      }
      let parsedCursor: ReturnType<typeof parseListCursor> | null = null
      try {
        parsedCursor = cursor ? parseListCursor(cursor) : null
      } catch {
        return errorResponse(c, 400, 'validation_error', 'Invalid list cursor', {
          fields: { cursor: 'Cursor is invalid.' },
        })
      }
      const page = await deps.runners.list({
        projectId: auth.project.id,
        archived: archived === 'true',
        ...(state ? { state } : {}),
        ...(environmentId ? { environmentId } : {}),
        ...(search ? { search } : {}),
        ...(createdFrom ? { createdFrom } : {}),
        ...(createdTo ? { createdTo } : {}),
        // Runner tokens only see their own runner(s).
        ...(runnerToken && auth.oidc.runnerId ? { runnerId: auth.oidc.runnerId } : {}),
        ...(runnerToken && !auth.oidc.runnerId ? { oidcSubject: auth.oidc.subject } : {}),
        ...(runnerToken && !auth.oidc.runnerId && auth.oidc.clientId ? { oidcClientId: auth.oidc.clientId } : {}),
        limit,
        cursor: parsedCursor,
      })
      const last = page.rows.at(-1)
      const nextCursor = page.hasMore && last ? formatListCursor({ createdAt: last.createdAt, id: last.id }) : null
      return c.json(
        { data: page.rows.map(serializeRunner), pagination: { limit, nextCursor, hasMore: page.hasMore } },
        200,
      )
    })
    .openapi(readRunnerRoute, async (c) => {
      const { runnerId } = c.req.valid('param')
      const deps = c.get('deps')
      const auth = await requireAuth(c)
      if (auth instanceof Response) {
        return auth
      }
      const runner = await deps.runners.find(auth.project.id, runnerId)
      if (!runner) {
        return errorResponse(c, 404, 'not_found', 'Runner not found')
      }
      if (!runnerOperationAuthorized(c.env, auth, runner)) {
        return runnerForbidden(c)
      }
      return c.json(serializeRunner(runner), 200)
    })
    .openapi(updateRunnerRoute, async (c) => {
      const { runnerId } = c.req.valid('param')
      const body = c.req.valid('json')
      const deps = c.get('deps')
      const auth = await requireAuth(c)
      if (auth instanceof Response) {
        return auth
      }
      const runner = await deps.runners.find(auth.project.id, runnerId)
      if (!runner) {
        return errorResponse(c, 404, 'not_found', 'Runner not found')
      }
      if (!runnerOperationAuthorized(c.env, auth, runner)) {
        return runnerForbidden(c)
      }
      try {
        const result = await updateRunner(deps, auth.project.id, runner, {
          ...(body.name !== undefined ? { name: body.name } : {}),
          ...(body.state !== undefined ? { state: body.state } : {}),
          ...(body.maxConcurrent !== undefined ? { maxConcurrent: body.maxConcurrent } : {}),
          ...(body.metadata !== undefined ? { metadata: body.metadata } : {}),
          ...(body.archived !== undefined ? { archived: body.archived } : {}),
        })
        return c.json(serializeRunner(result), 200)
      } catch (error) {
        return validationOr(c, error)
      }
    })
    .openapi(readHeartbeatRoute, async (c) => {
      const { runnerId } = c.req.valid('param')
      const deps = c.get('deps')
      const auth = await requireAuth(c)
      if (auth instanceof Response) {
        return auth
      }
      const runner = await deps.runners.find(auth.project.id, runnerId)
      if (!runner) {
        return errorResponse(c, 404, 'not_found', 'Runner not found')
      }
      if (!runnerOperationAuthorized(c.env, auth, runner)) {
        return runnerForbidden(c)
      }
      return c.json(serializeHeartbeat(runner), 200)
    })
    .openapi(putHeartbeatRoute, async (c) => {
      const { runnerId } = c.req.valid('param')
      const body = c.req.valid('json')
      const deps = c.get('deps')
      const auth = await requireAuth(c)
      if (auth instanceof Response) {
        return auth
      }
      const runner = await deps.runners.find(auth.project.id, runnerId)
      if (!runner) {
        return errorResponse(c, 404, 'not_found', 'Runner not found')
      }
      if (!runnerRuntimeAuthorized(c.env, auth, runner)) {
        return runnerForbidden(c)
      }
      try {
        const updated = await recordRunnerHeartbeat(deps, auth.project.id, runner, {
          ...(body.state !== undefined ? { state: body.state } : {}),
          ...(body.runtimeUsage !== undefined ? { runtimeUsage: body.runtimeUsage } : {}),
          ...(body.runtimes !== undefined ? { runtimes: normalizeRuntimes(body.runtimes) } : {}),
          ...(body.metadata !== undefined ? { metadata: body.metadata } : {}),
        })
        return c.json(serializeHeartbeat(updated), 200)
      } catch (error) {
        return validationOr(c, error)
      }
    })
    .openapi(connectRunnerChannelRoute, connectRunnerChannel)
}
