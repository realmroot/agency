import { and, asc, eq } from 'drizzle-orm'
import type { DrizzleD1Database } from 'drizzle-orm/d1'
import { createRemoteJWKSet, customFetch, type JWKSCacheInput, type JWTPayload, jwksCache, jwtVerify } from 'jose'
import { projects } from '../db/schema'
import type { Env } from '../env'
import { verifyDpopCredential } from './dpop'
import { AMA_SCOPES } from './scopes'

export interface UserInfoClaims {
  iss?: string
  sub: string
  email?: string
  name?: string
  picture?: string
  client_id?: string
  azp?: string
  scope?: string
  org_id?: string
  organization_id?: string
  org_name?: string
  organization_name?: string
  roles: string[]
  permissions: string[]
  // Team identifiers asserted by the OIDC provider (top-level `teams` claim
  // or `authorization.teams`). AMA keeps no local team tables; provider
  // access rules reference these identifiers directly.
  teams: string[]
  actor?: { issuer: string; subject: string; profile: 'ai_agent' }
}

export class OidcError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'OidcError'
  }
}

interface CachedOidcMetadata {
  issuer: string
  jwksUri: string
  expiresAt: number
}

const OIDC_METADATA_CACHE_MS = 10 * 60 * 1000
const JWKS_CACHE_MAX_AGE_MS = 10 * 60 * 1000
const JWKS_COOLDOWN_MS = 30 * 1000
const oidcMetadataCache = new Map<string, CachedOidcMetadata>()
const oidcJwksDataCache = new Map<string, JWKSCacheInput>()

export function requireOidcConfig(env: Env) {
  if (!env.OIDC_ISSUER || !env.OIDC_CLIENT_ID) {
    throw new Error('OIDC_ISSUER and OIDC_CLIENT_ID are required')
  }

  return {
    issuer: env.OIDC_ISSUER.replace(/\/$/, ''),
    clientId: env.OIDC_CLIENT_ID,
  }
}

export function oidcAudience(
  env: Pick<Env, 'OIDC_RESOURCE' | 'AMA_RUNTIME_MODE' | 'AMA_E2E_TEST_AUTH'>,
  requestUrl?: string,
) {
  const e2eTestMode = env.AMA_RUNTIME_MODE === 'test' && env.AMA_E2E_TEST_AUTH === 'true'
  if (!env.OIDC_RESOURCE?.trim() && !e2eTestMode) {
    throw new OidcError('OIDC_RESOURCE is required outside the explicit e2e test runtime')
  }
  const value = env.OIDC_RESOURCE?.trim() || (requestUrl ? new URL(requestUrl).origin : '')
  if (!value) {
    throw new OidcError('OIDC_RESOURCE or a request URL is required for access-token audience validation')
  }
  let resource: URL
  try {
    resource = new URL(value)
  } catch {
    throw new OidcError('OIDC_RESOURCE must be an absolute URL')
  }
  if (resource.username || resource.password || resource.search || resource.hash) {
    throw new OidcError('OIDC_RESOURCE must not contain credentials, query, or fragment')
  }
  return resource.toString().replace(/\/$/, '')
}

export async function getDpopClaims(env: Env, request: Request, expectedAudience?: string): Promise<UserInfoClaims> {
  const verified = await verifyDpopCredential(env, request, (accessToken) =>
    verifyAccessToken(env, accessToken, oidcAudience(env, expectedAudience), 'dpop'),
  )
  return normalizeClaims(env, verified.payload)
}

export async function getBearerClaims(env: Env, request: Request, expectedAudience?: string): Promise<UserInfoClaims> {
  const accessToken = bearerAccessToken(request)
  return normalizeClaims(env, await verifyAccessToken(env, accessToken, oidcAudience(env, expectedAudience), 'bearer'))
}

export async function getAccessTokenClaims(
  env: Env,
  accessToken: string,
  expectedAudience?: string,
): Promise<UserInfoClaims> {
  return normalizeClaims(env, await verifyAccessToken(env, accessToken, oidcAudience(env, expectedAudience)))
}

