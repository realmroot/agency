import { drizzle } from 'drizzle-orm/d1'
import { calculateJwkThumbprint, exportJWK, generateKeyPair, type JSONWebKeySet, SignJWT } from 'jose'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Env } from '../env'
import {
  getAccessTokenClaims,
  getBearerClaims,
  getDpopClaims,
  OidcError,
  oidcAudience,
  organizationIdForClaims,
  upsertProjectForClaims,
} from './oidc'

type ProjectRawRow = [string, string, string, string, string]

function fakeD1ForProjectHint(row: ProjectRawRow) {
  const calls: Array<{ sql: string; params: unknown[] }> = []
  const db = {
    prepare(sql: string) {
      return {
        bind(...params: unknown[]) {
          return {
            async raw() {
              calls.push({ sql, params })
              if (sql.includes('"projects"."id" = ?')) {
                return [row]
              }
              throw new Error(`unexpected project hint query: ${sql}`)
            },
          }
        },
      }
    },
  } as unknown as D1Database
  return { db, calls }
}

function envFor(issuer: string, overrides: Partial<Env> = {}) {
  return {
    OIDC_ISSUER: issuer,
    OIDC_CLIENT_ID: 'enbor',
    OIDC_CLIENT_SECRET: 'secret',
    OIDC_RESOURCE: 'https://enbor.example.com',
    OIDC_USE_SERVICE_BINDING: 'false',
    ...overrides,
  } as Env
}

async function signedToken({
  issuer,
  subject = 'user_real',
  claims = {},
  audience = 'https://enbor.example.com',
}: {
  issuer: string
  subject?: string | null
  claims?: Record<string, unknown>
  audience?: string | null
}) {
  const { privateKey, publicKey } = await generateKeyPair('RS256', { extractable: true })
  const jwk = await exportJWK(publicKey)
  jwk.kid = 'test-key'
  jwk.alg = 'RS256'
  jwk.use = 'sig'

  let jwt = new SignJWT({ client_id: 'enbor', scope: 'agents:read', cnf: { jkt: 'test-thumbprint' }, ...claims })
    .setProtectedHeader({ alg: 'RS256', kid: 'test-key', typ: 'at+jwt' })
    .setIssuer(issuer)
    .setIssuedAt()
    .setExpirationTime('5m')
  if (subject !== null) {
    jwt = jwt.setSubject(subject)
  }
  if (audience) {
    jwt = jwt.setAudience(audience)
  }

  return {
    token: await jwt.sign(privateKey),
    jwks: { keys: [jwk] } satisfies JSONWebKeySet,
  }
}

function stubJwks(jwks: JSONWebKeySet) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(input instanceof Request ? input.url : input.toString())
    if (url.pathname.endsWith('/jwks')) {
      return Response.json(jwks)
    }
    if (url.pathname.endsWith('/.well-known/openid-configuration')) {
      const issuer = url.toString().slice(0, -'/.well-known/openid-configuration'.length)
      return Response.json({ issuer, jwks_uri: `${issuer}/jwks` })
    }
    return new Response('not found', { status: 404 })
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

function requestedPaths(fetchMock: ReturnType<typeof vi.fn>) {
  return fetchMock.mock.calls.map(
    ([input]) => new URL(input instanceof Request ? input.url : input.toString()).pathname,
  )
}

function testAuthEnv(overrides: Partial<Env> = {}) {
  return {
    RUNTIME_MODE: 'test',
    E2E_TEST_AUTH: 'true',
    OIDC_ISSUER: 'https://id-e2e.test/api/auth',
    OIDC_CLIENT_ID: 'enbor',
    OIDC_RUNNER_CLIENT_ID: 'enbor-runner',
    OIDC_RESOURCE: 'https://enbor.example.com',
    ...overrides,
  } as Env
}

function e2eDpopRequest(accessToken: string, path = '/api/v1/runners') {
  const url = `https://enbor.example.com${path}`
  return new Request(url, {
    headers: {
      authorization: `DPoP ${accessToken}`,
      dpop: `e2e-proof:GET:${url}`,
    },
  })
}

function replayDb() {
  return {
    prepare() {
      return {
        bind() {
          return {
            async run() {
              return { meta: { changes: 1 } }
            },
          }
        },
      }
    },
  } as unknown as D1Database
}

async function tokenHash(value: string) {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))
  let binary = ''
  for (const byte of digest) binary += String.fromCharCode(byte)
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')
}

