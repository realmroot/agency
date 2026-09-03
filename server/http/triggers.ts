import { createRoute, type OpenAPIHono, z } from '@hono/zod-openapi'
import {
  ResourceCreateMetadataSchema,
  ResourceMetadataSchema,
  ResourcePhaseSchema,
  ResourceUpdateMetadataSchema,
  serializeResource,
} from '@server/contracts/resource-contracts'
import { requireAuth } from '../auth/session'
import { type EnvFromEntrySchema, ExecutionSpecInputSchema, ExecutionSpecSchema } from '../contracts/execution-spec'
import type { TriggerRun } from '../domain/trigger'
import {
  AuthenticatedOperation,
  type DepsEnv,
  ErrorResponseSchema,
  formatListCursor,
  listQuerySchema,
  listResponseSchema,
  parseListCursor,
} from '../openapi'
import { dispatchHttpTrigger } from '../usecases/dispatch-triggers'
import {
  type EnvFromEntry,
  TriggerConflictError,
  TriggerProvisioningError,
  TriggerValidationError,
} from '../usecases/ports'
import { createTrigger, deleteTrigger, type UpdateTriggerPatch, updateTrigger } from '../usecases/triggers'
import { requestId } from './request-context'

type TriggerRoutes = OpenAPIHono<DepsEnv>

const RUN_STATES = ['claimed', 'queued', 'dispatching', 'dispatched', 'failed'] as const
const JsonObjectSchema = z.record(z.string(), z.unknown())
const TriggerCreateMetadataSchema = ResourceCreateMetadataSchema.pick({ name: true }).openapi('TriggerCreateMetadata')
const TriggerUpdateMetadataSchema = ResourceUpdateMetadataSchema.pick({ name: true }).openapi('TriggerUpdateMetadata')

const TriggerScheduleSchema = z
  .object({
    type: z.literal('interval'),
    intervalSeconds: z.number().int().openapi({ example: 86400 }),
    windowSeconds: z.number().int().openapi({ example: 0 }),
  })
  .openapi('TriggerSchedule')

const HttpTriggerConcurrencySchema = z
  .object({ mode: z.enum(['parallel', 'serial']) })
  .strict()
  .openapi('HttpTriggerConcurrency')

const TriggerSourceSchema = z
  .discriminatedUnion('type', [
    z.object({
      type: z.literal('schedule'),
      schedule: TriggerScheduleSchema,
    }),
    z.object({
      type: z.literal('http'),
      concurrency: HttpTriggerConcurrencySchema.optional(),
    }),
    z.object({ type: z.literal('inbox') }),
  ])
  .openapi('TriggerSource')

const TriggerTemplateMetadataSchema = z
  .object({
    labels: z.record(z.string(), z.string()).openapi({ example: { app: 'automation-service' } }),
    annotations: z.record(z.string(), z.string()).openapi({ example: { owner: 'growth' } }),
  })
  .openapi('TriggerTemplateMetadata')

const TriggerTemplateSpecSchema = ExecutionSpecSchema.extend({
  promptTemplate: z.string().openapi({ example: 'Research current Canadian banking bonus offers.' }),
})
  .strict()
  .openapi('TriggerTemplateSpec')

const TriggerTemplateSchema = z
  .object({
    metadata: TriggerTemplateMetadataSchema,
    spec: TriggerTemplateSpecSchema,
  })
  .openapi('TriggerTemplate')

const TriggerSpecSchema = z
  .object({
    source: TriggerSourceSchema,
    suspend: z.boolean().openapi({ example: false }),
    template: TriggerTemplateSchema,
  })
  .openapi('TriggerSpec')

