import type { Hook } from '@hono/zod-openapi'
import { OpenAPIHono, z } from '@hono/zod-openapi'
import type { Context, Env as HonoBaseEnv } from 'hono'
import { requiredScope } from './auth/scopes'
import { EnvFromEntrySchema } from './contracts/execution-spec'
import type { Env } from './env'
import type { Deps } from './usecases/deps'

export const ApiSecuritySchemes = {
  inboxCallbackBearer: {
    type: 'http',
    scheme: 'bearer',
    description: 'Per-Subscription high-entropy callback token registered by Agency with Inbox.',
  },
  sessionSocketTicket: {
    type: 'apiKey',
    in: 'header',
    name: 'Sec-WebSocket-Protocol',
    description: 'Single-use opaque ticket created by POST /sessions/{sessionId}/socket-tickets.',
  },
  oidcAccessToken: {
    type: 'openIdConnect',
    openIdConnectUrl: 'https://id.realmroot.dev/api/auth/.well-known/openid-configuration',
    description:
      'Realmroot-issued RFC 9068 access token. Use the Bearer or DPoP presentation mode assigned to the registered client.',
    'x-dpop-supported': true,
  },
} as const

export const AuthenticatedOperation = {
  security: [{ oidcAccessToken: [] }],
}

type OpenApiOperation = {
  operationId?: string
  security?: Array<Record<string, string[]>>
  parameters?: Array<Record<string, unknown>>
  responses?: Record<string, unknown>
  'x-cli-ignore'?: boolean
  'x-cli-name'?: string
}

type MutableOpenApiDocument = {
  paths: object
  components?: {
    parameters?: Record<string, unknown>
  }
}

const PROJECT_SCOPED_RESOURCES = new Set([
  'agents',
  'budgets',
  'environments',
  'identities',
  'leases',
  'memory-stores',
  'runners',
  'sessions',
  'triggers',
  'usage-records',
  'usage-summary',
  'vaults',
  'work-items',
])

const AMA_PROJECT_ID_PARAMETER = '#/components/parameters/AmaProjectId'

const CLI_OPERATION_NAME_OVERRIDES: Readonly<Record<string, string>> = {
  createInboxNotification: 'receive-inbox-notification',
  createLease: 'claim-work-item',
  createSessionEvents: 'append-session-events',
  createSessionMessage: 'send-session-message',
  createTriggerRun: 'run-trigger',
  putRunnerHeartbeat: 'update-runner-heartbeat',
  readAuthConfig: 'auth-methods',
  readConfigz: 'config',
  readCurrentAuthSession: 'whoami',
  refreshCatalog: 'refresh-model-catalog',
}

function cliOperationName(operationId: string) {
  return CLI_OPERATION_NAME_OVERRIDES[operationId] ?? operationId.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase()
}

type OpenApiIdentityProviderDocument = {
  components?: {
    securitySchemes?: Record<string, unknown>
  }
}

export function configureOpenApiIdentityProvider<T extends OpenApiIdentityProviderDocument>(
  document: T,
  issuer: string,
) {
  const discoveryUrl = `${issuer.replace(/\/$/, '')}/.well-known/openid-configuration`
  const scheme = document.components?.securitySchemes?.oidcAccessToken
  if (
    typeof scheme !== 'object' ||
    scheme === null ||
    !('openIdConnectUrl' in scheme) ||
    typeof scheme.openIdConnectUrl !== 'string'
  ) {
    throw new Error('OpenAPI Realmroot access-token security scheme is missing')
  }
  scheme.openIdConnectUrl = discoveryUrl
  return document
}

