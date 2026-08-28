import { createRoute, type OpenAPIHono, z } from '@hono/zod-openapi'
import { oidcAudience, requireOidcConfig } from '../auth/oidc'
import type { Env } from '../env'
import type { DepsEnv } from '../openapi'

type ConfigzRoutes = OpenAPIHono<DepsEnv>

const PublicServiceConfigSchema = z
  .object({
    name: z.literal('Any Managed Agents').openapi({ example: 'Any Managed Agents' }),
    origin: z.string().url().openapi({ example: 'https://ama.example.com' }),
  })
  .openapi('PublicServiceConfig')

const PublicOidcClientConfigSchema = z
  .object({
    clientId: z.string().openapi({ example: 'client_abc123' }),
    scopes: z.array(z.string()).openapi({ example: ['openid', 'email', 'profile'] }),
  })
  .openapi('PublicOidcClientConfig')

const PublicOidcConfigSchema = z
  .object({
    issuer: z.string().url().openapi({ example: 'https://id.example.com/api/auth' }),
    resource: z.string().url().openapi({ example: 'https://ama.example.com' }),
    runner: PublicOidcClientConfigSchema.optional(),
  })
  .openapi('PublicOidcConfig')

const PublicAuthConfigSchema = z
  .object({
    oidc: PublicOidcConfigSchema.nullable(),
  })
  .openapi('PublicAuthConfig')

const PublicConfigSchema = z
  .object({
    version: z.literal(1).openapi({ example: 1 }),
    service: PublicServiceConfigSchema,
    auth: PublicAuthConfigSchema,
  })
  .openapi('PublicConfig')

const readConfigzRoute = createRoute({
  method: 'get',
  path: '/',
  operationId: 'readConfigz',
  tags: ['Config'],
  summary: 'Read public browser configuration',
  responses: {
    200: {
      description: 'Public browser configuration',
      content: { 'application/json': { schema: PublicConfigSchema } },
    },
  },
})

function scopes(value: string | undefined, fallback: string) {
  return (value ?? fallback).split(/\s+/).filter(Boolean)
}

export function publicConfig(
  env: Pick<
    Env,
    | 'OIDC_ISSUER'
    | 'OIDC_CLIENT_ID'
    | 'OIDC_RESOURCE'
    | 'OIDC_BROWSER_SCOPES'
    | 'OIDC_RUNNER_CLIENT_ID'
    | 'OIDC_RUNNER_SCOPES'
  >,
  requestUrl: string,
) {
  const origin = new URL(requestUrl).origin
  const service = { name: 'Any Managed Agents', origin } as const
  try {
    const { issuer } = requireOidcConfig(env as Env)
    const runnerClientId = env.OIDC_RUNNER_CLIENT_ID?.trim()
    const runner = runnerClientId
      ? {
          clientId: runnerClientId,
          scopes: scopes(env.OIDC_RUNNER_SCOPES, 'openid profile email offline_access'),
        }
      : undefined
    return {
      version: 1,
      service,
      auth: {
        oidc: {
          issuer,
          resource: oidcAudience(env, requestUrl),
          ...(runner ? { runner } : {}),
        },
      },
    } as const
  } catch {
    return { version: 1, service, auth: { oidc: null } } as const
  }
}

export function registerConfigzRoutes(routes: ConfigzRoutes) {
  return routes.openapi(readConfigzRoute, (c) => c.json(publicConfig(c.env, c.req.url), 200))
}