describe('[spec: auth/credential-mode] Realmroot credential modes', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('accepts Console Bearer and rejects Console DPoP', async () => {
    const env = testAuthEnv()
    await expect(
      getBearerClaims(
        env,
        new Request('https://enbor.example.com/api/v1/agents', {
          headers: { authorization: 'Bearer e2e:console' },
        }),
      ),
    ).resolves.toMatchObject({ client_id: 'enbor' })
    await expect(getDpopClaims(env, e2eDpopRequest('e2e:console'))).rejects.toMatchObject({
      message: 'Realmroot Console and runner clients require Bearer authentication',
    })
  })

  it('accepts an unknown downstream client Bearer token for the exact Enbor resource', async () => {
    const issuer = 'https://id-downstream.test/api/auth'
    const { token, jwks } = await signedToken({
      issuer,
      claims: {
        client_id: 'downstream-service',
        cnf: undefined,
      },
    })
    stubJwks(jwks)

    await expect(
      getBearerClaims(
        envFor(issuer),
        new Request('https://enbor.example.com/api/v1/agents', {
          headers: { authorization: `Bearer ${token}` },
        }),
      ),
    ).resolves.toMatchObject({ client_id: 'downstream-service', sub: 'user_real' })
  })

  it('rejects a sender-constrained Console JWT presented as Bearer', async () => {
    const issuer = 'https://id-console-sender-constrained.test/api/auth'
    const { token, jwks } = await signedToken({
      issuer,
      claims: {
        client_id: 'enbor',
        cnf: { jkt: 'console-bound-key-thumbprint' },
      },
    })
    stubJwks(jwks)

    await expect(
      getBearerClaims(
        envFor(issuer),
        new Request('https://enbor.example.com/api/v1/agents', {
          headers: { authorization: `Bearer ${token}` },
        }),
      ),
    ).rejects.toMatchObject({
      name: 'OidcError',
      message: 'Realmroot sender-constrained tokens require proof-of-possession authentication',
    })
  })

  it('accepts runner Bearer and rejects runner DPoP', async () => {
    const env = testAuthEnv()
    await expect(
      getBearerClaims(
        env,
        new Request('https://enbor.example.com/api/v1/runners', {
          headers: { authorization: 'Bearer e2e-runner:runner' },
        }),
      ),
    ).resolves.toMatchObject({ client_id: 'enbor-runner', roles: ['runner'] })
    await expect(getDpopClaims(env, e2eDpopRequest('e2e-runner:runner'))).rejects.toMatchObject({
      message: 'Realmroot Console and runner clients require Bearer authentication',
    })
  })

  it('accepts a verified realmroot-cli Agent only with a bound DPoP proof', async () => {
    const issuer = 'https://id-agent-credential.test/api/auth'
    const { privateKey, publicKey } = await generateKeyPair('ES256', { extractable: true })
    const publicJwk = await exportJWK(publicKey)
    const thumbprint = await calculateJwkThumbprint(publicJwk)
    const { token, jwks } = await signedToken({
      issuer,
      claims: {
        client_id: 'realmroot-cli',
        act: { iss: issuer, sub: 'agent_profile_1' },
        cnf: { jkt: thumbprint },
      },
    })
    stubJwks(jwks)
    const url = 'https://enbor.example.com/api/v1/agents'
    const proof = await new SignJWT({
      htu: url,
      htm: 'GET',
      ath: await tokenHash(token),
      jti: 'agent-proof-once',
    })
      .setProtectedHeader({ typ: 'dpop+jwt', alg: 'ES256', jwk: publicJwk })
      .setIssuedAt()
      .sign(privateKey)
    const env = envFor(issuer, { DB: replayDb() })

    await expect(
      getBearerClaims(env, new Request(url, { headers: { authorization: `Bearer ${token}` } })),
    ).rejects.toMatchObject({
      name: 'OidcError',
      message: 'Realmroot Agent clients require DPoP',
    })

    await expect(
      getDpopClaims(env, new Request(url, { headers: { authorization: `DPoP ${token}`, dpop: proof } })),
    ).resolves.toMatchObject({
      client_id: 'realmroot-cli',
      actor: { issuer, subject: 'agent_profile_1', profile: 'ai_agent' },
    })
  })
})

