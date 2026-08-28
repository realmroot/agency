import type { Hook } from '@hono/zod-openapi'
import { OpenAPIHono, z } from '@hono/zod-openapi'
import type { Context, Env as HonoBaseEnv } from 'hono'
import { requiredScope } from './auth/scopes'
import { EnvFromEntrySchema } from './contracts/execution-spec'
import type { Env } from './env'
import type { Deps } from './usecases/deps'

export const ApiSecuritySchemes = {
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
  security?: Array<Record<string, string[]>>
  responses?: Record<string, unknown>
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

export function finalizeOpenApiDocument<T extends { paths: object }>(document: T) {
  for (const [path, operations] of Object.entries(document.paths) as Array<
    [string, Record<string, OpenApiOperation>]
  >) {
    for (const [method, operation] of Object.entries(operations)) {
      if (!operation.security?.some((requirement) => Object.hasOwn(requirement, 'oidcAccessToken'))) continue
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

export const SecretRefSchema = z
  .string()
  .min(1)
  .openapi({ example: 'ama://vaults/vault_abc123/credentials/vaultcred_abc123' })

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

const archivedQuery = z
  .enum(['true', 'false'])
  .optional()
  .openapi({
    param: { name: 'archived', in: 'query' },
    description: 'Filter by lifecycle. Defaults to false (live resources only).',
    example: 'false',
  })

// Standard list query for archivable resources. Domains with an operational
// state machine add their own `state` filter on top.
export function listQuerySchema() {
  return z.object({
    archived: archivedQuery,
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
// (docs/api-v1-design.md §1.2 rule 6). Returns the first entry of `offered`
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
