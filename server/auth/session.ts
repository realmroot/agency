import type { DrizzleD1Database } from 'drizzle-orm/d1'
import { drizzle } from 'drizzle-orm/d1'
import type { Context, Env as HonoEnv } from 'hono'
import type { Env } from '../env'
import { errorResponse } from '../errors'
import {
  getBearerClaims,
  OidcError,
  organizationIdForClaims,
  type UserInfoClaims,
  upsertProjectForClaims,
} from './oidc'

// Routes may or may not carry extra context Variables (e.g. an injected Deps
// object). Context's Variables are invariant, so a fixed param would reject one
// shape or the other. These helpers only read env/request, so the param is
// generic over the caller's full Hono env (with Bindings pinned to ours).
type AppContext<E extends HonoEnv = { Bindings: Env }> = Context<E & { Bindings: Env }>

export interface AuthContext {
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
  oidc: {
    subject: string
    clientId: string | null
    scope: string | null
    issuer: string | null
    externalTenantId: string | null
    runnerId: string | null
    runnerProjectId: string | null
    runnerEnvironmentId: string | null
  }
}

export interface AuthIdentity {
  user: AuthContext['user']
  organization: AuthContext['organization']
  roles: string[]
  permissions: string[]
  teams?: string[]
  oidc: AuthContext['oidc']
}

export function isRunnerOidcAuth(env: Env, auth: Pick<AuthContext, 'oidc'>) {
  return (
    (!!env.OIDC_RUNNER_CLIENT_ID && auth.oidc.clientId === env.OIDC_RUNNER_CLIENT_ID) ||
    !!auth.oidc.runnerId ||
    !!auth.oidc.runnerProjectId ||
    !!auth.oidc.runnerEnvironmentId
  )
}

// Runner tokens are scoped to the runner work loop: registration/heartbeat,
// the work queue, and leases. Session event upload is gated separately by lease
// ownership (see requireSessionEventsAuth).
const RUNNER_TOKEN_PATH_PREFIXES = ['/api/v1/runners', '/api/v1/work-items', '/api/v1/leases']

function isRunnerTokenPath(pathname: string) {
  return RUNNER_TOKEN_PATH_PREFIXES.some((prefix) => pathname.startsWith(prefix))
}

function bearerToken(headers: Headers, url: string) {
  const value = headers.get('authorization')
  if (value) {
    const match = /^Bearer\s+(.+)$/i.exec(value.trim())
    return match?.[1] ?? null
  }
  const token = new URL(url).searchParams.get('access_token')
  return token && token.length > 0 ? token : null
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

  const token = bearerToken(c.req.raw.headers, c.req.url)
  if (token) {
    const claims = await getBearerClaims(c.env, token)
    const identity = authIdentityFromClaims(claims)
    const project = await upsertProjectForClaims(db, claims, new Date().toISOString(), requestedProjectId)
    return {
      ...identity,
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
    if (err instanceof OidcError) {
      return errorResponse(c, 401, 'authentication_required', 'Authentication required', {
        reason: 'missing_or_invalid_bearer_token',
      })
    }
    throw err
  }
  if (!auth) {
    return errorResponse(c, 401, 'authentication_required', 'Authentication required', {
      reason: 'missing_or_invalid_bearer_token',
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
  const token = bearerToken(c.req.raw.headers, c.req.url)
  if (token) {
    const claims = await getBearerClaims(c.env, token)
    return authIdentityFromClaims(claims)
  }

  return null
}

function authIdentityFromClaims(claims: Awaited<ReturnType<typeof getBearerClaims>>): AuthIdentity {
  return {
    user: {
      id: claims.sub,
      email: claims.email ?? '',
      name: claims.name ?? null,
      avatarUrl: claims.picture ?? null,
    },
    organization: {
      id: organizationIdForClaims(claims),
      name: claims.org_name ?? claims.organization_name ?? 'Personal workspace',
    },
    roles: claims.roles,
    permissions: claims.permissions,
    teams: claims.teams,
    oidc: {
      subject: claims.sub,
      clientId: claims.client_id ?? claims.azp ?? null,
      scope: claims.scope ?? null,
      issuer: claims.iss ?? null,
      externalTenantId: claims.external_tenant_id ?? claims.tenant_id ?? null,
      runnerId: null,
      runnerProjectId: claims.ama_project_id ?? null,
      runnerEnvironmentId: claims.ama_environment_id ?? null,
    },
  }
}

export async function requireAuthIdentity<E extends HonoEnv>(c: AppContext<E>) {
  let auth: AuthIdentity | null
  try {
    auth = await resolveAuthIdentity(c)
  } catch (err) {
    if (err instanceof OidcError) {
      return errorResponse(c, 401, 'authentication_required', 'Authentication required', {
        reason: 'missing_or_invalid_bearer_token',
      })
    }
    throw err
  }
  if (!auth) {
    return errorResponse(c, 401, 'authentication_required', 'Authentication required', {
      reason: 'missing_or_invalid_bearer_token',
    })
  }
  if (isRunnerOidcAuth(c.env, auth) && !isRunnerTokenPath(new URL(c.req.url).pathname)) {
    return errorResponse(c, 403, 'forbidden', 'Runner token is not authorized for this resource') as never
  }
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
    if (err instanceof OidcError) {
      return errorResponse(c, 401, 'authentication_required', 'Authentication required', {
        reason: 'missing_or_invalid_bearer_token',
      })
    }
    throw err
  }
  if (!auth) {
    return errorResponse(c, 401, 'authentication_required', 'Authentication required', {
      reason: 'missing_or_invalid_bearer_token',
    })
  }
  if (isRunnerOidcAuth(c.env, auth) && !isRunnerTokenPath(new URL(c.req.url).pathname)) {
    return errorResponse(c, 403, 'forbidden', 'Runner token is not authorized for this resource') as never
  }
  return auth
}
