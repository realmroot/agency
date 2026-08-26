import type { Agent } from '@server/domain/agent'
import { resourceMetadata } from '@server/domain/resource'
import { describe, expect, it, vi } from 'vitest'
import { retireAgent } from './agent-retirement'
import type { Deps } from './deps'
import type { AuthScope } from './ports'

const auth: AuthScope = {
  organization: { id: 'org_1', name: 'Organization' },
  project: { id: 'project_1', name: 'Project', organizationId: 'org_1' },
  user: { id: 'user_1' },
  roles: [],
  permissions: ['agents:write'],
}

function agent(): Agent {
  const timestamp = '2026-08-23T00:00:00.000Z'
  return {
    metadata: resourceMetadata({
      uid: 'agent_1',
      pid: 'project_1',
      name: 'Agent',
      createdAt: timestamp,
      updatedAt: timestamp,
    }),
    identity: {
      issuer: 'https://realmroot.example/api/auth',
      subject: 'subject_1',
      username: 'agent-1',
      runtime: 'ama',
      credentialRef: 'ama://vaults/vault_1/credentials/cred_1',
    },
    spec: {
      runtime: 'ama',
      systemPrompt: 'Work.',
      provider: null,
      model: null,
      skills: [],
      subagents: [],
      allowedTools: [],
      mcpConnectors: [],
    },
    status: { phase: 'active', ready: true, retirementStage: null, currentVersionId: 'version_1', version: 1 },
  }
}

function deps(options: { retireIdentity?: () => Promise<void> } = {}) {
  const markRetirement = vi.fn(async (_projectId: string, _agentId: string, _stage: string, _at: string) => {})
  const destroyManagedVault = vi.fn(async (_vaultId: string, _credentialId: string) => {})
  const retireIdentity = vi.fn(async (_input: unknown) => options.retireIdentity?.())
  const value = {
    agents: { markRetirement },
    sessionOrchestration: { activeSessionsForAgent: async () => [] },
    runtimeSecrets: {
      resolveWorkspaceManifest: async () => ({
        mounts: [
          {
            type: 'secret',
            name: 'identity-state',
            mountPath: '/workspace/.ama/retirement',
            readOnly: true,
            files: [{ path: 'state.json', content: JSON.stringify({ identity: { id: 'identity_1' } }) }],
          },
        ],
      }),
    },
    realmrootManagementAuthority: {
      forAgentAdministration: async () => ({ accessToken: 'management-token', tokenType: 'DPoP' }),
    },
    realmrootEnrollment: { retire: retireIdentity },
    vaults: { destroyManagedVault },
  } as unknown as Deps
  return { value, markRetirement, destroyManagedVault, retireIdentity }
}

describe('[spec: agents/retirement] retireAgent', () => {
  it('retires the Realmroot identity and destroys the managed Vault before leaving a tombstone', async () => {
    const fixture = deps()
    await retireAgent(fixture.value, auth, agent())

    expect(fixture.retireIdentity).toHaveBeenCalledWith({
      issuer: 'https://realmroot.example/api/auth',
      identityId: 'identity_1',
      managementCredential: { accessToken: 'management-token', tokenType: 'DPoP' },
    })
    expect(fixture.destroyManagedVault).toHaveBeenCalledWith('vault_1', 'cred_1')
    expect(fixture.markRetirement.mock.calls.map((call) => call[2])).toEqual([
      'stopping',
      'identity_retired',
      'retired',
    ])
  })

  it('keeps the Agent in its durable non-schedulable stopping stage when Realmroot retirement fails', async () => {
    const fixture = deps({
      retireIdentity: async () => {
        throw new Error('Realmroot unavailable')
      },
    })
    await expect(retireAgent(fixture.value, auth, agent())).rejects.toThrow('Realmroot unavailable')
    expect(fixture.markRetirement.mock.calls.map((call) => call[2])).toEqual(['stopping'])
    expect(fixture.destroyManagedVault).not.toHaveBeenCalled()
  })
})
