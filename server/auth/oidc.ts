import { and, eq } from 'drizzle-orm'
import type { DrizzleD1Database } from 'drizzle-orm/d1'
import { createRemoteJWKSet, customFetch, type JWKSCacheInput, jwksCache, jwtVerify } from 'jose'
import * as client from 'openid-client'
import { projects } from '../db/schema'
import type { Env } from '../env'

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
  external_tenant_id?: string
  tenant_id?: string
  ama_project_id?: string
  ama_environment_id?: string
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
    clientSecret: env.OIDC_CLIENT_SECRET,
  }
}

async function createOidcClient(env: Env) {
  const config = requireOidcConfig(env)
  const clientMetadata: Partial<client.ClientMetadata> = {
    response_types: ['code'],
    token_endpoint_auth_method: config.clientSecret ? 'client_secret_post' : 'none',
  }
  if (config.clientSecret) {
    clientMetadata.client_secret = config.clientSecret
  }

  try {
    return await client.discovery(
      new URL(config.issuer),
      config.clientId,
      clientMetadata,
      config.clientSecret ? client.ClientSecretPost(config.clientSecret) : client.None(),
      {
        [client.customFetch]: async (input, init) => {
          const request = new Request(input, init as RequestInit)
          const requestUrl = new URL(request.url)
          const issuerUrl = new URL(config.issuer)
          if (
            requestUrl.origin === issuerUrl.origin &&
            (requestUrl.pathname === '/api/auth/.well-known/openid-configuration' ||
              requestUrl.pathname === '/.well-known/openid-configuration/api/auth')
          ) {
            return Response.json({
              issuer: config.issuer,
              authorization_endpoint: `${config.issuer}/oauth2/authorize`,
              token_endpoint: `${config.issuer}/oauth2/token`,
              jwks_uri: `${config.issuer}/jwks`,
              userinfo_endpoint: `${config.issuer}/oauth2/userinfo`,
              end_session_endpoint: `${config.issuer}/oauth2/end-session`,
              response_types_supported: ['code'],
              grant_types_supported: ['authorization_code', 'refresh_token'],
              token_endpoint_auth_methods_supported: ['client_secret_basic', 'client_secret_post', 'none'],
              code_challenge_methods_supported: ['S256'],
              scopes_supported: ['openid', 'profile', 'email', 'offline_access'],
              subject_types_supported: ['public'],
              id_token_signing_alg_values_supported: ['EdDSA'],
            })
          }
          const requestInit: RequestInit = {
            method: request.method,
            headers: Object.fromEntries(request.headers.entries()),
            redirect: request.redirect,
            signal: request.signal,
          }
          if (request.method !== 'GET' && request.method !== 'HEAD') {
            requestInit.body = (init?.body as BodyInit | undefined) ?? (await request.clone().arrayBuffer())
          }
          const useServiceBinding = env.OIDC_USE_SERVICE_BINDING !== 'false'
          return useServiceBinding && requestUrl.origin === issuerUrl.origin && env.OIDC_PROVIDER
            ? await env.OIDC_PROVIDER.fetch(request.url, requestInit)
            : await fetch(request.url, requestInit)
        },
      },
    )
  } catch (err) {
    throw toOidcError(err)
  }
}

export async function getBearerClaims(env: Env, accessToken: string): Promise<UserInfoClaims> {
  if (env.AMA_E2E_TEST_AUTH === 'true' && accessToken.startsWith('e2e:')) {
    return e2eClaims(env, accessToken.slice('e2e:'.length), env.OIDC_CLIENT_ID)
  }
  if (env.AMA_E2E_TEST_AUTH === 'true' && accessToken.startsWith('e2e-runner:')) {
    if (!env.OIDC_RUNNER_CLIENT_ID) {
      throw new OidcError('OIDC_RUNNER_CLIENT_ID is required for runner e2e tokens')
    }
    return e2eClaims(env, accessToken.slice('e2e-runner:'.length), env.OIDC_RUNNER_CLIENT_ID)
  }
  if (env.AMA_E2E_TEST_AUTH === 'true' && accessToken.startsWith('e2e-federated-runner:')) {
    return e2eFederatedRunnerClaims(accessToken.slice('e2e-federated-runner:'.length))
  }

  return normalizeClaims(env, await verifyJwtAccessToken(env, accessToken))
}