const TriggerStatusSchema = z
  .object({
    phase: ResourcePhaseSchema,
    nextDueAt: z.string().datetime().nullable().openapi({ example: '2026-05-26T12:00:00.000Z' }),
    lastDispatchedAt: z.string().datetime().nullable().openapi({ example: null }),
    lastRunId: z.string().nullable().openapi({ example: '0195f5d6-7c20-7000-8000-00000000000d' }),
    subscription: z
      .object({
        id: z.string(),
        phase: z.enum(['pending', 'active', 'inactive', 'error']),
        errorMessage: z.string().nullable(),
      })
      .nullable(),
  })
  .openapi('TriggerStatus')

const TriggerSchema = z
  .object({
    metadata: ResourceMetadataSchema,
    spec: TriggerSpecSchema,
    status: TriggerStatusSchema,
  })
  .openapi('Trigger')

const TriggerRunSchema = z
  .object({
    metadata: ResourceMetadataSchema,
    spec: z
      .object({
        triggerId: z.string().openapi({ example: '0195f5d6-7c20-7000-8000-00000000000c' }),
        scheduledFor: z.string().datetime().nullable().openapi({ example: '2026-05-26T12:00:00.000Z' }),
        metadata: JsonObjectSchema.openapi({ example: { source: 'trigger' } }),
      })
      .openapi('TriggerRunSpec'),
    status: z
      .object({
        phase: z.enum(RUN_STATES).openapi({ example: 'dispatched' }),
        idempotencyKey: z
          .string()
          .openapi({ example: '0195f5d6-7c20-7000-8000-00000000000c:2026-05-26T12:00:00.000Z' }),
        correlationId: z
          .string()
          .openapi({ example: 'schedule:0195f5d6-7c20-7000-8000-00000000000c:2026-05-26T12:00:00.000Z' }),
        heartbeatAt: z.string().datetime().nullable().openapi({ example: '2026-05-26T12:01:00.000Z' }),
        triggeredAt: z.string().datetime().openapi({ example: '2026-05-26T12:01:00.000Z' }),
        sessionId: z.string().nullable().openapi({ example: '0195f5d6-7c20-7000-8000-00000000000e' }),
        errorMessage: z.string().nullable().openapi({ example: null }),
      })
      .openapi('TriggerRunStatus'),
  })
  .openapi('TriggerRun')

const SchedulePayloadSchema = z
  .object({
    type: z.literal('interval').optional().openapi({ example: 'interval' }),
    intervalSeconds: z.number().int().min(60).max(31_536_000).openapi({ example: 86400 }),
    windowSeconds: z.number().int().min(0).max(86_400).optional().openapi({ example: 0 }),
  })
  .strict()

const CreateTriggerTemplateMetadataSchema = TriggerTemplateMetadataSchema.partial().optional()
const CreateTriggerTemplateSpecSchema = ExecutionSpecInputSchema.extend({
  promptTemplate: z.string().trim().min(1).max(16000).openapi({
    example: 'Research current Canadian banking bonus offers.',
  }),
}).strict()

const CreateTriggerTemplateSchema = z
  .object({
    metadata: CreateTriggerTemplateMetadataSchema,
    spec: CreateTriggerTemplateSpecSchema,
  })
  .strict()

const CreateTriggerSchema = z
  .object({
    metadata: TriggerCreateMetadataSchema.openapi({ example: { name: 'Daily research heartbeat' } }),
    spec: z
      .object({
        source: z.discriminatedUnion('type', [
          z.object({ type: z.literal('schedule'), schedule: SchedulePayloadSchema }),
          z.object({ type: z.literal('http'), concurrency: HttpTriggerConcurrencySchema.optional() }),
          z.object({ type: z.literal('inbox') }),
        ]),
        suspend: z.boolean().optional().openapi({ example: false }),
        template: CreateTriggerTemplateSchema,
        nextDueAt: z.string().datetime().optional().openapi({ example: '2026-05-26T12:00:00.000Z' }),
      })
      .strict(),
  })
  .strict()
  .openapi('CreateTriggerRequest')

const UpdateTriggerTemplateSchema = z
  .object({
    metadata: TriggerTemplateMetadataSchema.partial().optional(),
    spec: CreateTriggerTemplateSpecSchema.partial().optional(),
  })
  .strict()