export function finalizeOpenApiDocument<T extends { paths: object; components?: unknown }>(document: T): T {
  const mutable = document as T & MutableOpenApiDocument
  mutable.components ??= {}
  mutable.components.parameters ??= {}
  mutable.components.parameters.AmaProjectId = {
    name: 'X-AMA-Project-ID',
    in: 'header',
    required: false,
    'x-cli-name': 'project-id',
    description: 'Selects an AMA project in the authenticated organization. Omit to use the default project.',
    schema: { type: 'string', minLength: 1 },
  }
  for (const [path, operations] of Object.entries(mutable.paths) as Array<[string, Record<string, OpenApiOperation>]>) {
    for (const [method, operation] of Object.entries(operations)) {
      if (operation.operationId && operation['x-cli-ignore'] !== true) {
        operation['x-cli-name'] ??= cliOperationName(operation.operationId)
      }
      if (!operation.security?.some((requirement) => Object.hasOwn(requirement, 'oidcAccessToken'))) continue
      const resource = path.split('/')[3]
      if (resource && PROJECT_SCOPED_RESOURCES.has(resource)) {
        operation.parameters ??= []
        if (!operation.parameters.some((parameter) => parameter.$ref === AMA_PROJECT_ID_PARAMETER)) {
          operation.parameters.push({ $ref: AMA_PROJECT_ID_PARAMETER })
        }
        operation.responses ??= {}
        operation.responses['404'] ??= {
          description: 'The selected AMA project does not exist in the authenticated organization',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/ErrorResponse' },
            },
          },
        }
      }
      const scope = requiredScope(method.toUpperCase(), `https://ama.invalid${path}`)
      const sessionSocketTicket = operation.security.some((requirement) =>
        Object.hasOwn(requirement, 'sessionSocketTicket'),
      )
      operation.security = sessionSocketTicket
        ? [{ sessionSocketTicket: [] }, { oidcAccessToken: scope ? [scope] : [] }]
        : [{ oidcAccessToken: scope ? [scope] : [] }]
      operation.responses ??= {}
      operation.responses['401'] ??= {
        description: 'A valid Realmroot credential in the client-specific authentication mode is required',
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/ErrorResponse' },
          },
        },
      }
      operation.responses['403'] ??= {
        description: 'The Realmroot token lacks the scope required for this resource',
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/ErrorResponse' },
          },
        },
      }
    }
  }
  return document
}

export const ErrorResponseSchema = z
  .object({
    error: z.object({
      type: z.string().openapi({ example: 'validation_error' }),
      message: z.string().openapi({ example: 'Invalid request' }),
      issues: z.array(z.unknown()).optional(),
      details: z.record(z.string(), z.unknown()).optional(),
    }),
  })
  .openapi('ErrorResponse')

export const PaginationSchema = z
  .object({
    limit: z.number().int().openapi({ example: 50 }),
    nextCursor: z
      .string()
      .nullable()
      .openapi({ example: 'eyJjcmVhdGVkQXQiOiIyMDI2LTA1LTIyVDAwOjAwOjAwLjAwMFoiLCJpZCI6ImFnZW50X2FiYzEyMyJ9' }),
    hasMore: z.boolean().openapi({ example: false }),
  })
  .openapi('ListPagination')

export function listResponseSchema<T extends z.ZodType>(name: string, itemSchema: T) {
  return z
    .object({
      data: z.array(itemSchema),
      pagination: PaginationSchema,
    })
    .openapi(name)
}

export const SecretRefSchema = z.string().min(1).openapi({
  example: 'ama://vaults/0195f5d6-7c20-7000-8000-000000000007/credentials/0195f5d6-7c20-7000-8000-000000000008',
})

export const NullableSecretRefSchema = SecretRefSchema.nullable().openapi('NullableSecretRef')

export { EnvFromEntrySchema }

const limitQuery = z.coerce
  .number()
  .int()
  .min(1)
  .max(100)
  .optional()
  .openapi({
    param: { name: 'limit', in: 'query' },
    example: 50,
  })

const cursorQuery = z
  .string()
  .min(1)
  .max(512)
  .optional()
  .openapi({
    param: { name: 'cursor', in: 'query' },
    example: 'eyJjcmVhdGVkQXQiOiIyMDI2LTA1LTIyVDAwOjAwOjAwLjAwMFoiLCJpZCI6ImFnZW50X2FiYzEyMyJ9',
  })

const searchQuery = z
  .string()
  .min(1)
  .max(120)
  .optional()
  .openapi({
    param: { name: 'search', in: 'query' },
    example: 'research',
  })

const createdFromQuery = z
  .string()
  .datetime()
  .optional()
  .openapi({
    param: { name: 'createdFrom', in: 'query' },
    example: '2026-05-01T00:00:00.000Z',
  })

const createdToQuery = z
  .string()
  .datetime()
  .optional()
  .openapi({
    param: { name: 'createdTo', in: 'query' },
    example: '2026-05-31T23:59:59.999Z',
  })

// Standard list query for live resources. Soft-deleted resources are retained
// only as database tombstones and are never exposed through product APIs.
export function listQuerySchema() {
  return z.object({
    search: searchQuery,
    createdFrom: createdFromQuery,
    createdTo: createdToQuery,
    limit: limitQuery,
    cursor: cursorQuery,
  })
}