export async function getBearerClaimsForAudience(env: Env, accessToken: string, audience: string) {
  const exactAudience = oidcAudience(
    {
      OIDC_RESOURCE: audience,
      ...(env.AMA_RUNTIME_MODE !== undefined ? { AMA_RUNTIME_MODE: env.AMA_RUNTIME_MODE } : {}),
      ...(env.AMA_E2E_TEST_AUTH !== undefined ? { AMA_E2E_TEST_AUTH: env.AMA_E2E_TEST_AUTH } : {}),
    },
    audience,
  )
  return normalizeClaims(env, await verifyAccessToken(env, accessToken, exactAudience, 'bearer'))
}

async function verifyAccessToken(
  env: Env,
  accessToken: string,
  audience: string,
  credentialMode?: 'bearer' | 'dpop',
): Promise<JWTPayload & { sub: string }> {
  const e2eTestMode = env.AMA_RUNTIME_MODE === 'test' && env.AMA_E2E_TEST_AUTH === 'true'
  if (e2eTestMode && accessToken.startsWith('e2e:')) {
    const payload = e2eClaims(env, accessToken.slice('e2e:'.length), env.OIDC_CLIENT_ID)
    validateRealmrootClient(env, payload, credentialMode)
    return payload
  }
  if (e2eTestMode && accessToken.startsWith('e2e-runner:')) {
    if (!env.OIDC_RUNNER_CLIENT_ID) {
      throw new OidcError('OIDC_RUNNER_CLIENT_ID is required for runner e2e tokens')
    }
    const payload = e2eClaims(env, accessToken.slice('e2e-runner:'.length), env.OIDC_RUNNER_CLIENT_ID)
    validateRealmrootClient(env, payload, credentialMode)
    return payload
  }
  if (accessToken.split('.').length !== 3) {
    throw new OidcError('Realmroot access token must be a JWT')
  }

  const metadata = await oidcMetadata(env)
  const cachedJwks = oidcJwksDataCache.get(metadata.jwksUri) ?? {}
  oidcJwksDataCache.set(metadata.jwksUri, cachedJwks)
  const remoteJwks = createRemoteJWKSet(new URL(metadata.jwksUri), {
    [customFetch]: (url, options) => oidcFetch(url, options),
    [jwksCache]: cachedJwks,
    cacheMaxAge: JWKS_CACHE_MAX_AGE_MS,
    cooldownDuration: JWKS_COOLDOWN_MS,
    timeoutDuration: 5000,
  })

  try {
    const { payload } = await jwtVerify(accessToken, remoteJwks, {
      issuer: metadata.issuer,
      audience,
      typ: 'at+jwt',
      algorithms: ['RS256'],
      requiredClaims: ['sub', 'iat', 'exp', 'client_id', 'scope'],
    })
    if (!payload.sub) {
      throw new OidcError('Realmroot access token did not include required subject')
    }
    validateRealmrootClient(env, payload, credentialMode)
    return { ...payload, sub: payload.sub }
  } catch (err) {
    throw toOidcError(err)
  }
}

async function oidcMetadata(env: Env): Promise<CachedOidcMetadata> {
  const { issuer } = requireOidcConfig(env)
  const cached = oidcMetadataCache.get(issuer)
  const now = Date.now()
  if (cached && cached.expiresAt > now) {
    return cached
  }

  const response = await oidcFetch(`${issuer}/.well-known/openid-configuration`, {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(5000),
  })
  if (!response.ok) throw new OidcError(`Realmroot discovery failed with ${response.status}`)
  const metadata = (await response.json()) as { issuer?: string; jwks_uri?: string }
  if (metadata.issuer !== issuer || !metadata.jwks_uri) throw new OidcError('Realmroot discovery is invalid')
  const next = {
    issuer: metadata.issuer,
    jwksUri: metadata.jwks_uri,
    expiresAt: now + OIDC_METADATA_CACHE_MS,
  }
  oidcMetadataCache.set(issuer, next)
  return next
}

function oidcFetch(url: string, init: RequestInit) {
  return fetch(url, init)
}

async function defaultProjectId(organizationId: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(organizationId))
  const value = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
  return `project_${value.slice(0, 32)}`
}

