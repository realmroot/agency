import { createRoute, type OpenAPIHono, z } from '@hono/zod-openapi'
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
import type { AuditRecord } from '../usecases/ports'

type AuditRoutes = OpenAPIHono<DepsEnv>

const JsonObjectSchema = z.record(z.string(), z.unknown())

const AuditRecordSchema = z
  .object({
    id: z.string(),
    projectId: z.string().nullable(),
    actorUserId: z.string().nullable(),
    controllerUserId: z.string().nullable(),
    actorType: z.enum(['user', 'agent', 'system']),
    action: z.string(),
    resourceType: z.string(),
    resourceId: z.string().nullable(),
    outcome: z.enum(['success', 'failure', 'denied']),
    requestId: z.string().nullable(),
    correlationId: z.string().nullable(),
    sessionId: z.string().nullable(),
    policyCategory: z.string().nullable(),
    metadata: JsonObjectSchema,
    before: JsonObjectSchema,
    after: JsonObjectSchema,
    createdAt: z.string().datetime(),
  })
  .openapi('AuditRecord')

const QuerySchema = z.object({
  actorId: z
    .string()
    .optional()
    .openapi({ param: { name: 'actorId', in: 'query' } }),
  projectId: z
    .string()
    .optional()
    .openapi({ param: { name: 'projectId', in: 'query' } }),
  action: z
    .string()
    .optional()
    .openapi({ param: { name: 'action', in: 'query' }, example: 'policy.evaluate' }),
  resourceType: z
    .string()
    .optional()
    .openapi({ param: { name: 'resourceType', in: 'query' } }),
  resourceId: z
    .string()
    .optional()
    .openapi({ param: { name: 'resourceId', in: 'query' } }),
  outcome: z
    .string()
    .optional()
    .openapi({ param: { name: 'outcome', in: 'query' }, example: 'denied' }),
  from: z
    .string()
    .datetime()
    .optional()
    .openapi({ param: { name: 'from', in: 'query' } }),
  to: z
    .string()
    .datetime()
    .optional()
    .openapi({ param: { name: 'to', in: 'query' } }),
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

const AuditListResponseSchema = listResponseSchema('AuditRecordListResponse', AuditRecordSchema)

const AuditRecordParamsSchema = z.object({
  recordId: z
    .string()
    .openapi({ param: { name: 'recordId', in: 'path' }, example: '0195f5d6-7c20-7000-8000-000000000015' }),
})

function serializeAudit(record: AuditRecord) {
  return {
    id: record.id,
    projectId: record.projectId,
    actorUserId: record.actorUserId,
    controllerUserId: record.controllerUserId,
    actorType: record.actorType,
    action: record.action,
    resourceType: record.resourceType,
    resourceId: record.resourceId,
    outcome: record.outcome,
    requestId: record.requestId,
    correlationId: record.correlationId,
    sessionId: record.sessionId,
    policyCategory: record.policyCategory,
    metadata: record.metadata,
    before: record.before,
    after: record.after,
    createdAt: record.createdAt,
  }
}

const CSV_HEADER = [
  'id',
  'createdAt',
  'projectId',
  'actorType',
  'actorUserId',
  'controllerUserId',
  'action',
  'resourceType',
  'resourceId',
  'outcome',
  'requestId',
  'correlationId',
  'sessionId',
  'policyCategory',
  'metadata',
  'before',
  'after',
]

function csvRow(record: AuditRecord) {
  return [
    record.id,
    record.createdAt,
    record.projectId ?? '',
    record.actorType,
    record.actorUserId ?? '',
    record.controllerUserId ?? '',
    record.action,
    record.resourceType,
    record.resourceId ?? '',
    record.outcome,
    record.requestId ?? '',
    record.correlationId ?? '',
    record.sessionId ?? '',
    record.policyCategory ?? '',
    JSON.stringify(record.metadata),
    JSON.stringify(record.before),
    JSON.stringify(record.after),
  ]
}

const listRoute = createRoute({
  method: 'get',
  path: '/',
  operationId: 'listAuditRecords',
  tags: ['Audit'],
  summary: 'List audit records',
  description: 'Lists audit records for the organization. Send Accept: text/csv to export the filtered records as CSV.',
  ...AuthenticatedOperation,
  request: { query: QuerySchema },
  responses: {
    200: {
      description: 'Audit records',
      content: {
        'application/json': { schema: AuditListResponseSchema },
        'text/csv': { schema: z.string().openapi({ example: 'id,createdAt,action,outcome' }) },
      },
    },
    400: { description: 'Validation error', content: { 'application/json': { schema: ErrorResponseSchema } } },
    401: { description: 'Authentication required', content: { 'application/json': { schema: ErrorResponseSchema } } },
  },
})

const readRoute = createRoute({
  method: 'get',
  path: '/{recordId}',
  operationId: 'readAuditRecord',
  tags: ['Audit'],
  summary: 'Read an audit record',
  ...AuthenticatedOperation,
  request: { params: AuditRecordParamsSchema },
  responses: {
    200: { description: 'Audit record', content: { 'application/json': { schema: AuditRecordSchema } } },
    401: { description: 'Authentication required', content: { 'application/json': { schema: ErrorResponseSchema } } },
    404: { description: 'Audit record not found', content: { 'application/json': { schema: ErrorResponseSchema } } },
  },
})

// Pure-forward reporting resource over the AuditReadRepo (the read side, kept
// distinct from the AuditPort write boundary other resources use). The route
// just paginates/serializes/exports.
// Registration order is load-bearing: static before parameter segments; the
// assembler in app.ts calls this at the audit-records resource's mount position.
export function registerAuditRecordRoutes(routes: AuditRoutes) {
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
      const records = await deps.auditRecords.list({
        organizationId: auth.organization.id,
        ...(query.actorId ? { actorId: query.actorId } : {}),
        ...(query.projectId ? { projectId: query.projectId } : {}),
        ...(query.action ? { action: query.action } : {}),
        ...(query.resourceType ? { resourceType: query.resourceType } : {}),
        ...(query.resourceId ? { resourceId: query.resourceId } : {}),
        ...(query.outcome ? { outcome: query.outcome } : {}),
        ...(query.from ? { from: query.from } : {}),
        ...(query.to ? { to: query.to } : {}),
        limit: query.limit ?? 50,
        cursor,
      })
      if (negotiateMediaType(c, ['text/csv']) === 'text/csv') {
        return csvResponse(c, 'audit-records.csv', CSV_HEADER, records.map(csvRow))
      }
      const page = paginateRows(records, query.limit ?? 50)
      return c.json({ data: page.data.map(serializeAudit), pagination: page.pagination }, 200)
    })
    .openapi(readRoute, async (c) => {
      const { recordId } = c.req.valid('param')
      const deps = c.get('deps')
      const auth = await requireAuth(c)
      if (auth instanceof Response) {
        return auth
      }
      const record = await deps.auditRecords.find(auth.organization.id, recordId)
      if (!record) {
        return c.json({ error: { type: 'not_found', message: 'Audit record not found' } }, 404)
      }
      return c.json(serializeAudit(record), 200)
    })
}
