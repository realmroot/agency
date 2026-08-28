import type { DrizzleD1Database } from 'drizzle-orm/d1'
import { drizzle } from 'drizzle-orm/d1'
import type { Context, Env as HonoEnv } from 'hono'
import type { Env } from '../env'
import { errorResponse } from '../errors'
import { logError } from '../logging'
import { DpopError, dpopChallenge } from './dpop'
import {
  getBearerClaims,
  getDpopClaims,
  OidcError,
  oidcAudience,
  organizationIdForClaims,
  type UserInfoClaims,
  upsertProjectForClaims,
} from './oidc'
import { requiredScope } from './scopes'
import { WebSessionCsrfError, webSessionClaims } from './web-session'

// Routes may or may not carry extra context Variables (e.g. an injected Deps
// object). Context's Variables are invariant, so a fixed param would reject one
// shape or the other. These helpers only read env/request, so the param is
// generic over the caller's full Hono env (with Bindings pinned to ours).
type AppContext<E extends HonoEnv = { Bindings: Env }> = Context<E & { Bindings: Env }>

export interface AuthContext {
  authenticationMethod?: 'cookie' | 'bearer' | 'dpop'
  user: {
    id: string
    email: string
    name: string | null
    avatarUrl: string | null
  }
  organization: {
    id: string
    name: string
  }
  project: {
    id: string
    name: string
    organizationId?: string
  }
  roles: string[]
  permissions: string[]
  // OIDC-asserted team memberships; optional because system-synthesized auth
  // contexts (queue consumers, schedulers) carry no identity claims.
  teams?: string[]
  agentActor?: { issuer: string; subject: string }
  oidc: {
    subject: string
    clientId: string | null
    scope: string | null
    issuer: string | null
    runnerId: string | null
    agentActorSubject: string | null
  }
}

export interface AuthIdentity {
  authenticationMethod: NonNullable<AuthContext['authenticationMethod']>
  user: AuthContext['user']
  organization: AuthContext['organization']
  roles: string[]
  permissions: string[]
  teams?: string[]
  agentActor?: AuthContext['agentActor']
  oidc: AuthContext['oidc']
}

export function isRunnerOidcAuth(env: Env, auth: Pick<AuthContext, 'oidc'>) {
  return (!!env.OIDC_RUNNER_CLIENT_ID && auth.oidc.clientId === env.OIDC_RUNNER_CLIENT_ID) || !!auth.oidc.runnerId
}

// Runner tokens are scoped to the runner work loop: registration/heartbeat,
// the work queue, and leases. Session event upload is gated separately by lease
// ownership (see requireSessionEventsAuth).
const RUNNER_TOKEN_PATH_PREFIXES = ['/api/v1/runners', '/api/v1/work-items', '/api/v1/leases']

function isRunnerTokenPath(pathname: string) {
  return RUNNER_TOKEN_PATH_PREFIXES.some((prefix) => pathname.startsWith(prefix))
}

class AuthorizationError extends Error {
  constructor(readonly requiredPermission: string) {
    super('Token is not authorized for this resource')
    this.name = 'AuthorizationError'
  }
}

function missingPermission<E extends HonoEnv>(c: AppContext<E>, auth: Pick<AuthContext, 'permissions' | 'oidc'>) {
  const required = requiredScope(c.req.method, c.req.url)
  if (!required || auth.permissions.includes(required)) return null
  return required
}

function authorizationErrorResponse<E extends HonoEnv>(c: AppContext<E>, error: AuthorizationError) {
  c.header('WWW-Authenticate', authenticationChallenge(c.req.raw, 'insufficient_scope', error.requiredPermission))
  return errorResponse(c, 403, 'forbidden', error.message, {
    requiredPermission: error.requiredPermission,
  }) as never
}

function bearerChallenge(error?: 'invalid_token' | 'insufficient_scope', scope?: string) {
  const parameters = error ? [`error="${error}"`] : []
  if (scope) parameters.push(`scope="${scope}"`)
  return `Bearer${parameters.length ? ` ${parameters.join(', ')}` : ''}`
}

function authenticationChallenge(
  request: Request,
  error?: DpopError['kind'] | 'invalid_token' | 'insufficient_scope',
  scope?: string,
) {
  if (/^Bearer\s+/i.test(request.headers.get('authorization') ?? '')) {
    return bearerChallenge(error === 'invalid_dpop_proof' ? 'invalid_token' : error, scope)
  }
  return dpopChallenge(error, scope)
}

function logAuthenticationFailure<E extends HonoEnv>(c: AppContext<E>, error: OidcError | DpopError) {
  const url = new URL(c.req.url)
  logError('auth.realmroot.rejected', error, {
    method: c.req.method,
    path: url.pathname,
    cfRay: c.req.raw.headers.get('cf-ray'),
    rejectionKind: error instanceof DpopError ? error.kind : 'invalid_token',
  })
}