export async function upsertProjectForClaims(
  db: DrizzleD1Database,
  claims: UserInfoClaims,
  timestamp: string,
  requestedProjectId?: string,
) {
  const organizationId = organizationIdForClaims(claims)
  const projectName = 'Default project'

  if (requestedProjectId) {
    const requestedProject = await db
      .select()
      .from(projects)
      .where(and(eq(projects.id, requestedProjectId), eq(projects.organizationId, organizationId)))
      .get()
    if (requestedProject) {
      return { id: requestedProject.id, name: requestedProject.name, organizationId: requestedProject.organizationId }
    }
  }

  let project = await db
    .select()
    .from(projects)
    .where(and(eq(projects.organizationId, organizationId), eq(projects.name, projectName)))
    .orderBy(asc(projects.createdAt), asc(projects.id))
    .get()
  project ??= await db
    .select()
    .from(projects)
    .where(eq(projects.organizationId, organizationId))
    .orderBy(asc(projects.createdAt), asc(projects.id))
    .get()
  if (!project) {
    project = {
      id: await defaultProjectId(organizationId),
      organizationId,
      name: projectName,
      createdAt: timestamp,
      updatedAt: timestamp,
    }
    await db.insert(projects).values(project).onConflictDoNothing()
  }
  return { id: project.id, name: project.name, organizationId: project.organizationId }
}

export function organizationIdForClaims(claims: UserInfoClaims) {
  return claims.org_id ?? claims.organization_id ?? `user:${claims.sub}`
}

function normalizeClaims(env: Env, claims: Record<string, unknown> & { sub: string }): UserInfoClaims {
  const authorization = objectClaim(claims.authorization)
  const roles = stringArray(claims.roles).length ? stringArray(claims.roles) : stringArray(authorization?.roles)
  const permissions = typeof claims.scope === 'string' ? [...new Set(claims.scope.split(/\s+/).filter(Boolean))] : []
  const teams = stringArray(claims.teams).length ? stringArray(claims.teams) : stringArray(authorization?.teams)
  const clientId = stringClaim(claims.client_id) ?? stringClaim(claims.azp)
  const runnerScoped = isRunnerTokenClaim(env, clientId)
  return {
    sub: claims.sub,
    ...optionalClaim('iss', claims.iss),
    ...optionalClaim('email', claims.email),
    ...optionalClaim('name', claims.name),
    ...optionalClaim('picture', claims.picture),
    ...optionalClaim('client_id', claims.client_id),
    ...optionalClaim('azp', claims.azp),
    ...optionalClaim('scope', claims.scope),
    ...optionalClaim('org_id', claims.org_id),
    ...optionalClaim('organization_id', claims.organization_id ?? claims['urn:realmroot:params:oauth:org']),
    ...optionalClaim('org_name', claims.org_name),
    ...optionalClaim('organization_name', claims.organization_name),
    roles: roles.length ? roles : runnerScoped ? ['runner'] : [],
    permissions,
    teams,
    ...actorClaim(claims.act, clientId === 'realmroot-cli'),
  }
}

function validateRealmrootClient(env: Env, claims: JWTPayload, credentialMode?: 'bearer' | 'dpop') {
  const clientId = stringClaim(claims.client_id)
  const allowedClients = new Set([
    env.OIDC_CLIENT_ID,
    env.OIDC_RUNNER_CLIENT_ID,
    ...trustedBearerClientIds(env),
    'realmroot-cli',
  ])
  if (!clientId || !allowedClients.has(clientId)) throw new OidcError('Realmroot access token client is not allowed')
  if (credentialMode === 'bearer' && clientId === 'realmroot-cli') {
    throw new OidcError('Realmroot Agent clients require DPoP')
  }
  if (credentialMode === 'bearer' && claims.cnf !== undefined) {
    throw new OidcError('Realmroot sender-constrained tokens require proof-of-possession authentication')
  }
  if (credentialMode === 'dpop' && clientId !== 'realmroot-cli') {
    throw new OidcError('Realmroot Console and runner clients require Bearer authentication')
  }
  if (clientId !== 'realmroot-cli') return
  const actor = objectClaim(claims.act)
  if (!actor || actor.iss !== env.OIDC_ISSUER?.replace(/\/$/, '') || typeof actor.sub !== 'string' || !actor.sub) {
    throw new OidcError('Realmroot Agent token omitted the stable Agent actor')
  }
}