describe('[spec: auth/oidc-claims] Realmroot access-token claim resolution', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('requires a configured runner client for deterministic runner tokens', async () => {
    await expect(
      getAccessTokenClaims(
        { RUNTIME_MODE: 'test', E2E_TEST_AUTH: 'true', OIDC_CLIENT_ID: 'enbor-test' } as Env,
        'e2e-runner:missing-client',
      ),
    ).rejects.toBeInstanceOf(OidcError)
  })

  it('rejects opaque access tokens without calling introspection', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    await expect(getAccessTokenClaims(envFor('https://id-opaque.test/api/auth'), 'opaque-token')).rejects.toMatchObject(
      {
        message: 'Realmroot access token must be a JWT',
      },
    )
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects a JWT whose claims identify a client but no user subject', async () => {
    const issuer = 'https://id-client-token.test/api/auth'
    const { token, jwks } = await signedToken({
      issuer,
      subject: null,
      claims: { client_id: 'client_ak' },
    })
    stubJwks(jwks)

    await expect(getAccessTokenClaims(envFor(issuer), token)).rejects.toBeInstanceOf(OidcError)
  })

  it('resolves a signed JWT subject and never fabricates a client: identity', async () => {
    const issuer = 'https://id-real-user.test/api/auth'
    const { token, jwks } = await signedToken({
      issuer,
      claims: { client_id: 'enbor' },
    })
    const fetchMock = stubJwks(jwks)

    const claims = await getAccessTokenClaims(envFor(issuer), token)
    expect(claims.sub).toBe('user_real')
    expect(organizationIdForClaims(claims)).toBe('user:user_real')
    expect(JSON.stringify(claims)).not.toContain('client:')
    expect(requestedPaths(fetchMock)).not.toContain('/api/auth/oauth2/introspect')
    expect(requestedPaths(fetchMock)).not.toContain('/api/auth/oauth2/userinfo')
  })

  it('normalizes only the canonical Realmroot organization claim', async () => {
    const issuer = 'https://id-canonical-org.test/api/auth'
    const { token, jwks } = await signedToken({
      issuer,
      claims: {
        client_id: 'enbor',
        'urn:realmroot:params:oauth:org': 'org_canonical',
      },
    })
    stubJwks(jwks)

    const claims = await getAccessTokenClaims(envFor(issuer), token)

    expect(claims.organizationId).toBe('org_canonical')
    expect(organizationIdForClaims(claims)).toBe('org_canonical')
  })

  it('does not treat legacy organization aliases as organization context', async () => {
    const issuer = 'https://id-legacy-org.test/api/auth'
    const { token, jwks } = await signedToken({
      issuer,
      claims: {
        client_id: 'enbor',
        org_id: 'org_legacy',
        organization_id: 'org_legacy_fallback',
      },
    })
    stubJwks(jwks)

    const claims = await getAccessTokenClaims(envFor(issuer), token)

    expect(claims).not.toHaveProperty('organizationId')
    expect(organizationIdForClaims(claims)).toBe('user:user_real')
  })

  it('binds a runner token from signed JWT client_id without calling userinfo or introspection', async () => {
    const issuer = 'https://id-runner.test/api/auth'
    const { token, jwks } = await signedToken({
      issuer,
      subject: 'user_runner',
      claims: {
        client_id: 'client_runner',
        scope: 'openid profile email offline_access',
      },
    })
    const fetchMock = stubJwks(jwks)

    const claims = await getAccessTokenClaims(envFor(issuer, { OIDC_RUNNER_CLIENT_ID: 'client_runner' }), token)
    expect(claims.sub).toBe('user_runner')
    expect(claims.client_id).toBe('client_runner')
    expect(claims.roles).toContain('runner')
    expect(requestedPaths(fetchMock)).not.toContain('/api/auth/oauth2/introspect')
    expect(requestedPaths(fetchMock)).not.toContain('/api/auth/oauth2/userinfo')
  })

  it('classifies a verified native Realmroot act chain as the stable ai_agent profile', async () => {
    const issuer = 'https://id-agent.test/api/auth'
    const { token, jwks } = await signedToken({
      issuer,
      subject: 'controller_user_1',
      claims: {
        client_id: 'realmroot-cli',
        act: { iss: issuer, sub: 'agent_profile_1' },
      },
    })
    stubJwks(jwks)

    const claims = await getAccessTokenClaims(envFor(issuer), token)
    expect(claims.sub).toBe('controller_user_1')
    expect(claims.actor).toEqual({ issuer, subject: 'agent_profile_1', profile: 'ai_agent' })
  })

  it('rejects a reserved Realmroot CLI token whose act issuer is not verified', async () => {
    const issuer = 'https://id-agent-reject.test/api/auth'
    const { token, jwks } = await signedToken({
      issuer,
      claims: {
        client_id: 'realmroot-cli',
        act: { iss: 'https://attacker.example.test/api/auth', sub: 'agent_1' },
      },
    })
    stubJwks(jwks)

    await expect(getAccessTokenClaims(envFor(issuer), token)).rejects.toMatchObject({
      message: 'Realmroot Agent token omitted the stable Agent actor',
    })
  })
})

