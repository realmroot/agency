import type { AuthScope } from '@server/usecases/ports'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getBearerClaimsForAudienceMock } = vi.hoisted(() => ({
  getBearerClaimsForAudienceMock: vi.fn(),
}))

vi.mock('@server/auth/oidc', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@server/auth/oidc')>()),
  getBearerClaimsForAudience: getBearerClaimsForAudienceMock,
}))

import { createRealmrootManagementAuthority } from './realmroot-management'

const env = {
  OIDC_ISSUER: 'https://realmroot.example/api/auth',
  OIDC_CLIENT_ID: 'ama-web',
  OIDC_CLIENT_SECRET: 'web-confidential-secret',
  REALMROOT_MANAGEMENT_RESOURCE: 'https://realmroot.example/api',
} as never

function auth(overrides: Partial<AuthScope> = {}): AuthScope {
  return {
    user: { id: 'user-1' },
    organization: { id: 'org-1', name: 'Org' },
    project: { id: 'project-1', name: 'Project' },
    roles: ['owner'],
    permissions: ['agents:write'],
    oidc: { issuer: 'https://realmroot.example/api/auth', clientId: 'ama-web' },
    ...overrides,
  }
}

describe('Realmroot User token exchange through the confidential AMA application', () => {
  beforeEach(() => {
    getBearerClaimsForAudienceMock.mockReset()
    getBearerClaimsForAudienceMock.mockResolvedValue({
      sub: 'user-1',
      client_id: 'ama-web',
      organizationId: 'org-1',
      permissions: ['agents:write'],
    })
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json({
          access_token: 'delegated-user-token',
          issued_token_type: 'urn:ietf:params:oauth:token-type:access_token',
          token_type: 'Bearer',
          expires_in: 300,
          scope: 'agents:write',
        }),
      ),
    )
  })

  it('exchanges the authenticated AMA User access token and validates the downstream token', async () => {
    const credential = await createRealmrootManagementAuthority(env).forAgentAdministration(auth(), 'ama-user-token')
    await expect(credential.headers('POST', 'https://realmroot.example/api/agents')).resolves.toEqual({
      authorization: 'Bearer delegated-user-token',
    })
    const [, init] = vi.mocked(fetch).mock.calls[0]!
    expect(init?.headers).toMatchObject({ authorization: expect.stringMatching(/^Basic /) })
    const basic = (init?.headers as Record<string, string>).authorization
    if (!basic) throw new Error('Token exchange omitted confidential client authentication')
    expect(atob(basic.slice('Basic '.length))).toBe('ama-web:web-confidential-secret')
    expect(new URLSearchParams(String(init?.body))).toEqual(
      new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
        subject_token: 'ama-user-token',
        subject_token_type: 'urn:ietf:params:oauth:token-type:access_token',
        requested_token_type: 'urn:ietf:params:oauth:token-type:access_token',
        audience: 'https://realmroot.example/api',
        scope: 'agents:write',
      }),
    )
    expect(getBearerClaimsForAudienceMock).toHaveBeenCalledWith(
      env,
      'delegated-user-token',
      'https://realmroot.example/api',
    )
  })

  it('rejects Agent callers before token exchange', async () => {
    await expect(
      createRealmrootManagementAuthority(env).forAgentAdministration(
        auth({ agentActor: { issuer: 'https://realmroot.example/api/auth', subject: 'agent-1' } }),
        'agent-token',
      ),
    ).rejects.toThrow('Only a Realmroot User')
    expect(fetch).not.toHaveBeenCalled()
  })

  it('rejects a downstream token that does not preserve the User subject', async () => {
    getBearerClaimsForAudienceMock.mockResolvedValue({
      sub: 'another-user',
      client_id: 'ama-web',
      organizationId: 'org-1',
      permissions: ['agents:write'],
    })
    await expect(
      createRealmrootManagementAuthority(env).forAgentAdministration(auth(), 'ama-user-token'),
    ).rejects.toThrow('does not represent the AMA User delegation')
  })

  it('rejects exchange responses that contain a refresh token', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      Response.json({
        access_token: 'delegated-user-token',
        refresh_token: 'must-not-be-issued',
        issued_token_type: 'urn:ietf:params:oauth:token-type:access_token',
        token_type: 'Bearer',
        scope: 'agents:write',
      }),
    )
    await expect(
      createRealmrootManagementAuthority(env).forAgentAdministration(auth(), 'ama-user-token'),
    ).rejects.toThrow('invalid response')
  })
})