const UpdateTriggerSchema = z
  .object({
    metadata: TriggerUpdateMetadataSchema.optional(),
    spec: z
      .object({
        source: z
          .discriminatedUnion('type', [
            z.object({ type: z.literal('schedule'), schedule: SchedulePayloadSchema }),
            z.object({ type: z.literal('http'), concurrency: HttpTriggerConcurrencySchema.optional() }),
            z.object({ type: z.literal('inbox') }),
          ])
          .optional(),
        suspend: z.boolean().optional().openapi({ example: true }),
        template: UpdateTriggerTemplateSchema.optional(),
        nextDueAt: z.string().datetime().optional().openapi({ example: '2026-05-26T13:00:00.000Z' }),
      })
      .strict()
      .optional(),
    archived: z.boolean().optional().openapi({ example: true }),
  })
  .strict()
  .refine((body) => body.metadata !== undefined || body.spec !== undefined || body.archived !== undefined, {
    message: 'Provide metadata, spec, or archived.',
  })
  .openapi('UpdateTriggerRequest')

const TriggerParamsSchema = z.object({
  triggerId: z
    .string()
    .openapi({ param: { name: 'triggerId', in: 'path' }, example: '0195f5d6-7c20-7000-8000-00000000000c' }),
})

const RunParamsSchema = TriggerParamsSchema.extend({
  runId: z.string().openapi({ param: { name: 'runId', in: 'path' }, example: '0195f5d6-7c20-7000-8000-00000000000d' }),
})

const suspendQuery = z
  .enum(['true', 'false'])
  .optional()
  .openapi({
    param: { name: 'suspend', in: 'query' },
    description: 'Filter by the operational toggle.',
    example: 'false',
  })

const runStateQuery = z
  .enum(RUN_STATES)
  .optional()
  .openapi({
    param: { name: 'state', in: 'query' },
    example: 'dispatched',
  })

const ListQuerySchema = listQuerySchema().extend({ suspend: suspendQuery })
const RunsQuerySchema = listQuerySchema().omit({ archived: true }).extend({ state: runStateQuery })
const TriggerListResponseSchema = listResponseSchema('TriggerListResponse', TriggerSchema)
const TriggerRunListResponseSchema = listResponseSchema('TriggerRunListResponse', TriggerRunSchema)
const CreateHttpTriggerRunRequestSchema = JsonObjectSchema.openapi('CreateHttpTriggerRunRequest', {
  example: { customer: { name: 'Ada' }, ticketId: 'T-123' },
})

function errorBody(type: string, message: string, details?: Record<string, unknown>) {
  return { error: { type, message, ...(details ? { details } : {}) } } as const
}

function normalizeEnvFrom(entries: z.infer<typeof EnvFromEntrySchema>[]): EnvFromEntry[] {
  return entries.map((entry) => ({
    type: 'secret',
    secretRef: entry.secretRef,
    ...(entry.name !== undefined ? { name: entry.name } : {}),
    ...(entry.key ? { key: entry.key } : {}),
  }))
}

const TEMPLATE_HEADER_DENYLIST = new Set(['authorization', 'cookie', 'set-cookie', 'proxy-authorization'])

function promptHeaders(headers: Headers): Record<string, string> {
  const safe: Record<string, string> = {}
  headers.forEach((value, key) => {
    const normalized = key.toLowerCase()
    if (!TEMPLATE_HEADER_DENYLIST.has(normalized)) {
      safe[normalized] = value
    }
  })
  return safe
}