describe('[spec: auth/oidc-audience] OIDC resource audience enforcement', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it.each([
    ['missing', null],
    ['wrong', 'https://other-api.example.com'],
  ])('rejects a signed JWT with %s Enbor audience', async (_name, audience) => {
    const issuer = `https://id-audience-${_name}.test/api/auth`
    const resource = 'https://enbor.example.com'
    const { token, jwks } = await signedToken({ issuer, audience })
    stubJwks(jwks)

    await expect(getAccessTokenClaims(envFor(issuer, { OIDC_RESOURCE: resource }), token)).rejects.toBeInstanceOf(
      OidcError,
    )
  })

  it('accepts the configured Enbor audience and does not invent owner or wildcard authority', async () => {
    const issuer = 'https://id-audience-correct.test/api/auth'
    const resource = 'https://enbor.example.com'
    const { token, jwks } = await signedToken({ issuer, audience: resource })
    stubJwks(jwks)

    const claims = await getAccessTokenClaims(envFor(issuer, { OIDC_RESOURCE: resource }), token)
    expect(claims.sub).toBe('user_real')
    expect(claims.roles).toEqual([])
    expect(claims.permissions).toEqual(['agents:read'])
  })

  it.each([
    {},
    { RUNTIME_MODE: 'production' },
    { RUNTIME_MODE: 'tests', E2E_TEST_AUTH: 'true' },
    { RUNTIME_MODE: 'test' },
    { RUNTIME_MODE: 'test', E2E_TEST_AUTH: 'false' },
    { RUNTIME_MODE: 'live', E2E_TEST_AUTH: 'true' },
  ])('fails closed without OIDC_RESOURCE for runtime flags %j', (values) => {
    expect(() => oidcAudience(values as Env, 'https://enbor.example.com/api/v1/agents')).toThrow(
      'OIDC_RESOURCE is required',
    )
  })

  it('getAccessTokenClaims fails closed in live mode without an explicit OIDC_RESOURCE', async () => {
    const liveEnv = envFor('https://id-live-resource.test/api/auth', { RUNTIME_MODE: 'live' })
    delete liveEnv.OIDC_RESOURCE
    await expect(
      getAccessTokenClaims(liveEnv, 'opaque-token', 'https://enbor.example.com/api/v1/agents'),
    ).rejects.toMatchObject({ message: expect.stringContaining('OIDC_RESOURCE is required') })
  })

  it('uses request origin fallback only in explicit e2e test mode', () => {
    expect(
      oidcAudience(
        { RUNTIME_MODE: 'test', E2E_TEST_AUTH: 'true' } as Env,
        'https://enbor.example.com/api/v1/agents?limit=10',
      ),
    ).toBe('https://enbor.example.com')
  })

  it('does not accept synthesized e2e tokens in live mode even when the test-auth flag is set', async () => {
    await expect(
      getAccessTokenClaims(
        envFor('https://id-live-e2e.test/api/auth', {
          RUNTIME_MODE: 'live',
          E2E_TEST_AUTH: 'true',
        }),
        'e2e:user_1',
      ),
    ).rejects.toMatchObject({ message: 'Realmroot access token must be a JWT' })
  })
})

describe('[spec: auth/session-current] OIDC project resolution', () => {
  it('resolves a requested project before falling back to an organization default', async () => {
    const requestedProject = [
      'project_requested',
      'user:user_project_hint',
      'Requested project',
      '2026-01-01T00:00:00.000Z',
      '2026-01-01T00:00:00.000Z',
    ] satisfies ProjectRawRow
    const { db, calls } = fakeD1ForProjectHint(requestedProject)

    const project = await upsertProjectForClaims(
      drizzle(db),
      {
        sub: 'user_project_hint',
        roles: ['owner'],
        permissions: ['*'],
        teams: [],
      },
      '2026-01-02T00:00:00.000Z',
      'project_requested',
    )

    expect(project).toEqual({
      id: 'project_requested',
      organizationId: 'user:user_project_hint',
      name: 'Requested project',
    })
    expect(calls).toHaveLength(1)
    expect(calls[0]?.params).toEqual(['project_requested', 'user:user_project_hint'])
  })
})
