import { createRoute, type OpenAPIHono, z } from '@hono/zod-openapi'
import { USAGE_PROVIDER_TYPES, USAGE_STATUSES, USAGE_TYPES } from '@server/domain/usage'
import { requireAuth } from '../auth/session'
import {
  AuthenticatedOperation,
  csvResponse,
  type DepsEnv,
  ErrorResponseSchema,
  listResponseSchema,
  negotiateMediaType,
  paginateRows,
  parseListCursor,
} from '../openapi'
import type { UsageRecord } from '../usecases/ports'

type UsageRoutes = OpenAPIHono<DepsEnv>

const JsonObjectSchema = z.record(z.string(), z.unknown())

const UsageRecordSchema = z
  .object({
    id: z.string(),
    projectId: z.string(),
    agentId: z.string().nullable(),
    agentVersionId: z.string().nullable(),
    sessionId: z.string().nullable(),
    sessionEventId: z.string().nullable(),
    correlationId: z.string().nullable(),
    providerId: z.string().nullable(),
    providerType: z.enum(USAGE_PROVIDER_TYPES),
    modelId: z.string(),
    state: z.enum(USAGE_STATUSES),
    promptTokens: z.number().int(),
    completionTokens: z.number().int(),
    totalTokens: z.number().int(),
    durationMs: z.number().int(),
    costMicros: z.number().int(),
    currency: z.string(),
    usageType: z.enum(USAGE_TYPES),
    metadata: JsonObjectSchema,
    createdAt: z.string().datetime(),
  })
  .openapi('UsageRecord')

const QuerySchema = z.object({
  from: z
    .string()
    .datetime()
    .optional()
    .openapi({ param: { name: 'from', in: 'query' }, example: '2026-05-01T00:00:00.000Z' }),
  to: z
    .string()
    .datetime()
    .optional()
    .openapi({ param: { name: 'to', in: 'query' }, example: '2026-05-31T23:59:59.999Z' }),
  providerId: z
    .string()
    .optional()
    .openapi({ param: { name: 'providerId', in: 'query' }, example: 'workers-ai' }),
  modelId: z
    .string()
    .optional()
    .openapi({ param: { name: 'modelId', in: 'query' }, example: '@cf/moonshotai/kimi-k2.6' }),
  agentId: z
    .string()
    .optional()
    .openapi({ param: { name: 'agentId', in: 'query' }, example: '0195f5d6-7c20-7000-8000-000000000002' }),
  sessionId: z
    .string()
    .optional()
    .openapi({ param: { name: 'sessionId', in: 'query' }, example: '0195f5d6-7c20-7000-8000-00000000000e' }),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(100)
    .optional()
    .openapi({ param: { name: 'limit', in: 'query' }, example: 50 }),
  cursor: z
    .string()
    .optional()
    .openapi({ param: { name: 'cursor', in: 'query' } }),
})

const UsageRecordListResponseSchema = listResponseSchema('UsageRecordListResponse', UsageRecordSchema)

const UsageRecordParamsSchema = z.object({
  recordId: z
    .string()
    .openapi({ param: { name: 'recordId', in: 'path' }, example: '0195f5d6-7c20-7000-8000-000000000016' }),
})

function serializeUsage(record: UsageRecord) {
  return {
    id: record.id,
    projectId: record.projectId,
    agentId: record.agentId,
    agentVersionId: record.agentVersionId,
    sessionId: record.sessionId,
    sessionEventId: record.sessionEventId,
    correlationId: record.correlationId,
    providerId: record.providerId,
    providerType: record.providerType,
    modelId: record.modelId,
    state: record.state,
    promptTokens: record.promptTokens,
    completionTokens: record.completionTokens,
    totalTokens: record.totalTokens,
    durationMs: record.durationMs,
    costMicros: record.costMicros,
    currency: record.currency,
    usageType: record.usageType,
    metadata: record.metadata,
    createdAt: record.createdAt,
  }
}

const CSV_HEADER = [
  'id',
  'createdAt',
  'projectId',
  'agentId',
  'agentVersionId',
  'sessionId',
  'providerId',
  'providerType',
  'modelId',
  'state',
  'usageType',
  'promptTokens',
  'completionTokens',
  'totalTokens',
  'durationMs',
  'costMicros',
  'currency',
]