const createRouteDefinition = createRoute({
  method: 'post',
  path: '/',
  operationId: 'createTrigger',
  tags: ['Triggers'],
  summary: 'Create a trigger',
  ...AuthenticatedOperation,
  request: { body: { required: true, content: { 'application/json': { schema: CreateTriggerSchema } } } },
  responses: {
    201: { description: 'Created trigger', content: { 'application/json': { schema: TriggerSchema } } },
    400: { description: 'Validation error', content: { 'application/json': { schema: ErrorResponseSchema } } },
    401: { description: 'Authentication required', content: { 'application/json': { schema: ErrorResponseSchema } } },
    404: { description: 'Agent not found', content: { 'application/json': { schema: ErrorResponseSchema } } },
    409: { description: 'Conflict', content: { 'application/json': { schema: ErrorResponseSchema } } },
    502: {
      description: 'Inbox Subscription failure',
      content: { 'application/json': { schema: ErrorResponseSchema } },
    },
  },
})

const listRouteDefinition = createRoute({
  method: 'get',
  path: '/',
  operationId: 'listTriggers',
  tags: ['Triggers'],
  summary: 'List triggers',
  ...AuthenticatedOperation,
  request: { query: ListQuerySchema },
  responses: {
    200: { description: 'Triggers', content: { 'application/json': { schema: TriggerListResponseSchema } } },
    400: { description: 'Validation error', content: { 'application/json': { schema: ErrorResponseSchema } } },
    401: { description: 'Authentication required', content: { 'application/json': { schema: ErrorResponseSchema } } },
  },
})

const readRouteDefinition = createRoute({
  method: 'get',
  path: '/{triggerId}',
  operationId: 'readTrigger',
  tags: ['Triggers'],
  summary: 'Read a trigger',
  ...AuthenticatedOperation,
  request: { params: TriggerParamsSchema },
  responses: {
    200: { description: 'Trigger', content: { 'application/json': { schema: TriggerSchema } } },
    401: { description: 'Authentication required', content: { 'application/json': { schema: ErrorResponseSchema } } },
    404: { description: 'Trigger not found', content: { 'application/json': { schema: ErrorResponseSchema } } },
  },
})

const updateRouteDefinition = createRoute({
  method: 'patch',
  path: '/{triggerId}',
  operationId: 'updateTrigger',
  tags: ['Triggers'],
  summary: 'Update, pause, or archive a trigger',
  description:
    'Partial update. Pause with `suspend: true`; resume with `suspend: false`; archive with `archived: true`; restore with `archived: false`.',
  ...AuthenticatedOperation,
  request: {
    params: TriggerParamsSchema,
    body: { required: true, content: { 'application/json': { schema: UpdateTriggerSchema } } },
  },
  responses: {
    200: { description: 'Updated trigger', content: { 'application/json': { schema: TriggerSchema } } },
    400: { description: 'Validation error', content: { 'application/json': { schema: ErrorResponseSchema } } },
    401: { description: 'Authentication required', content: { 'application/json': { schema: ErrorResponseSchema } } },
    404: { description: 'Trigger not found', content: { 'application/json': { schema: ErrorResponseSchema } } },
    409: { description: 'Conflict', content: { 'application/json': { schema: ErrorResponseSchema } } },
    502: {
      description: 'Inbox Subscription failure',
      content: { 'application/json': { schema: ErrorResponseSchema } },
    },
  },
})

const deleteRouteDefinition = createRoute({
  method: 'delete',
  path: '/{triggerId}',
  operationId: 'deleteTrigger',
  tags: ['Triggers'],
  summary: 'Delete a trigger',
  description: 'Permanently deletes the trigger and its run history.',
  ...AuthenticatedOperation,
  request: { params: TriggerParamsSchema },
  responses: {
    204: { description: 'Trigger deleted' },
    401: { description: 'Authentication required', content: { 'application/json': { schema: ErrorResponseSchema } } },
    404: { description: 'Trigger not found', content: { 'application/json': { schema: ErrorResponseSchema } } },
    502: {
      description: 'Inbox Subscription failure',
      content: { 'application/json': { schema: ErrorResponseSchema } },
    },
  },
})

