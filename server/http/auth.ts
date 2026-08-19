import { createRoute, type OpenAPIHono, z } from '@hono/zod-openapi'
import { getBearerClaims, OidcError, oidcAudience, organizationIdForClaims, requireOidcConfig } from '../auth/oidc'
import { requireAuth, resolveProjectForClaims } from '../auth/session'
import { errorResponse } from '../errors'
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

const CreateAuthSessionRequestSchema = z
  .object({
    accessToken: z.string().min(1).openapi({ example: 'eyJhbGciOiJFZERTQSJ9...' }),
  })
  .openapi('CreateAuthSessionRequest')

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

const createAuthSessionRoute = createRoute({
  method: 'post',
  path: '/sessions',
  operationId: 'createAuthSession',
  tags: ['Auth'],
  summary: 'Validate an OIDC bearer token and return auth context',
  request: { body: { required: true, content: { 'application/json': { schema: CreateAuthSessionRequestSchema } } } },
  responses: {
    201: {
      description: 'Bearer token accepted. Returns user, organization, and project context.',
      content: { 'application/json': { schema: AuthSessionSchema } },
    },
    401: {
      description: 'Invalid or expired OIDC token',
      content: { 'application/json': { schema: ErrorResponseSchema } },
    },
    403: {
      description: 'Request origin is not in the allowed origins list',
      content: { 'application/json': { schema: ErrorResponseSchema } },
    },
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

const deleteCurrentAuthSessionRoute = createRoute({
  method: 'delete',
  path: '/sessions/current',
  operationId: 'deleteCurrentAuthSession',
  tags: ['Auth'],
  summary: 'Complete a local sign-out request',
  responses: {
    204: { description: 'Sign-out acknowledged. Bearer tokens are cleared by the client/OIDC provider.' },
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
    .openapi(createAuthSessionRoute, async (c) => {
      // Reject cross-origin token submissions when an origin allowlist is configured.
      const requestOrigin = c.req.header('origin')
      const allowedOrigins = c.env.AMA_ALLOWED_ORIGINS?.split(',').map((o) => o.trim()) ?? []
      if (requestOrigin && allowedOrigins.length > 0 && !allowedOrigins.includes(requestOrigin)) {
        return errorResponse(c, 403, 'forbidden', 'Request origin is not allowed') as never
      }

      const { accessToken } = c.req.valid('json')

      let claims: Awaited<ReturnType<typeof getBearerClaims>>
      try {
        claims = await getBearerClaims(c.env, accessToken, oidcAudience(c.env, c.req.url))
      } catch (err) {
        if (err instanceof OidcError) {
          return errorResponse(c, 401, 'oidc_error', 'OIDC token validation failed', {
            reason: err.message,
          }) as never
        }
        throw err
      }

      const project = await resolveProjectForClaims(c.env, claims)
      const organizationId = project.organizationId ?? organizationIdForClaims(claims)

      return c.json(
        {
          user: {
            id: claims.sub,
            email: claims.email ?? '',
            name: claims.name ?? null,
          },
          organization: {
            id: organizationId,
            name: claims.org_name ?? claims.organization_name ?? 'Personal workspace',
          },
          project: {
            id: project.id,
            name: project.name,
          },
        },
        201,
      )
    })
    .openapi(readCurrentAuthSessionRoute, async (c) => {
      const auth = await requireAuth(c)
      if (auth instanceof Response) {
        return auth
      }

      return c.json(
        {
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
    .openapi(deleteCurrentAuthSessionRoute, (c) => {
      return c.body(null, 204)
    })
}
