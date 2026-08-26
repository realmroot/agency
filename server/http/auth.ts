import { createRoute, type OpenAPIHono, z } from '@hono/zod-openapi'
import { requireOidcConfig } from '../auth/oidc'
import { requireAuth } from '../auth/session'
import { beginWebLogin, endWebSession, finishWebLogin, readWebSession, WebCsrfError } from '../auth/web-session'
import { AuthenticatedOperation, type DepsEnv, ErrorResponseSchema } from '../openapi'

// Mounted at /api/v1/auth (docs/api-v1-design.md §2 Auth). The auth resource's
// http layer; it delegates to server/auth/ (the authentication module that owns
// its own tables and raw-request handling, spanning layers by design — see the
// hono-cf-clean-arch skill auth note).

type AuthRoutes = OpenAPIHono<DepsEnv>

const AuthMethodSchema = z
  .object({
    type: z.literal('oidc').openapi({ example: 'oidc' }),
    issuer: z.string().url().openapi({ example: 'https://id.example.com/api/auth' }),
    clientId: z.string().openapi({ example: 'client_abc123' }),
  })
  .openapi('AuthMethod')

const AuthConfigSchema = z
  .object({
    methods: z.array(AuthMethodSchema),
  })
  .openapi('AuthConfig')

const AuthConfigQuerySchema = z.object({
  organization: z
    .string()
    .min(1)
    .max(240)
    .optional()
    .openapi({
      param: { name: 'organization', in: 'query' },
      example: 'example-org',
    }),
})

const AuthUserSchema = z
  .object({
    id: z.string().openapi({ example: 'user_abc123' }),
    email: z.string().openapi({ example: 'user@example.com' }),
    name: z.string().nullable().openapi({ example: 'Ada Lovelace' }),
  })
  .openapi('AuthUser')

const AuthOrganizationSchema = z
  .object({
    id: z.string().openapi({ example: 'org_abc123' }),
    name: z.string().openapi({ example: 'Example Org' }),
  })
  .openapi('AuthOrganization')

const AuthProjectSchema = z
  .object({
    id: z.string().openapi({ example: 'project_abc123' }),
    name: z.string().openapi({ example: 'Default project' }),
  })
  .openapi('AuthProject')

const AuthSessionSchema = z
  .object({
    csrfToken: z.string(),
    user: AuthUserSchema,
    organization: AuthOrganizationSchema,
    project: AuthProjectSchema,
  })
  .openapi('AuthSession')

const readAuthConfigRoute = createRoute({
  method: 'get',
  path: '/config',
  operationId: 'readAuthConfig',
  tags: ['Auth'],
  summary: 'Discover available sign-in methods for an organization',
  request: { query: AuthConfigQuerySchema },
  responses: {
    200: { description: 'Available sign-in methods', content: { 'application/json': { schema: AuthConfigSchema } } },
  },
})

const readCurrentAuthSessionRoute = createRoute({
  method: 'get',
  path: '/sessions/current',
  operationId: 'readCurrentAuthSession',
  tags: ['Auth'],
  summary: 'Read the authenticated session context',
  ...AuthenticatedOperation,
  responses: {
    200: { description: 'Current session context', content: { 'application/json': { schema: AuthSessionSchema } } },
    401: { description: 'Authentication required', content: { 'application/json': { schema: ErrorResponseSchema } } },
  },
})

const beginLoginRoute = createRoute({
  method: 'get',
  path: '/login',
  operationId: 'beginWebLogin',
  tags: ['Auth'],
  summary: 'Begin confidential web sign-in',
  request: { query: z.object({ returnTo: z.string().optional() }) },
  responses: { 302: { description: 'Redirect to Realmroot' } },
})

const finishLoginRoute = createRoute({
  method: 'get',
  path: '/callback',
  operationId: 'finishWebLogin',
  tags: ['Auth'],
  summary: 'Complete confidential web sign-in',
  request: { query: z.object({ code: z.string(), state: z.string() }) },
  responses: {
    302: { description: 'Opaque web session established' },
    400: { description: 'Invalid callback', content: { 'application/json': { schema: ErrorResponseSchema } } },
    502: { description: 'Realmroot exchange failed', content: { 'application/json': { schema: ErrorResponseSchema } } },
  },
})

const endSessionRoute = createRoute({
  method: 'delete',
  path: '/sessions/current',
  operationId: 'endCurrentAuthSession',
  tags: ['Auth'],
  summary: 'End the current web session',
  responses: {
    204: { description: 'Session ended' },
    403: { description: 'Invalid CSRF token', content: { 'application/json': { schema: ErrorResponseSchema } } },
  },
})

// Registration order is load-bearing: static segments (/config, /sessions)
// register before parameter segments and the auth wall guards
// /sessions/current. The assembler in app.ts calls this at the auth resource's
// original mount position.
export function registerAuthRoutes(routes: AuthRoutes) {
  return routes
    .openapi(readAuthConfigRoute, (c) => {
      let methods: Array<{ type: 'oidc'; issuer: string; clientId: string }> = []
      try {
        const { issuer, clientId } = requireOidcConfig(c.env)
        methods = [{ type: 'oidc' as const, issuer, clientId }]
      } catch {
        methods = []
      }
      return c.json({ methods }, 200)
    })
    .openapi(beginLoginRoute, (c) => beginWebLogin(c) as never)
    .openapi(finishLoginRoute, (c) => finishWebLogin(c) as never)
    .openapi(endSessionRoute, async (c) => {
      try {
        return (await endWebSession(c)) as never
      } catch (error) {
        if (error instanceof WebCsrfError) return c.json({ error: { type: 'forbidden', message: error.message } }, 403)
        throw error
      }
    })
    .openapi(readCurrentAuthSessionRoute, async (c) => {
      const auth = await requireAuth(c)
      if (auth instanceof Response) {
        return auth
      }

      return c.json(
        {
          csrfToken: (await readWebSession(c))?.csrfToken ?? '',
          user: {
            id: auth.user.id,
            email: auth.user.email,
            name: auth.user.name,
          },
          organization: {
            id: auth.organization.id,
            name: auth.organization.name,
          },
          project: {
            id: auth.project.id,
            name: auth.project.name,
          },
        },
        200,
      )
    })
}