export async function resolveAuthContext<E extends HonoEnv>(
  c: AppContext<E>,
  db: DrizzleD1Database,
): Promise<AuthContext | null> {
  // Project-scoped resource collections use this request project hint; endpoints
  // addressed by a globally unique resource id should derive project ownership
  // from the resource after authenticating the caller.
  const requestedProjectId =
    c.req.raw.headers.get('x-ama-project-id') ?? new URL(c.req.url).searchParams.get('x-ama-project-id') ?? undefined

  const directMethod = directAuthenticationMethod(c.req.raw)
  const claims = directMethod
    ? await requestClaims(c.env, c.req.raw, oidcAudience(c.env, c.req.url))
    : await webSessionClaims(c)
  if (claims) {
    const identity = authIdentityFromClaims(claims, directMethod ?? 'cookie')
    const requiredPermission = missingPermission(c, identity)
    if (requiredPermission) throw new AuthorizationError(requiredPermission)
    const project = await upsertProjectForClaims(db, claims, new Date().toISOString(), requestedProjectId)
    const { agentActor, ...baseIdentity } = identity
    return {
      ...baseIdentity,
      ...(agentActor ? { agentActor } : {}),
      organization: {
        ...identity.organization,
        id: project.organizationId ?? identity.organization.id,
      },
      project,
    }
  }

  return null
}

// Auth wall variant for the session-events ingest path: like requireAuth but
// WITHOUT the runner-token path gate, because lease-holding runners post events
// to /sessions/{id}/events (a non-runner-token path) and are authorized
// separately by lease ownership. Resolves its own db (auth module owns
// persistence) so the http layer stays drizzle-free.
export async function requireSessionEventsAuth<E extends HonoEnv>(c: AppContext<E>) {
  const db = drizzle(c.env.DB)
  let auth: AuthContext | null
  try {
    auth = await resolveAuthContext(c, db)
  } catch (err) {
    if (err instanceof AuthorizationError) return authorizationErrorResponse(c, err)
    if (err instanceof WebSessionCsrfError) {
      return errorResponse(c, 403, 'forbidden', err.message) as never
    }
    if (err instanceof OidcError || err instanceof DpopError) {
      logAuthenticationFailure(c, err)
      c.header(
        'WWW-Authenticate',
        authenticationChallenge(c.req.raw, err instanceof DpopError ? err.kind : 'invalid_token'),
      )
      return errorResponse(c, 401, 'authentication_required', 'Authentication required', {
        reason: 'missing_or_invalid_realmroot_credential',
      })
    }
    throw err
  }
  if (!auth) {
    c.header('WWW-Authenticate', `${bearerChallenge()}, ${dpopChallenge()}`)
    return errorResponse(c, 401, 'authentication_required', 'Authentication required', {
      reason: 'missing_or_invalid_realmroot_credential',
    })
  }
  return auth
}

// Login flow helper: resolves (and upserts) the project for OIDC claims,
// resolving its own db so the auth http resource stays drizzle-free.
export async function resolveProjectForClaims(env: Env, claims: UserInfoClaims, requestedProjectId?: string) {
  const db = drizzle(env.DB)
  return await upsertProjectForClaims(db, claims, new Date().toISOString(), requestedProjectId)
}

export async function resolveAuthIdentity<E extends HonoEnv>(c: AppContext<E>): Promise<AuthIdentity | null> {
  const directMethod = directAuthenticationMethod(c.req.raw)
  const claims = directMethod
    ? await requestClaims(c.env, c.req.raw, oidcAudience(c.env, c.req.url))
    : await webSessionClaims(c)
  if (claims) {
    return authIdentityFromClaims(claims, directMethod ?? 'cookie')
  }

  return null
}

function authIdentityFromClaims(
  claims: UserInfoClaims,
  authenticationMethod: NonNullable<AuthIdentity['authenticationMethod']>,
): AuthIdentity {
  const organizationId = organizationIdForClaims(claims)
  return {
    authenticationMethod,
    user: {
      id: claims.sub,
      email: claims.email ?? '',
      name: claims.name ?? null,
      avatarUrl: claims.picture ?? null,
    },
    organization: {
      id: organizationId,
      name:
        claims.org_name ??
        claims.organization_name ??
        (organizationId === `user:${claims.sub}` ? 'Personal workspace' : `Organization ${organizationId}`),
    },
    roles: claims.roles,
    permissions: claims.permissions,
    teams: claims.teams,
    ...(claims.actor ? { agentActor: { issuer: claims.actor.issuer, subject: claims.actor.subject } } : {}),
    oidc: {
      subject: claims.sub,
      clientId: claims.client_id ?? claims.azp ?? null,
      scope: claims.scope ?? null,
      issuer: claims.iss ?? null,
      runnerId: null,
      agentActorSubject: claims.actor?.subject ?? null,
    },
  }
}