async function verifyJwtAccessToken(env: Env, accessToken: string): Promise<Record<string, unknown> & { sub: string }> {
  if (accessToken.split('.').length !== 3) {
    throw new OidcError('OIDC access token must be a JWT')
  }

  const metadata = await oidcMetadata(env)
  const cachedJwks = oidcJwksDataCache.get(metadata.jwksUri) ?? {}
  oidcJwksDataCache.set(metadata.jwksUri, cachedJwks)
  const remoteJwks = createRemoteJWKSet(new URL(metadata.jwksUri), {
    [customFetch]: (url, options) => oidcFetch(env, url, options),
    [jwksCache]: cachedJwks,
    cacheMaxAge: JWKS_CACHE_MAX_AGE_MS,
    cooldownDuration: JWKS_COOLDOWN_MS,
    timeoutDuration: 5000,
  })

  try {
    const { payload } = await jwtVerify(accessToken, remoteJwks, { issuer: metadata.issuer })
    if (!payload.sub) {
      throw new OidcError('OIDC access token did not include required subject')
    }
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

  const oidcClient = await createOidcClient(env)
  const metadata = oidcClient.serverMetadata()
  if (!metadata.jwks_uri) {
    throw new OidcError('OIDC discovery did not include jwks_uri')
  }
  const next = {
    issuer: metadata.issuer ?? issuer,
    jwksUri: metadata.jwks_uri,
    expiresAt: now + OIDC_METADATA_CACHE_MS,
  }
  oidcMetadataCache.set(issuer, next)
  return next
}

function oidcFetch(env: Env, url: string, init: RequestInit) {
  const requestUrl = new URL(url)
  const issuerUrl = new URL(env.OIDC_ISSUER ?? url)
  const useServiceBinding = env.OIDC_USE_SERVICE_BINDING !== 'false'
  return useServiceBinding && requestUrl.origin === issuerUrl.origin && env.OIDC_PROVIDER
    ? env.OIDC_PROVIDER.fetch(url, init)
    : fetch(url, init)
}

export async function upsertProjectForClaims(
  db: DrizzleD1Database,
  claims: UserInfoClaims,
  timestamp: string,
  requestedProjectId?: string,
) {
  const federatedProject = await projectForFederatedClaims(db, claims)
  if (federatedProject) {
    return federatedProject
  }
  if (claims.iss && (claims.external_tenant_id || claims.tenant_id || claims.ama_environment_id)) {
    throw new OidcError('Federated token is not bound to an AMA project')
  }
  const organizationId = organizationIdForClaims(claims)
  const projectName = 'Default project'
  let project = await db.select().from(projects).where(eq(projects.organizationId, organizationId)).get()
  if (!project) {
    project = {
      id: newId('project'),
      organizationId,
      name: projectName,
      createdAt: timestamp,
      updatedAt: timestamp,
    }
    await db.insert(projects).values(project)
  }
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
  return { id: project.id, name: project.name, organizationId: project.organizationId }
}

export function organizationIdForClaims(claims: UserInfoClaims) {
  return claims.org_id ?? claims.organization_id ?? `user:${claims.sub}`
}

async function projectForFederatedClaims(db: DrizzleD1Database, claims: UserInfoClaims) {
  // A federated/runner token names its target AMA project explicitly via `ama_project_id`.
  // The project must belong to the caller's organization (derived from the client identity
  // via organizationIdForClaims), which bounds the token to its own tenant's workspaces — no
  // separate per-tenant federation binding is needed.
  if (!claims.ama_project_id) return null
  const project = await db.select().from(projects).where(eq(projects.id, claims.ama_project_id)).get()
  if (!project) return null
  const organizationId = organizationIdForClaims(claims)
  if (project.organizationId !== organizationId) {
    throw new OidcError('Federated token project does not belong to the caller organization')
  }
  return { id: project.id, name: project.name, organizationId: project.organizationId }
}

function normalizeClaims(env: Env, claims: Record<string, unknown> & { sub: string }): UserInfoClaims {
  const authorization = objectClaim(claims.authorization)
  const roles = stringArray(claims.roles).length ? stringArray(claims.roles) : stringArray(authorization?.roles)
  const permissions = stringArray(claims.permissions).length
    ? stringArray(claims.permissions)
    : stringArray(authorization?.permissions)
  const teams = stringArray(claims.teams).length ? stringArray(claims.teams) : stringArray(authorization?.teams)
  const clientId = stringClaim(claims.client_id) ?? stringClaim(claims.azp)
  const runnerScoped = isRunnerTokenClaim(env, clientId, claims)
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
    ...optionalClaim('organization_id', claims.organization_id),
    ...optionalClaim('org_name', claims.org_name),
    ...optionalClaim('organization_name', claims.organization_name),
    ...optionalClaim('external_tenant_id', claims.external_tenant_id),
    ...optionalClaim('tenant_id', claims.tenant_id),
    ...optionalClaim('ama_project_id', claims.ama_project_id),
    ...optionalClaim('ama_environment_id', claims.ama_environment_id),
    roles: roles.length ? roles : runnerScoped ? ['runner'] : ['owner'],
    permissions: permissions.length ? permissions : runnerScoped ? [] : ['*'],
    teams,
  }
}

