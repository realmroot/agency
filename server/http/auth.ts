import { type OpenAPIHono, z } from '@hono/zod-openapi'
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
import type { DepsEnv } from '../openapi'

type AuthRoutes = OpenAPIHono<DepsEnv>

const AuthConfigQuerySchema = z.object({
  organization: z.string().min(1).max(240).optional(),
})

const AuthorizationAttemptInputSchema = z.object({ returnTo: z.string().max(2048).default('/') })

// Registration order is load-bearing: static segments (/config, /sessions)
// register before parameter segments and the auth wall guards
// /sessions/current. The assembler in app.ts calls this at the auth resource's
// original mount position.
export function registerAuthRoutes(routes: AuthRoutes) {
  // Browser Cookie Session endpoints are an internal site protocol. They stay
  // on the runtime router but are intentionally absent from OpenAPI and SDKs.
  return routes
    .get('/config', (c) => {
      const parsed = AuthConfigQuerySchema.safeParse(c.req.query())
      if (!parsed.success) return errorResponse(c, 400, 'validation_error', 'Invalid auth config query')
      let methods: Array<{ type: 'oidc'; issuer: string; clientId: string }> = []
      try {
        const { clientId } = requireWebOidcConfig(c.env)
        const { issuer } = requireOidcConfig(c.env)
        methods = [{ type: 'oidc', issuer, clientId }]
      } catch {
        methods = []
      }
      return c.json({ methods }, 200)
    })
    .get('/sessions/current', async (c) => {
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
    .post('/authorization-attempts', async (c) => {
      c.header('Cache-Control', 'no-store')
      const parsed = AuthorizationAttemptInputSchema.safeParse(await c.req.json().catch(() => undefined))
      if (!parsed.success) return errorResponse(c, 400, 'validation_error', 'Invalid authorization attempt')
      try {
        return c.json({ authorizationUrl: await createAuthorizationAttempt(c, parsed.data.returnTo) }, 201)
      } catch (error) {
        if (error instanceof WebSessionCsrfError) return errorResponse(c, 403, 'forbidden', error.message)
        if (error instanceof WebAuthorizationRateLimitError) {
          c.header('Retry-After', '60')
          return errorResponse(c, 429, 'rate_limited', error.message)
        }
        throw error
      }
    })
    .get('/authorization-responses', async (c) => {
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
    .delete('/sessions/current', async (c) => {
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
