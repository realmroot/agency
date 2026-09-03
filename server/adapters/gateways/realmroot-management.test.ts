import type { Env } from '@server/env'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createRealmrootManagementAuthority } from './realmroot-management'

function env(overrides: Record<string, unknown> = {}) {
  return {
    OIDC_ISSUER: 'https://realmroot.example/api/auth',
    OIDC_CLIENT_ID: 'enbor-client',
    OIDC_CLIENT_SECRET: 'enbor-secret',
    ...overrides,
  } as Env
}

afterEach(() => vi.unstubAllGlobals())

describe('Realmroot management authority', () => {
  it('returns the deterministic E2E management credential', async () => {
    const authority = createRealmrootManagementAuthority(
      env({ E2E_TEST_AUTH: 'true', E2E_FAKE_REALMROOT_ENROLLMENT: 'true' }),
    )
    const credential = await authority.exchange({ subject: 'user_1', subjectToken: 'ignored' })
    await expect(credential.headers('POST', 'https://realmroot.example/api/agents')).resolves.toEqual({
      authorization: 'Bearer enbor-e2e-fixture:user_1',
    })
  })

  it('discovers and exchanges a user token for the management audience', async () => {
    const requests: Array<{ url: string; init: RequestInit | undefined }> = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (request: string | URL | Request, init?: RequestInit) => {
        const url = request.toString()
        requests.push({ url, init })
        if (url.endsWith('/.well-known/openid-configuration')) {
          return Response.json({
            issuer: 'https://realmroot.example/api/auth',
            token_endpoint: 'https://realmroot.example/api/auth/token',
          })
        }
        return Response.json({ access_token: 'management-token', token_type: 'Bearer' })
      }),
    )

    const credential = await createRealmrootManagementAuthority(
      env({ REALMROOT_MANAGEMENT_RESOURCE: ' https://realmroot.example/custom-api ' }),
    ).exchange({ subject: 'user_1', subjectToken: 'user-token' })
    await expect(credential.headers('POST', 'unused')).resolves.toEqual({
      authorization: 'Bearer management-token',
    })
    const tokenRequest = requests[1]
    expect(tokenRequest?.init?.headers).toMatchObject({
      accept: 'application/json',
      'content-type': 'application/x-www-form-urlencoded',
      authorization: `Basic ${btoa('enbor-client:enbor-secret')}`,
    })
    const body = new URLSearchParams(String(tokenRequest?.init?.body))
    expect(body.get('subject_token')).toBe('user-token')
    expect(body.get('audience')).toBe('https://realmroot.example/custom-api')
    expect(body.get('scope')).toBe('agents:write')
  })

  it.each([
    [{ OIDC_ISSUER: undefined }, 'OIDC_ISSUER is required'],
    [{ OIDC_CLIENT_ID: ' ' }, 'OIDC_CLIENT_ID is required'],
    [{ OIDC_CLIENT_SECRET: undefined }, 'OIDC_CLIENT_SECRET is required'],
  ] as const)('rejects missing configuration %#', async (overrides, message) => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (request: string | URL | Request) => {
        if (request.toString().includes('openid-configuration')) {
          return Response.json({
            issuer: 'https://realmroot.example/api/auth',
            token_endpoint: 'https://realmroot.example/api/auth/token',
          })
        }
        throw new Error('token request must not run')
      }),
    )
    await expect(
      createRealmrootManagementAuthority(env(overrides)).exchange({ subject: 'user_1', subjectToken: 'token' }),
    ).rejects.toThrow(message)
  })

  it.each([
    [new Response('not json', { status: 200 }), 'Realmroot authorization server discovery failed'],
    [
      Response.json({ issuer: 'https://wrong.example', token_endpoint: 'https://realmroot.example/token' }),
      'discovery failed',
    ],
    [
      Response.json({
        issuer: 'https://realmroot.example/api/auth',
        token_endpoint: 'https://evil.example/token',
      }),
      'crossed an origin boundary',
    ],
  ])('rejects invalid discovery %#', async (response, message) => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => response),
    )
    await expect(
      createRealmrootManagementAuthority(env()).exchange({ subject: 'user_1', subjectToken: 'token' }),
    ).rejects.toThrow(message)
  })

  it.each([
    [new Response('not json', { status: 200 }), 'grant exchange failed'],
    [Response.json({ access_token: 'token', token_type: 'DPoP' }), 'grant exchange failed'],
    [Response.json({ access_token: '', token_type: 'Bearer' }), 'grant exchange failed'],
    [Response.json({ access_token: 'token', token_type: 'Bearer' }, { status: 400 }), 'grant exchange failed'],
  ])('rejects invalid token exchange %#', async (tokenResponse, message) => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (request: string | URL | Request) =>
        request.toString().includes('openid-configuration')
          ? Response.json({
              issuer: 'https://realmroot.example/api/auth',
              token_endpoint: 'https://realmroot.example/api/auth/token',
            })
          : tokenResponse,
      ),
    )
    await expect(
      createRealmrootManagementAuthority(env()).exchange({ subject: 'user_1', subjectToken: 'token' }),
    ).rejects.toThrow(message)
  })
})