export function eventListQuerySchema() {
  return z
    .object({
      cursor: z.coerce
        .number()
        .int()
        .min(0)
        .optional()
        .openapi({
          param: { name: 'cursor', in: 'query' },
          example: 42,
        }),
      order: z
        .enum(['asc', 'desc'])
        .optional()
        .openapi({
          param: { name: 'order', in: 'query' },
          example: 'asc',
        }),
      limit: z.coerce
        .number()
        .int()
        .min(1)
        .max(200)
        .optional()
        .openapi({
          param: { name: 'limit', in: 'query' },
          example: 100,
        }),
    })
    .strict()
}

export interface ListCursor {
  createdAt: string
  id: string
}

export function formatListCursor(row: ListCursor) {
  return btoa(JSON.stringify({ createdAt: row.createdAt, id: row.id }))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replaceAll('=', '')
}

export function parseListCursor(cursor: string): ListCursor {
  const padded = cursor
    .replaceAll('-', '+')
    .replaceAll('_', '/')
    .padEnd(Math.ceil(cursor.length / 4) * 4, '=')
  const parsed = JSON.parse(atob(padded)) as Partial<ListCursor>
  if (!parsed.createdAt || !parsed.id) {
    throw new Error('Invalid list cursor')
  }
  return { createdAt: parsed.createdAt, id: parsed.id }
}

export function paginateRows<T extends { id: string; createdAt: string }>(rows: T[], limit: number) {
  const data = rows.slice(0, limit)
  const last = data.at(-1)
  return {
    data,
    pagination: {
      limit,
      nextCursor: rows.length > limit && last ? formatListCursor(last) : null,
      hasMore: rows.length > limit,
    },
  }
}

export function paginateSequenceRows<T extends { sequence: number }>(rows: T[], limit: number) {
  const data = rows.slice(0, limit)
  const last = data.at(-1)
  return {
    data,
    pagination: {
      limit,
      nextCursor: rows.length > limit && last ? String(last.sequence) : null,
      hasMore: rows.length > limit,
    },
  }
}

// Content negotiation for collection exports and streams
// ([spec: api-contracts/openapi]). Returns the first entry of `offered`
// that the Accept header allows; JSON wins when the header is absent or
// matches everything.
export function negotiateMediaType<const T extends readonly string[]>(
  c: Context,
  offered: T,
): T[number] | 'application/json' {
  const accept = c.req.header('Accept')
  if (!accept) {
    return 'application/json'
  }
  const accepted = accept.split(',').map((entry) => (entry.split(';')[0] ?? '').trim().toLowerCase())
  for (const candidate of accepted) {
    if (candidate === 'application/json' || candidate === '*/*' || candidate === 'application/*') {
      return 'application/json'
    }
    const match = offered.find((type) => type === candidate || candidate === `${type.split('/')[0] ?? ''}/*`)
    if (match) {
      return match
    }
  }
  return 'application/json'
}

export function csvResponse(c: Context, filename: string, header: string[], rows: string[][]) {
  const escapeCell = (value: string) => (/[",\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value)
  const body = [header, ...rows].map((row) => row.map(escapeCell).join(',')).join('\n')
  return c.body(`${body}\n`, 200, {
    'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition': `attachment; filename="${filename}"`,
  })
}

// The shared validation-error hook: a zod failure becomes the stable error
// envelope. A generic factory so each router supplies its own env shape (E is
// inferred at the call site) without an `any` escape hatch.
function validationErrorHook<E extends HonoBaseEnv>(): Hook<unknown, E, string, unknown> {
  return (result, c) => {
    if (result.success) {
      return
    }
    return c.json(
      {
        error: {
          type: 'validation_error',
          message: 'Invalid request',
          issues: result.error.issues,
        },
      },
      400,
    )
  }
}

export function createApiRouter() {
  return new OpenAPIHono<{ Bindings: Env }>({ defaultHook: validationErrorHook() })
}

// Router variant whose context carries the composition-root Deps object,
// injected by the deps middleware in app.ts. Used by clean-architecture http
// resource modules that read dependencies via c.get('deps').
export type DepsEnv = { Bindings: Env; Variables: { deps: Deps } }

export function createDepsApiRouter() {
  return new OpenAPIHono<DepsEnv>({ defaultHook: validationErrorHook() })
}