const listRunsRouteDefinition = createRoute({
  method: 'get',
  path: '/{triggerId}/runs',
  operationId: 'listTriggerRuns',
  tags: ['Triggers'],
  summary: 'List trigger runs',
  ...AuthenticatedOperation,
  request: { params: TriggerParamsSchema, query: RunsQuerySchema },
  responses: {
    200: { description: 'Trigger runs', content: { 'application/json': { schema: TriggerRunListResponseSchema } } },
    400: { description: 'Validation error', content: { 'application/json': { schema: ErrorResponseSchema } } },
    401: { description: 'Authentication required', content: { 'application/json': { schema: ErrorResponseSchema } } },
    404: { description: 'Trigger not found', content: { 'application/json': { schema: ErrorResponseSchema } } },
  },
})

const createRunRouteDefinition = createRoute({
  method: 'post',
  path: '/{triggerId}/runs',
  operationId: 'createTriggerRun',
  tags: ['Triggers'],
  summary: 'Create an HTTP trigger run',
  description:
    'Creates a run for an HTTP trigger using the JSON body, query string, and allowed request headers as prompt template variables.',
  ...AuthenticatedOperation,
  request: {
    params: TriggerParamsSchema,
    body: { required: true, content: { 'application/json': { schema: CreateHttpTriggerRunRequestSchema } } },
  },
  responses: {
    201: { description: 'Created trigger run', content: { 'application/json': { schema: TriggerRunSchema } } },
    400: { description: 'Validation error', content: { 'application/json': { schema: ErrorResponseSchema } } },
    401: { description: 'Authentication required', content: { 'application/json': { schema: ErrorResponseSchema } } },
    404: { description: 'Trigger not found', content: { 'application/json': { schema: ErrorResponseSchema } } },
    409: { description: 'Conflict', content: { 'application/json': { schema: ErrorResponseSchema } } },
  },
})

const readRunRouteDefinition = createRoute({
  method: 'get',
  path: '/{triggerId}/runs/{runId}',
  operationId: 'readTriggerRun',
  tags: ['Triggers'],
  summary: 'Read a trigger run',
  ...AuthenticatedOperation,
  request: { params: RunParamsSchema },
  responses: {
    200: { description: 'Trigger run', content: { 'application/json': { schema: TriggerRunSchema } } },
    401: { description: 'Authentication required', content: { 'application/json': { schema: ErrorResponseSchema } } },
    404: { description: 'Trigger run not found', content: { 'application/json': { schema: ErrorResponseSchema } } },
  },
})