// E2E claim synthesis (gated to AMA_E2E_TEST_AUTH). The token payload after
// the `e2e:`/`e2e-runner:` prefix is `<runId>[;org=<orgRunId>][;teams=a,b][;roles=r1,r2]`:
// `org` joins the synthesized user into another run's organization, and
// `teams`/`roles` populate the corresponding OIDC claims so team-scoped
// policy and role-gated overrides are testable without a real IdP.
function e2eClaims(env: Env, spec: string, clientId: string | undefined): UserInfoClaims {
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
  const scope = 'openid profile email offline_access'
  const runnerScoped = isRunnerTokenClaim(env, clientId)
  return {
    sub: `user_e2e_${safeRunId}`,
    email: `${safeRunId}@e2e.example.com`,
    name: `E2E User ${safeRunId}`,
    ...(clientId ? { client_id: clientId, azp: clientId } : {}),
    scope,
    org_id: `org_e2e_${safeOrgRunId}`,
    org_name: `E2E Organization ${safeOrgRunId}`,
    roles: runnerScoped ? ['runner'] : roles.length ? roles : ['owner'],
    permissions: runnerScoped ? [] : ['*'],
    teams: sanitizeList(directives.get('teams')),
  }
}

function e2eFederatedRunnerClaims(value: string): UserInfoClaims {
  const [externalTenantId = 'tenant_e2e', runnerId = 'runner_e2e', environmentId = ''] = value.split(':')
  return {
    iss: 'https://ak.e2e.example.com',
    sub: `${externalTenantId}:${runnerId}`,
    name: `E2E Federated Runner ${runnerId}`,
    client_id: 'federated-runner-client',
    azp: 'federated-runner-client',
    scope: 'runner:connect',
    external_tenant_id: externalTenantId,
    ...(environmentId ? { ama_environment_id: environmentId } : {}),
    roles: ['runner'],
    permissions: [],
    teams: [],
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

function isRunnerTokenClaim(env: Env, clientId: string | undefined, claims?: Record<string, unknown>) {
  return (
    (!!env.OIDC_RUNNER_CLIENT_ID && clientId === env.OIDC_RUNNER_CLIENT_ID) ||
    typeof claims?.external_tenant_id === 'string' ||
    typeof claims?.tenant_id === 'string' ||
    typeof claims?.ama_project_id === 'string' ||
    typeof claims?.ama_environment_id === 'string'
  )
}
