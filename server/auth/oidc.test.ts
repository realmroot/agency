import { exportJWK, generateKeyPair, SignJWT, type JSONWebKeySet } from 'jose'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Env } from '../env'
import { getBearerClaims, OidcError, organizationIdForClaims } from './oidc'

function envFor(issuer: string, overrides: Partial<Env> = {}) {
  return {
    OIDC_ISSUER: issuer,
    OIDC_CLIENT_ID: 'ama',
    OIDC_CLIENT_SECRET: 'secret',
    OIDC_USE_SERVICE_BINDING: 'false',
    ...overrides,
  } as Env
}

async function signedToken({
  issuer,
  subject = 'user_real',
  claims = {},
}: {
  issuer: string
  subject?: string | null
  claims?: Record<string, unknown>
}) {
  const { privateKey, publicKey } = await generateKeyPair('RS256', { extractable: true })
  const jwk = await exportJWK(publicKey)
  jwk.kid = 'test-key'
  jwk.alg = 'RS256'
  jwk.use = 'sig'

  let jwt = new SignJWT(claims)
    .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
    .setIssuer(issuer)
    .setIssuedAt()
    .setExpirationTime('5m')
  if (subject !== null) {
    jwt = jwt.setSubject(subject)
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
    return new Response('not found', { status: 404 })
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

function requestedPaths(fetchMock: ReturnType<typeof vi.fn>) {
  return fetchMock.mock.calls.map(([input]) => new URL(input instanceof Request ? input.url : input.toString()).pathname)
}

describe('[spec: auth/oidc-claims] OIDC bearer claim resolution', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('requires a configured runner client for deterministic runner tokens', async () => {
    await expect(
      getBearerClaims({ AMA_E2E_TEST_AUTH: 'true', OIDC_CLIENT_ID: 'ama-test' } as Env, 'e2e-runner:missing-client'),
    ).rejects.toBeInstanceOf(OidcError)
  })

  it('rejects opaque access tokens without calling introspection', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    await expect(getBearerClaims(envFor('https://id-opaque.test/api/auth'), 'opaque-token')).rejects.toMatchObject({
      message: 'OIDC access token must be a JWT',
    })
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

    await expect(getBearerClaims(envFor(issuer), token)).rejects.toBeInstanceOf(OidcError)
  })

  it('resolves a signed JWT subject and never fabricates a client: identity', async () => {
    const issuer = 'https://id-real-user.test/api/auth'
    const { token, jwks } = await signedToken({
      issuer,
      claims: { client_id: 'client_ak' },
    })
    const fetchMock = stubJwks(jwks)

    const claims = await getBearerClaims(envFor(issuer), token)
    expect(claims.sub).toBe('user_real')
    expect(organizationIdForClaims(claims)).toBe('user:user_real')
    expect(JSON.stringify(claims)).not.toContain('client:')
    expect(requestedPaths(fetchMock)).not.toContain('/api/auth/oauth2/introspect')
    expect(requestedPaths(fetchMock)).not.toContain('/api/auth/oauth2/userinfo')
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

    const claims = await getBearerClaims(envFor(issuer, { OIDC_RUNNER_CLIENT_ID: 'client_runner' }), token)
    expect(claims.sub).toBe('user_runner')
    expect(claims.client_id).toBe('client_runner')
    expect(claims.roles).toContain('runner')
    expect(requestedPaths(fetchMock)).not.toContain('/api/auth/oauth2/introspect')
    expect(requestedPaths(fetchMock)).not.toContain('/api/auth/oauth2/userinfo')
  })
})