// Registration order is load-bearing: requireAuth is the per-route auth wall and
// static segments register before parameter segments. The assembler in app.ts
// calls this at the triggers resource's original mount position.
export function registerTriggerRoutes(routes: TriggerRoutes) {
  return routes
    .openapi(createRouteDefinition, async (c) => {
      const body = c.req.valid('json')
      const deps = c.get('deps')
      const auth = await requireAuth(c)
      if (auth instanceof Response) {
        return auth
      }
      const scope = auth
      try {
        const spec = body.spec
        const trigger = await createTrigger(deps, scope, {
          config: {
            name: body.metadata.name,
            source:
              spec.source.type === 'schedule'
                ? {
                    type: 'schedule',
                    schedule: {
                      type: 'interval',
                      intervalSeconds: spec.source.schedule.intervalSeconds,
                      windowSeconds: spec.source.schedule.windowSeconds ?? 0,
                    },
                  }
                : spec.source.type === 'http'
                  ? { type: 'http', concurrency: spec.source.concurrency ?? { mode: 'parallel' } }
                  : { type: 'inbox' },
            suspend: spec.suspend ?? false,
            template: {
              metadata: {
                labels: spec.template.metadata?.labels ?? {},
                annotations: spec.template.metadata?.annotations ?? {},
              },
              spec: {
                agentId: spec.template.spec.agentId,
                environmentId: spec.template.spec.environmentId ?? null,
                ...(spec.template.spec.runtime !== undefined ? { runtime: spec.template.spec.runtime } : {}),
                promptTemplate: spec.template.spec.promptTemplate,
                env: spec.template.spec.env ?? {},
                envFrom: normalizeEnvFrom(spec.template.spec.envFrom ?? []),
                volumes: spec.template.spec.volumes ?? [],
                volumeMounts: spec.template.spec.volumeMounts ?? [],
              },
            },
            nextDueAt: spec.nextDueAt ?? null,
          },
        })
        await deps.audit.record(scope, {
          action: 'trigger.create',
          resourceType: 'trigger',
          resourceId: trigger.metadata.uid,
          outcome: 'success',
          requestId: requestId(c),
          after: trigger,
        })
        return c.json(serializeResource(trigger), 201)
      } catch (error) {
        return triggerMutationError(c, error)
      }
    })
    .openapi(listRouteDefinition, async (c) => {
      const deps = c.get('deps')
      const auth = await requireAuth(c)
      if (auth instanceof Response) {
        return auth
      }
      const { archived, suspend, search, createdFrom, createdTo, limit = 50, cursor } = c.req.valid('query')
      let parsedCursor: { createdAt: string; id: string } | null = null
      try {
        parsedCursor = cursor ? parseListCursor(cursor) : null
      } catch {
        return c.json(
          errorBody('validation_error', 'Invalid list cursor', { fields: { cursor: 'Cursor is invalid.' } }),
          400,
        )
      }
      const page = await deps.triggers.list({
        projectId: auth.project.id,
        archived: archived === 'true',
        ...(suspend !== undefined ? { enabled: suspend !== 'true' } : {}),
        ...(search ? { search } : {}),
        ...(createdFrom ? { createdFrom } : {}),
        ...(createdTo ? { createdTo } : {}),
        limit,
        cursor: parsedCursor,
      })
      const last = page.rows.at(-1)
      const nextCursor =
        page.hasMore && last ? formatListCursor({ createdAt: last.metadata.createdAt, id: last.metadata.uid }) : null
      return c.json(
        { data: page.rows.map(serializeResource), pagination: { limit, nextCursor, hasMore: page.hasMore } },
        200,
      )
    })
    .openapi(readRouteDefinition, async (c) => {
      const deps = c.get('deps')
      const auth = await requireAuth(c)
      if (auth instanceof Response) {
        return auth
      }
      const trigger = await deps.triggers.find(auth.project.id, c.req.valid('param').triggerId)
      if (!trigger) {
        return c.json(errorBody('not_found', 'Trigger not found'), 404)
      }
      return c.json(serializeResource(trigger), 200)
    })
    .openapi(updateRouteDefinition, async (c) => {
      const deps = c.get('deps')
      const auth = await requireAuth(c)
      if (auth instanceof Response) {
        return auth
      }
      const { triggerId } = c.req.valid('param')
      const body = c.req.valid('json')
      const trigger = await deps.triggers.find(auth.project.id, triggerId)
      if (!trigger) {
        return c.json(errorBody('not_found', 'Trigger not found'), 404)
      }
      const scope = auth
      try {
        const result = await updateTrigger(deps, scope, trigger, patchFromBody(body))
        await deps.audit.record(scope, {
          action: result.archived ? 'trigger.archive' : 'trigger.update',
          resourceType: 'trigger',
          resourceId: trigger.metadata.uid,
          outcome: 'success',
          requestId: requestId(c),
          before: trigger,
          after: result.trigger,
        })
        return c.json(serializeResource(result.trigger), 200)
      } catch (error) {
        return triggerMutationError(c, error)
      }
    })
    .openapi(deleteRouteDefinition, async (c) => {
      const deps = c.get('deps')
      const auth = await requireAuth(c)
      if (auth instanceof Response) {
        return auth
      }
      const { triggerId } = c.req.valid('param')
      const trigger = await deps.triggers.find(auth.project.id, triggerId)
      if (!trigger) {
        return c.json(errorBody('not_found', 'Trigger not found'), 404)
      }
      const scope = auth
      try {
        await deleteTrigger(deps, scope, triggerId)
      } catch (error) {
        return triggerMutationError(c, error)
      }
      await deps.audit.record(scope, {
        action: 'trigger.delete',
        resourceType: 'trigger',
        resourceId: trigger.metadata.uid,
        outcome: 'success',
        requestId: requestId(c),
        before: trigger,
      })
      return c.body(null, 204)
    })
    .openapi(listRunsRouteDefinition, async (c) => {
      const deps = c.get('deps')
      const auth = await requireAuth(c)
      if (auth instanceof Response) {
        return auth
      }
      const { triggerId } = c.req.valid('param')
      const trigger = await deps.triggers.find(auth.project.id, triggerId)
      if (!trigger) {
        return c.json(errorBody('not_found', 'Trigger not found'), 404)
      }
      const { state, search, createdFrom, createdTo, limit = 50, cursor } = c.req.valid('query')
      let parsedCursor: { createdAt: string; id: string } | null = null
      try {
        parsedCursor = cursor ? parseListCursor(cursor) : null
      } catch {
        return c.json(
          errorBody('validation_error', 'Invalid list cursor', { fields: { cursor: 'Cursor is invalid.' } }),
          400,
        )
      }
      const page = await deps.triggers.listRuns({
        projectId: auth.project.id,
        triggerId,
        ...(state ? { state } : {}),
        ...(search ? { search } : {}),
        ...(createdFrom ? { createdFrom } : {}),
        ...(createdTo ? { createdTo } : {}),
        limit,
        cursor: parsedCursor,
      })
      const last = page.rows.at(-1)
      const nextCursor =
        page.hasMore && last ? formatListCursor({ createdAt: last.metadata.createdAt, id: last.metadata.uid }) : null
      return c.json(
        { data: page.rows.map(serializeTriggerRun), pagination: { limit, nextCursor, hasMore: page.hasMore } },
        200,
      )
    })
    .openapi(createRunRouteDefinition, async (c) => {
      const deps = c.get('deps')
      const auth = await requireAuth(c)
      if (auth instanceof Response) {
        return auth
      }
      const { triggerId } = c.req.valid('param')
      const trigger = await deps.triggers.find(auth.project.id, triggerId)
      if (!trigger) {
        return c.json(errorBody('not_found', 'Trigger not found'), 404)
      }
      try {
        const result = await dispatchHttpTrigger(deps, auth, {
          trigger,
          context: {
            body: c.req.valid('json'),
            header: promptHeaders(c.req.raw.headers),
          },
          idempotencyKey: c.req.header('idempotency-key') ?? null,
        })
        const run = await deps.triggers.findRun(auth.project.id, triggerId, result.runId)
        if (!run) {
          throw new Error('HTTP trigger run was not persisted')
        }
        if (result.replayed) c.header('idempotency-replayed', 'true')
        return c.json(serializeTriggerRun(run), 201)
      } catch (error) {
        return conflictOrValidation(c, error)
      }
    })
    .openapi(readRunRouteDefinition, async (c) => {
      const deps = c.get('deps')
      const auth = await requireAuth(c)
      if (auth instanceof Response) {
        return auth
      }
      const { triggerId, runId } = c.req.valid('param')
      const trigger = await deps.triggers.find(auth.project.id, triggerId)
      if (!trigger) {
        return c.json(errorBody('not_found', 'Trigger not found'), 404)
      }
      const run = await deps.triggers.findRun(auth.project.id, triggerId, runId)
      if (!run) {
        return c.json(errorBody('not_found', 'Trigger run not found'), 404)
      }
      return c.json(serializeTriggerRun(run), 200)
    })
}