function csvRow(record: UsageRecord) {
  return [
    record.id,
    record.createdAt,
    record.projectId,
    record.agentId ?? '',
    record.agentVersionId ?? '',
    record.sessionId ?? '',
    record.providerId ?? '',
    record.providerType,
    record.modelId,
    record.state,
    record.usageType,
    String(record.promptTokens),
    String(record.completionTokens),
    String(record.totalTokens),
    String(record.durationMs),
    String(record.costMicros),
    record.currency,
  ]
}

const listRoute = createRoute({
  method: 'get',
  path: '/',
  operationId: 'listUsageRecords',
  tags: ['Usage'],
  summary: 'List usage records',
  description: 'Lists usage records for the project. Send Accept: text/csv to export the filtered records as CSV.',
  ...AuthenticatedOperation,
  request: { query: QuerySchema },
  responses: {
    200: {
      description: 'Usage records',
      content: {
        'application/json': { schema: UsageRecordListResponseSchema },
        'text/csv': { schema: z.string().openapi({ example: 'id,createdAt,providerId,modelId,totalTokens' }) },
      },
    },
    400: { description: 'Validation error', content: { 'application/json': { schema: ErrorResponseSchema } } },
    401: { description: 'Authentication required', content: { 'application/json': { schema: ErrorResponseSchema } } },
  },
})

const readRoute = createRoute({
  method: 'get',
  path: '/{recordId}',
  operationId: 'readUsageRecord',
  tags: ['Usage'],
  summary: 'Read a usage record',
  ...AuthenticatedOperation,
  request: { params: UsageRecordParamsSchema },
  responses: {
    200: { description: 'Usage record', content: { 'application/json': { schema: UsageRecordSchema } } },
    401: { description: 'Authentication required', content: { 'application/json': { schema: ErrorResponseSchema } } },
    404: { description: 'Usage record not found', content: { 'application/json': { schema: ErrorResponseSchema } } },
  },
})

// Pure-forward reporting resource: list/read/CSV are repo queries plus
// serialization, so the route calls deps.usageRecords directly (no usecase).
// CSV negotiation and pagination stay in the http layer. Registration order is
// load-bearing: static segments before parameter segments; the assembler in
// app.ts calls this at the usage-records resource's original mount position.
export function registerUsageRecordRoutes(routes: UsageRoutes) {
  return routes
    .openapi(listRoute, async (c) => {
      const query = c.req.valid('query')
      const deps = c.get('deps')
      const auth = await requireAuth(c)
      if (auth instanceof Response) {
        return auth
      }
      let cursor: { createdAt: string; id: string } | null
      try {
        cursor = query.cursor ? parseListCursor(query.cursor) : null
      } catch {
        return c.json(
          {
            error: {
              type: 'validation_error',
              message: 'Invalid list cursor',
              details: { fields: { cursor: 'Cursor is invalid.' } },
            },
          },
          400,
        )
      }
      const records = await deps.usageRecords.list({
        projectId: auth.project.id,
        ...(query.providerId ? { providerId: query.providerId } : {}),
        ...(query.modelId ? { modelId: query.modelId } : {}),
        ...(query.agentId ? { agentId: query.agentId } : {}),
        ...(query.sessionId ? { sessionId: query.sessionId } : {}),
        ...(query.from ? { from: query.from } : {}),
        ...(query.to ? { to: query.to } : {}),
        limit: query.limit ?? 50,
        cursor,
      })
      if (negotiateMediaType(c, ['text/csv']) === 'text/csv') {
        return csvResponse(c, 'usage-records.csv', CSV_HEADER, records.map(csvRow))
      }
      const page = paginateRows(records, query.limit ?? 50)
      return c.json({ data: page.data.map(serializeUsage), pagination: page.pagination }, 200)
    })
    .openapi(readRoute, async (c) => {
      const { recordId } = c.req.valid('param')
      const deps = c.get('deps')
      const auth = await requireAuth(c)
      if (auth instanceof Response) {
        return auth
      }
      const record = await deps.usageRecords.find(auth.project.id, recordId)
      if (!record) {
        return c.json({ error: { type: 'not_found', message: 'Usage record not found' } }, 404)
      }
      return c.json(serializeUsage(record), 200)
    })
}
