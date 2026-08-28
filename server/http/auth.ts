import { createRoute, type OpenAPIHono, z } from '@hono/zod-openapi'
import { requireOidcConfig } from '../auth/oidc'
import { requireAuth } from '../auth/session'
import {
  completeAuthorizationResponse,
  createAuthorizationAttempt,
  deleteWebSession,
  requireWebOidcConfig,
  WebAuthorizationError,
  WebAuthorizationRateLimitError,
  WebSessionCsrfError,
} from '../auth/web-session'
import { errorResponse } from '../errors'
import { AuthenticatedOperation, type DepsEnv, ErrorResponseSchema } from '../openapi'

type AuthRoutes = OpenAPIHono<DepsEnv>

const AuthMethodSchema = z
  .object({
    type: z.literal('oidc').openapi({ example: 'oidc' }),
    issuer: z.string().url().openapi({ example: 'https://id.example.com/api/auth' }),
    clientId: z.string().openapi({ example: 'client_abc123' }),
  })
  .openapi('AuthMethod')

const AuthConfigSchema = z.object({ methods: z.array(AuthMethodSchema) }).openapi('AuthConfig')

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
  summary: 'Read the Realmroot-authenticated request context',
  ...AuthenticatedOperation,
  responses: {
    200: { description: 'Current request context', content: { 'application/json': { schema: AuthSessionSchema } } },
    401: { description: 'Authentication required', content: { 'application/json': { schema: ErrorResponseSchema } } },
  },
})

const AuthorizationAttemptSchema = z.object({ authorizationUrl: z.string().url() }).openapi('AuthorizationAttempt')

const createAuthorizationAttemptRoute = createRoute({
  method: 'post',
  path: '/authorization-attempts',
  operationId: 'createAuthorizationAttempt',
  tags: ['Auth'],
  summary: 'Begin a server-owned Realmroot browser sign-in',
  request: {
    body: {
      required: true,
      content: {
        'application/json': {
          schema: z.object({ returnTo: z.string().max(2048).default('/') }),
        },
      },
    },
  },
  responses: {
    201: {
      description: 'Authorization attempt created',
      content: { 'application/json': { schema: AuthorizationAttemptSchema } },
    },
    403: { description: 'Invalid browser origin', content: { 'application/json': { schema: ErrorResponseSchema } } },
    429: { description: 'Too many active attempts', content: { 'application/json': { schema: ErrorResponseSchema } } },
  },
})

const deleteCurrentAuthSessionRoute = createRoute({
  method: 'delete',
  path: '/sessions/current',
  operationId: 'deleteCurrentAuthSession',
  tags: ['Auth'],
  summary: 'Delete the current browser session',
  responses: {
    204: { description: 'Browser session deleted' },
    403: { description: 'Invalid browser origin', content: { 'application/json': { schema: ErrorResponseSchema } } },
  },
})

// Registration order is load-bearing: static segments (/config, /sessions)
// register before parameter segments and the auth wall guards
// /sessions/current. The assembler in app.ts calls this at the auth resource's
// original mount position.
export function registerAuthRoutes(routes: AuthRoutes) {
  // OAuth protocol callback redirects the browser and is intentionally not
  // part of the resource API/SDK surface.
  routes.get('/authorization-responses', async (c) => {
    c.header('Cache-Control', 'no-store')
    try {
      const returnTo = await completeAuthorizationResponse(c)
      return c.redirect(new URL(returnTo, c.req.url).toString(), 302)
    } catch (error) {
      if (error instanceof WebAuthorizationError) {
        return errorResponse(c, 400, 'oidc_error', error.message)
      }
      throw error
    }
  })

  return routes
    .openapi(readAuthConfigRoute, (c) => {
      let methods: Array<{ type: 'oidc'; issuer: string; clientId: string }> = []
      try {
        const { clientId } = requireWebOidcConfig(c.env)
        const { issuer } = requireOidcConfig(c.env)
        methods = [{ type: 'oidc' as const, issuer, clientId }]
      } catch {
        methods = []
      }
      return c.json({ methods }, 200)
    })
    .openapi(createAuthorizationAttemptRoute, async (c) => {
      c.header('Cache-Control', 'no-store')
      const { returnTo } = c.req.valid('json')
      try {
        return c.json({ authorizationUrl: await createAuthorizationAttempt(c, returnTo) }, 201)
      } catch (error) {
        if (error instanceof WebSessionCsrfError) return errorResponse(c, 403, 'forbidden', error.message)
        if (error instanceof WebAuthorizationRateLimitError) {
          c.header('Retry-After', '600')
          return errorResponse(c, 429, 'rate_limited', error.message)
        }
        throw error
      }
    })
    .openapi(readCurrentAuthSessionRoute, async (c) => {
      c.header('Cache-Control', 'no-store')
      const auth = await requireAuth(c)
      if (auth instanceof Response) return auth
      return c.json(
        {
          user: { id: auth.user.id, email: auth.user.email, name: auth.user.name },
          organization: { id: auth.organization.id, name: auth.organization.name },
          project: { id: auth.project.id, name: auth.project.name },
        },
        200,
      )
    })
    .openapi(deleteCurrentAuthSessionRoute, async (c) => {
      c.header('Cache-Control', 'no-store')
      try {
        await deleteWebSession(c)
        return c.body(null, 204)
      } catch (error) {
        if (error instanceof WebSessionCsrfError) return errorResponse(c, 403, 'forbidden', error.message)
        throw error
      }
    })
}