// --- helpers ---

function patchFromBody(body: z.infer<typeof UpdateTriggerSchema>): UpdateTriggerPatch {
  const spec = body.spec
  const templateMetadata =
    spec?.template?.metadata === undefined
      ? undefined
      : {
          ...(spec.template.metadata.labels !== undefined ? { labels: spec.template.metadata.labels } : {}),
          ...(spec.template.metadata.annotations !== undefined
            ? { annotations: spec.template.metadata.annotations }
            : {}),
        }
  const templateSpec =
    spec?.template?.spec === undefined
      ? undefined
      : {
          ...(spec.template.spec.agentId !== undefined ? { agentId: spec.template.spec.agentId } : {}),
          ...(spec.template.spec.environmentId !== undefined
            ? { environmentId: spec.template.spec.environmentId ?? null }
            : {}),
          ...(spec.template.spec.runtime !== undefined ? { runtime: spec.template.spec.runtime } : {}),
          ...(spec.template.spec.promptTemplate !== undefined
            ? { promptTemplate: spec.template.spec.promptTemplate }
            : {}),
          ...(spec.template.spec.env !== undefined ? { env: spec.template.spec.env } : {}),
          ...(spec.template.spec.envFrom !== undefined
            ? { envFrom: normalizeEnvFrom(spec.template.spec.envFrom) }
            : {}),
          ...(spec.template.spec.volumes !== undefined ? { volumes: spec.template.spec.volumes } : {}),
          ...(spec.template.spec.volumeMounts !== undefined ? { volumeMounts: spec.template.spec.volumeMounts } : {}),
        }
  return {
    ...(body.metadata?.name !== undefined ? { name: body.metadata.name } : {}),
    ...(spec?.source !== undefined
      ? {
          source:
            spec.source.type === 'schedule'
              ? {
                  type: 'schedule' as const,
                  schedule: {
                    intervalSeconds: spec.source.schedule.intervalSeconds,
                    windowSeconds: spec.source.schedule.windowSeconds ?? 0,
                  },
                }
              : spec.source.type === 'http'
                ? {
                    type: 'http' as const,
                    ...(spec.source.concurrency !== undefined ? { concurrency: spec.source.concurrency } : {}),
                  }
                : { type: 'inbox' as const },
        }
      : {}),
    ...(spec?.suspend !== undefined ? { suspend: spec.suspend } : {}),
    ...(spec?.nextDueAt !== undefined ? { nextDueAt: spec.nextDueAt } : {}),
    ...(spec?.template !== undefined
      ? {
          template: {
            ...(templateMetadata !== undefined ? { metadata: templateMetadata } : {}),
            ...(templateSpec !== undefined ? { spec: templateSpec } : {}),
          },
        }
      : {}),
    ...(body.archived !== undefined ? { archived: body.archived } : {}),
  }
}

function serializeTriggerRun(run: TriggerRun): z.infer<typeof TriggerRunSchema> {
  const resource = serializeResource(run)
  const { idempotencyKey, correlationId, ...spec } = run.spec
  return {
    ...resource,
    spec,
    status: {
      phase: run.status.phase,
      idempotencyKey,
      correlationId,
      heartbeatAt: run.status.heartbeatAt,
      triggeredAt: run.status.triggeredAt,
      sessionId: run.status.sessionId,
      errorMessage: run.status.errorMessage,
    },
  }
}

function conflictOrValidation(c: Parameters<Parameters<TriggerRoutes['openapi']>[1]>[0], error: unknown) {
  if (error instanceof TriggerValidationError) {
    return c.json(errorBody('validation_error', error.message, { fields: error.fields }), 400)
  }
  if (error instanceof TriggerConflictError) {
    return c.json(errorBody(error.code, error.message), error.status)
  }
  throw error
}

function triggerMutationError(c: Parameters<Parameters<TriggerRoutes['openapi']>[1]>[0], error: unknown) {
  if (error instanceof TriggerProvisioningError) {
    return c.json(errorBody(error.code, error.message), error.status)
  }
  return conflictOrValidation(c, error)
}