function trustedBearerClientIds(env: Env) {
  return (env.OIDC_TRUSTED_BEARER_CLIENT_IDS ?? '')
    .split(/[\s,]+/)
    .map((clientId) => clientId.trim())
    .filter(Boolean)
}

function bearerAccessToken(request: Request) {
  const authorization = request.headers.get('authorization')
  const match = authorization?.match(/^Bearer[\t ]+([^\t ]+)[\t ]*$/i)
  if (!match?.[1]) throw new OidcError('A Bearer access token is required')
  return match[1]
}

function actorClaim(value: unknown, nativeAgentClient: boolean): Pick<UserInfoClaims, 'actor'> | object {
  if (!nativeAgentClient) return {}
  const actor = objectClaim(value)
  return typeof actor?.iss === 'string' && typeof actor.sub === 'string'
    ? { actor: { issuer: actor.iss, subject: actor.sub, profile: 'ai_agent' as const } }
    : {}
}

// E2E claim synthesis (gated to AMA_E2E_TEST_AUTH). The token payload after
// the `e2e:`/`e2e-runner:` prefix is `<runId>[;org=<orgRunId>][;teams=a,b][;roles=r1,r2]`:
// `org` joins the synthesized user into another run's organization, and
// `teams`/`roles` populate the corresponding OIDC claims so team-scoped
// policy and role-gated overrides are testable without a real IdP.
function e2eClaims(env: Env, spec: string, clientId: string | undefined): JWTPayload & { sub: string } {
  const [rawRunId = '', ...directiveParts] = spec.split(';')
  const directives = new Map<string, string>()
  for (const part of directiveParts) {
    const separator = part.indexOf('=')
    if (separator > 0) {
      directives.set(part.slice(0, separator), part.slice(separator + 1))
    }
  }
  const sanitize = (value: string) => value.replaceAll(/[^A-Za-z0-9_-]/g, '_')
  const sanitizeList = (value: string | undefined) =>
    (value ?? '')
      .split(',')
      .map((item) => sanitize(item.trim()))
      .filter(Boolean)
  const safeRunId = sanitize(rawRunId) || newId('run')
  const safeOrgRunId = sanitize(directives.get('org') ?? '') || safeRunId
  const roles = sanitizeList(directives.get('roles'))
  const runnerScoped = isRunnerTokenClaim(env, clientId)
  const resourceScopes = runnerScoped
    ? [
        'runners:read',
        'runners:write',
        'work-items:read',
        'work-items:write',
        'leases:read',
        'leases:write',
        'sessions:write',
      ]
    : AMA_SCOPES
  const scope = ['openid', 'profile', 'email', 'offline_access', ...resourceScopes].join(' ')
  return {
    ...(env.OIDC_ISSUER ? { iss: env.OIDC_ISSUER } : {}),
    sub: `user_e2e_${safeRunId}`,
    email: `${safeRunId}@e2e.example.com`,
    name: `E2E User ${safeRunId}`,
    ...(clientId ? { client_id: clientId, azp: clientId } : {}),
    scope,
    org_id: `org_e2e_${safeOrgRunId}`,
    org_name: `E2E Organization ${safeOrgRunId}`,
    roles: runnerScoped ? ['runner'] : roles.length ? roles : ['owner'],
    permissions: [],
    teams: sanitizeList(directives.get('teams')),
  }
}

function toOidcError(err: unknown) {
  if (err instanceof OidcError) {
    return err
  }
  if (err instanceof Error) {
    return new OidcError(err.message)
  }
  return new OidcError('OIDC operation failed')
}

function newId(prefix: string) {
  return `${prefix}_${crypto.randomUUID().replaceAll('-', '')}`
}

function stringClaim(value: unknown) {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function optionalClaim<Key extends keyof UserInfoClaims>(key: Key, value: unknown) {
  const claim = stringClaim(value)
  return claim ? ({ [key]: claim } as Pick<UserInfoClaims, Key>) : {}
}

function stringArray(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && item.length > 0) : []
}

function objectClaim(value: unknown) {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

function isRunnerTokenClaim(env: Env, clientId: string | undefined) {
  return !!env.OIDC_RUNNER_CLIENT_ID && clientId === env.OIDC_RUNNER_CLIENT_ID
}