export async function requireAuthIdentity<E extends HonoEnv>(c: AppContext<E>) {
  let auth: AuthIdentity | null
  try {
    auth = await resolveAuthIdentity(c)
  } catch (err) {
    if (err instanceof WebSessionCsrfError) {
      return errorResponse(c, 403, 'forbidden', err.message) as never
    }
    if (err instanceof OidcError || err instanceof DpopError) {
      logAuthenticationFailure(c, err)
      c.header(
        'WWW-Authenticate',
        authenticationChallenge(c.req.raw, err instanceof DpopError ? err.kind : 'invalid_token'),
      )
      return errorResponse(c, 401, 'authentication_required', 'Authentication required', {
        reason: 'missing_or_invalid_realmroot_credential',
      })
    }
    throw err
  }
  if (!auth) {
    c.header('WWW-Authenticate', `${bearerChallenge()}, ${dpopChallenge()}`)
    return errorResponse(c, 401, 'authentication_required', 'Authentication required', {
      reason: 'missing_or_invalid_realmroot_credential',
    })
  }
  if (isRunnerOidcAuth(c.env, auth) && !isRunnerTokenPath(new URL(c.req.url).pathname)) {
    return errorResponse(c, 403, 'forbidden', 'Runner token is not authorized for this resource') as never
  }
  const requiredPermission = missingPermission(c, auth)
  if (requiredPermission) return authorizationErrorResponse(c, new AuthorizationError(requiredPermission))
  return auth
}

export async function requireAuth<E extends HonoEnv>(c: AppContext<E>) {
  // The auth wall resolves its own persistence so the http layer never touches
  // drizzle (server/auth is the named cross-layer auth module).
  const db = drizzle(c.env.DB)
  let auth: AuthContext | null
  try {
    auth = await resolveAuthContext(c, db)
  } catch (err) {
    if (err instanceof AuthorizationError) return authorizationErrorResponse(c, err)
    if (err instanceof WebSessionCsrfError) {
      return errorResponse(c, 403, 'forbidden', err.message) as never
    }
    if (err instanceof OidcError || err instanceof DpopError) {
      logAuthenticationFailure(c, err)
      c.header(
        'WWW-Authenticate',
        authenticationChallenge(c.req.raw, err instanceof DpopError ? err.kind : 'invalid_token'),
      )
      return errorResponse(c, 401, 'authentication_required', 'Authentication required', {
        reason: 'missing_or_invalid_realmroot_credential',
      })
    }
    throw err
  }
  if (!auth) {
    c.header('WWW-Authenticate', `${bearerChallenge()}, ${dpopChallenge()}`)
    return errorResponse(c, 401, 'authentication_required', 'Authentication required', {
      reason: 'missing_or_invalid_realmroot_credential',
    })
  }
  if (isRunnerOidcAuth(c.env, auth) && !isRunnerTokenPath(new URL(c.req.url).pathname)) {
    return errorResponse(c, 403, 'forbidden', 'Runner token is not authorized for this resource') as never
  }
  return auth
}

function directAuthenticationMethod(request: Request): 'bearer' | 'dpop' | null {
  const authorization = request.headers.get('authorization')
  if (authorization !== null) {
    if (/^Bearer(?:\s|$)/i.test(authorization)) return 'bearer'
    if (/^DPoP(?:\s|$)/i.test(authorization)) return 'dpop'
    throw new OidcError('Authorization credential scheme is unsupported')
  }
  if (hasSocketCredential(request)) return 'dpop'
  return null
}

function requestClaims(env: Env, request: Request, audience: string) {
  if (/^Bearer\s+/i.test(request.headers.get('authorization') ?? '')) {
    return getBearerClaims(env, request, audience)
  }
  return getDpopClaims(env, dpopRequest(request), audience)
}

function dpopRequest(request: Request) {
  if (!hasSocketCredential(request)) return request
  const protocols = (request.headers.get('sec-websocket-protocol') ?? '').split(',').map((value) => value.trim())
  const access = protocols.find((value) => value.startsWith('ama-access.'))?.slice('ama-access.'.length)
  const proof = protocols.find((value) => value.startsWith('ama-proof.'))?.slice('ama-proof.'.length)
  if (!access || !proof) return request
  const headers = new Headers(request.headers)
  headers.set('authorization', `DPoP ${decodeSocketCredential(access)}`)
  headers.set('dpop', decodeSocketCredential(proof))
  return new Request(request, { headers })
}

function hasSocketCredential(request: Request) {
  return (request.headers.get('sec-websocket-protocol') ?? '').split(',').some((value) => value.trim() === 'ama-dpop')
}

function decodeSocketCredential(value: string) {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new DpopError('invalid_dpop_proof', 'WebSocket DPoP credential is invalid')
  const base64 = value
    .replaceAll('-', '+')
    .replaceAll('_', '/')
    .padEnd(Math.ceil(value.length / 4) * 4, '=')
  try {
    return atob(base64)
  } catch {
    throw new DpopError('invalid_dpop_proof', 'WebSocket DPoP credential is invalid')
  }
}
