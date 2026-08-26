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
  REALMROOT_MANAGEMENT_RESOURCE: 'https://realmroot.example/api',
} as never

function auth(overrides: Partial<AuthScope['oidc']> = {}): AuthScope {
  return {
    user: { id: 'user-1' },
    organization: { id: 'org-1', name: 'Org' },
    project: { id: 'project-1', name: 'Project' },
    roles: ['owner'],
    permissions: ['agents:write'],
    oidc: {
      issuer: 'https://realmroot.example/api/auth',
      clientId: 'ama-web',
      realmrootManagementAuthorization: 'Bearer delegated-user-token',
      ...overrides,
    },
  }
}

describe('Realmroot management authority forwarding', () => {
  beforeEach(() => {
    getBearerClaimsForAudienceMock.mockReset()
    getBearerClaimsForAudienceMock.mockResolvedValue({
      sub: 'user-1',
      client_id: 'ama-web',
      permissions: ['agents:write'],
    })
  })

  it('accepts the secondary User Bearer for the same subject and Application', async () => {
    const credential = await createRealmrootManagementAuthority(env).forAgentAdministration(auth())

    await expect(credential.headers('POST', 'https://realmroot.example/api/agents')).resolves.toEqual({
      authorization: 'Bearer delegated-user-token',
    })
    expect(getBearerClaimsForAudienceMock).toHaveBeenCalledWith(
      env,
      'delegated-user-token',
      'https://realmroot.example/api',
    )
  })

  it('rejects a missing secondary User grant', async () => {
    const scope = auth()
    delete scope.oidc?.realmrootManagementAuthorization
    await expect(createRealmrootManagementAuthority(env).forAgentAdministration(scope)).rejects.toThrow(
      'Realmroot Agent management authority requires a delegated User grant',
    )
    expect(getBearerClaimsForAudienceMock).not.toHaveBeenCalled()
  })

  it('rejects a secondary Bearer belonging to another User', async () => {
    getBearerClaimsForAudienceMock.mockResolvedValue({
      sub: 'user-2',
      client_id: 'ama-web',
      permissions: ['agents:write'],
    })

    await expect(createRealmrootManagementAuthority(env).forAgentAdministration(auth())).rejects.toThrow(
      'Realmroot Agent management authority does not represent the AMA User grant',
    )
  })

  it('rejects a secondary Bearer issued to another Application', async () => {
    getBearerClaimsForAudienceMock.mockResolvedValue({
      sub: 'user-1',
      client_id: 'another-web',
      permissions: ['agents:write'],
    })

    await expect(createRealmrootManagementAuthority(env).forAgentAdministration(auth())).rejects.toThrow(
      'Realmroot Agent management authority does not represent the AMA User grant',
    )
  })
})
