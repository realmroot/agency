import { createRoute, type OpenAPIHono, z } from '@hono/zod-openapi'
import { requireOidcConfig } from '../auth/oidc'
import type { DepsEnv } from '../openapi'

type ConfigzRoutes = OpenAPIHono<DepsEnv>

const PublicOidcConfigSchema = z
  .object({
    issuer: z.string().url().openapi({ example: 'https://id.example.com/api/auth' }),
    clientId: z.string().openapi({ example: 'client_abc123' }),
    scope: z.string().openapi({ example: 'openid email profile' }),
    resource: z.string().url().openapi({ example: 'https://ama.example.com' }),
  })
  .openapi('PublicOidcConfig')

const PublicAuthConfigSchema = z
  .object({
    oidc: PublicOidcConfigSchema.nullable(),
  })
  .openapi('PublicAuthConfig')

const PublicConfigSchema = z
  .object({
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

export function registerConfigzRoutes(routes: ConfigzRoutes) {
  return routes.openapi(readConfigzRoute, (c) => {
    try {
      const { issuer, clientId } = requireOidcConfig(c.env)
      const resource = new URL(c.req.url).origin
      return c.json({ auth: { oidc: { issuer, clientId, scope: 'openid email profile', resource } } }, 200)
    } catch {
      return c.json({ auth: { oidc: null } }, 200)
    }
  })
}
