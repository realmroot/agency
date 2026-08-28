import type { Agent, AgentSpec } from '@server/domain/agent'
import { resourceMetadata } from '@server/domain/resource'
import type { Credential, CredentialVersion, SecretMaterial, Vault } from '@server/domain/vault'
import { secretRefIdentity } from '@server/domain/vault'
import type { WorkspaceManifest } from '@server/domain/workspace'
import { describe, expect, it } from 'vitest'
import {
  AgentCreationConflict,
  type AgentCreationRequest,
  AgentCreationUpstreamError,
  AgentCreationValidation,
  createManagedAgent,
} from './agent-creation'
import type { Deps } from './deps'
import type { AuthScope, RealmrootEnrollmentCheckpoint } from './ports'

const timestamp = '2026-08-24T00:00:00.000Z'
const privateKey = 'BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBw'

const auth: AuthScope = {
  organization: { id: 'org_1', name: 'Organization' },
  project: { id: 'project_1', name: 'Project' },
  user: { id: 'user_1' },
  roles: [],
  permissions: [],
  oidc: { issuer: 'https://realmroot.example.com/api/auth' },
}

function spec(overrides: Partial<AgentSpec> = {}): AgentSpec {
  return {
    runtime: 'codex',
    systemPrompt: 'Do the work.',
    provider: null,
    model: null,
    skills: [],
    subagents: [],
    allowedTools: ['read'],
    mcpConnectors: [],
    ...overrides,
  }
}

function request(overrides: Partial<AgentCreationRequest> = {}): AgentCreationRequest {
  return {
    username: 'worker',
    name: 'Worker',
    description: null,
    spec: spec(),
    ...overrides,
  }
}

function realmrootState(identity = true, runtime: AgentSpec['runtime'] = 'ama') {
  return {
    version: 18,
    agent_id: 'rr_agent_1',
    origin: 'https://realmroot.example.com',
    issuer: 'https://realmroot.example.com/api/auth',
    runtime,
    host_id: 'host_1',
    agent_key_id: 'key_1',
    agent_private_key: privateKey,
    enrollment_idempotency_key: 'enroll_1',
    ...(identity
      ? {
          identity: {
            id: 'identity_1',
            issuer: 'https://realmroot.example.com/api/auth',
            subject: 'rr_agent_1',
            username: 'worker',
            name: 'Worker',
            runtime,
          },
        }
      : {}),
  }
}

function agentFrom(input: Parameters<Deps['agents']['createWithInitialVersion']>[0], versionId: string): Agent {
  return {
    metadata: resourceMetadata({
      uid: input.id,
      pid: input.projectId,
      name: input.name,
      description: input.description,
      createdAt: timestamp,
      updatedAt: timestamp,
    }),
    identity: input.identity,
    spec: input.spec,
    status: { phase: 'active', ready: true, currentVersionId: versionId, version: 1 },
  }
}

type Harness = ReturnType<typeof harness>

function harness() {
  const vaults = new Map<string, Vault>()
  const credentials = new Map<string, Credential>()
  const versions = new Map<string, CredentialVersion>()
  const secrets = new Map<string, SecretMaterial>()
  const agents = new Map<string, Agent>()
  const calls = { initialize: 0, prepare: 0, complete: 0, authority: 0, commit: 0 }
  let enrollmentRuntime: AgentSpec['runtime'] = 'ama'
  const deps: Deps = {
    agents: {
      find: async (_projectId: string, agentId: string) => agents.get(agentId) ?? null,
      providerEnabled: async () => true,
      connectorAvailable: async () => true,
      createWithInitialVersion: async (
        input: Parameters<Deps['agents']['createWithInitialVersion']>[0],
        versionId: string,
      ) => {
        calls.commit += 1
        const agent = agentFrom(input, versionId)
        agents.set(input.id, agent)
        return agent
      },
    } as never,
    vaults: {
      find: async (vaultId: string) => vaults.get(vaultId) ?? null,
      insert: async (input: Parameters<Deps['vaults']['insert']>[0]) => {
        const vault: Vault = {
          metadata: resourceMetadata({
            uid: input.id ?? 'vault_generated',
            pid: input.projectId,
            name: input.name,
            description: input.description,
            createdAt: timestamp,
            updatedAt: timestamp,
          }),
          spec: { organizationId: input.organizationId, scope: input.scope },
          status: { phase: 'active' },
        }
        vaults.set(vault.metadata.uid, vault)
        return vault
      },
      findCredential: async (_vaultId: string, credentialId: string) => credentials.get(credentialId) ?? null,
      activeVersion: async (credential: Credential) =>
        credential.status.activeVersionId ? (versions.get(credential.status.activeVersionId) ?? null) : null,
      insertCredentialWithVersion: async (
        input: Parameters<Deps['vaults']['insertCredentialWithVersion']>[0],
        versionInput: Parameters<Deps['vaults']['insertCredentialWithVersion']>[1],
      ) => {
        const credentialId = versionInput.credentialId
        const credential: Credential = {
          metadata: resourceMetadata({
            uid: credentialId,
            pid: input.projectId,
            name: input.name,
            createdAt: timestamp,
            updatedAt: timestamp,
          }),
          spec: {
            vaultId: input.vaultId,
            organizationId: input.organizationId,
            type: input.type,
            metadata: input.metadata,
          },
          status: {
            phase: 'active',
            activeVersionId: versionInput.id,
            revokedAt: null,
            revokedByUserId: null,
            revokeReason: null,
          },
        }
        const version: CredentialVersion = {
          metadata: resourceMetadata({
            uid: versionInput.id,
            pid: versionInput.projectId,
            name: `v${versionInput.version}`,
            createdAt: timestamp,
            updatedAt: timestamp,
          }),
          spec: {
            credentialId,
            vaultId: versionInput.vaultId,
            organizationId: versionInput.organizationId,
            version: versionInput.version,
            provider: versionInput.reference.provider,
            secretRef: versionInput.reference.secretRef,
            referenceName: versionInput.reference.referenceName,
            hasSecret: versionInput.reference.hasSecret,
            metadata: versionInput.metadata,
          },
          status: { phase: 'active', supersededAt: null, revokedAt: null },
        }
        credentials.set(credentialId, credential)
        versions.set(version.metadata.uid, version)
        return { credential, version }
      },
      updateCredential: async (
        credentialId: Parameters<Deps['vaults']['updateCredential']>[0],
        fields: Parameters<Deps['vaults']['updateCredential']>[1],
        updatedAt: Parameters<Deps['vaults']['updateCredential']>[2],
        revokeActiveVersions: Parameters<Deps['vaults']['updateCredential']>[3],
        revokedAt: Parameters<Deps['vaults']['updateCredential']>[4],
      ) => {
        const credential = credentials.get(credentialId)
        if (!credential) return
        credentials.set(credentialId, {
          ...credential,
          metadata: { ...credential.metadata, updatedAt },
          spec: { ...credential.spec, metadata: fields.metadata },
          status: {
            phase: fields.state,
            activeVersionId: fields.activeVersionId,
            revokedAt: fields.revokedAt,
            revokedByUserId: fields.revokedByUserId,
            revokeReason: fields.revokeReason,
          },
        })
        if (!revokeActiveVersions) return
        for (const [versionId, version] of versions) {
          if (version.spec.credentialId !== credentialId || version.status.phase !== 'active') continue
          versions.set(versionId, {
            ...version,
            status: { ...version.status, phase: 'revoked', revokedAt },
          })
        }
      },
    } as never,
    secretStore: {
      store: async (reference: Parameters<Deps['secretStore']['store']>[0], values: SecretMaterial) => {
        secrets.set(reference.secretRef, values)
        return reference.metadata
      },
    } as never,
    runtimeSecrets: {
      resolveWorkspaceManifest: async (
        _visibility: Parameters<Deps['runtimeSecrets']['resolveWorkspaceManifest']>[0],
        volumes: Parameters<Deps['runtimeSecrets']['resolveWorkspaceManifest']>[1],
      ): Promise<WorkspaceManifest> => {
        const volume = volumes[0]
        if (volume?.type !== 'secret') return { root: '/workspace', mounts: [] }
        const identity = secretRefIdentity(volume.secretRef)
        const credential = identity?.credentialId ? credentials.get(identity.credentialId) : null
        const version = credential?.status.activeVersionId ? versions.get(credential.status.activeVersionId) : null
        const material = version ? secrets.get(version.spec.secretRef) : null
        const key = volume.items?.[0]?.key
        const content = key ? material?.stringData?.[key] : undefined
        return {
          root: '/workspace',
          mounts: [
            {
              name: volume.name,
              type: 'secret',
              mountPath: '/workspace/.ama/agent-creation-state',
              readOnly: true,
              files: content ? [{ path: 'checkpoint.json', content }] : [],
            },
          ],
        }
      },
    } as never,
    realmrootManagementAuthority: {
      forAgentAdministration: async () => {
        calls.authority += 1
        return { headers: async () => ({ authorization: 'DPoP token' }) }
      },
    },
    realmrootEnrollment: {
      initialize: async (input) => {
        calls.initialize += 1
        enrollmentRuntime = input.runtime
        return { stage: 'initialized', state: { ...realmrootState(false, input.runtime), origin: input.origin } }
      },
      prepare: async (input: { onCheckpoint: (value: RealmrootEnrollmentCheckpoint) => Promise<void> }) => {
        calls.prepare += 1
        const checkpoint: RealmrootEnrollmentCheckpoint = {
          stage: 'enrolled',
          state: realmrootState(true, enrollmentRuntime),
          identity: {
            id: 'identity_1',
            issuer: 'https://realmroot.example.com/api/auth',
            subject: 'rr_agent_1',
            username: 'worker',
            name: 'Worker',
            runtime: enrollmentRuntime,
          },
        }
        await input.onCheckpoint(checkpoint)
        return checkpoint
      },
      complete: async (input) => {
        calls.complete += 1
        await input.onCheckpoint(input.checkpoint)
        return {
          identity: {
            id: 'identity_1',
            issuer: 'https://realmroot.example.com/api/auth',
            subject: 'rr_agent_1',
            username: 'worker',
            name: 'Worker',
            runtime: enrollmentRuntime,
          },
          state: realmrootState(true, enrollmentRuntime),
        }
      },
    },
    environments: undefined as never,
    providers: undefined as never,
    providerCatalog: undefined as never,
    connectors: undefined as never,
    policies: undefined as never,
    budgets: undefined as never,
    audit: undefined as never,
    policy: undefined as never,
    usageRecords: undefined as never,
    auditRecords: undefined as never,
    triggers: undefined as never,
    triggerDispatch: undefined as never,
    projects: undefined as never,
    runners: undefined as never,
    workItems: undefined as never,
    leases: undefined as never,
    cloudTurnQueue: undefined as never,
    runnerChannel: undefined as never,
    cloudRuntime: undefined as never,
    runtimeWorkspace: undefined as never,
    sandboxExecutor: undefined as never,
    amaTurnExecutor: undefined as never,
    sessionOrchestration: undefined as never,
    sessions: undefined as never,
    sessionEventStore: undefined as never,
    createApprovalGate: undefined as never,
    rereadStartedSession: false,
  }
  return { deps, vaults, credentials, versions, secrets, agents, calls }
}

async function create(value: Harness, overrides: Partial<AgentCreationRequest> = {}, key = 'create-worker') {
  return await createManagedAgent(value.deps, auth, key, request(overrides), () =>
    value.deps.realmrootManagementAuthority!.forAgentAdministration(auth, 'Bearer test'),
  )
}

describe('[spec: agents/create] createManagedAgent', () => {
  it('creates a ready Agent synchronously and reuses the completed Agent for the same key', async () => {
    const value = harness()
    const first = await create(value)
    const second = await create(value)

    expect(second).toEqual(first)
    expect(first).toMatchObject({
      identity: { username: 'worker', runtime: 'codex' },
      spec: { runtime: 'codex' },
      status: { ready: true, version: 1 },
    })
    expect(value.calls).toEqual({ initialize: 1, prepare: 1, complete: 1, authority: 1, commit: 1 })
    expect([...value.credentials.values()].map((credential) => credential.spec.type).sort()).toEqual([
      'ama.dev/realmroot-agent-state',
      'opaque',
    ])
    expect(
      [...value.credentials.values()].map((credential) => ({
        type: credential.spec.type,
        phase: credential.status.phase,
        activeVersionId: credential.status.activeVersionId,
      })),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'opaque', phase: 'revoked', activeVersionId: null }),
        expect.objectContaining({ type: 'ama.dev/realmroot-agent-state', phase: 'active' }),
      ]),
    )
    expect([...value.versions.values()].map((version) => version.status.phase)).toEqual(
      expect.arrayContaining(['revoked', 'active']),
    )
  })

  it('normalizes the legacy workers-ai transport alias before the managed Agent commit', async () => {
    const value = harness()

    const agent = await create(value, { spec: spec({ provider: 'workers-ai' }) })

    expect(agent.spec.provider).toBeNull()
    expect([...value.agents.values()]).toHaveLength(1)
    expect([...value.agents.values()][0]?.spec.provider).toBeNull()
  })

  it('validates the key, username, and Agent configuration before provisioning', async () => {
    await expect(create(harness(), {}, ' ')).rejects.toBeInstanceOf(AgentCreationValidation)
    await expect(create(harness(), {}, 'x'.repeat(201))).rejects.toBeInstanceOf(AgentCreationValidation)
    await expect(create(harness(), { username: 'Bad Username' })).rejects.toBeInstanceOf(AgentCreationValidation)
    await expect(create(harness(), { spec: spec({ systemPrompt: ' ' }) })).rejects.toMatchObject({
      fields: { systemPrompt: expect.any(String) },
    })
  })

  it('rejects reuse of an idempotency key with a different request', async () => {
    const value = harness()
    await create(value)
    await expect(create(value, { name: 'Different' })).rejects.toBeInstanceOf(AgentCreationConflict)
  })

  it('fails closed when management dependencies, authority, or origin are unavailable', async () => {
    const missing = harness()
    delete missing.deps.realmrootEnrollment
    await expect(create(missing)).rejects.toBeInstanceOf(AgentCreationUpstreamError)

    const authority = harness()
    if (!authority.deps.realmrootManagementAuthority) throw new Error('missing test gateway')
    authority.deps.realmrootManagementAuthority.forAgentAdministration = async () => {
      throw new Error('authority down')
    }
    await expect(create(authority)).rejects.toMatchObject({ message: 'authority down' })

    const nonErrorAuthority = harness()
    if (!nonErrorAuthority.deps.realmrootManagementAuthority) throw new Error('missing test gateway')
    nonErrorAuthority.deps.realmrootManagementAuthority.forAgentAdministration = async () => {
      throw 'authority down'
    }
    await expect(create(nonErrorAuthority)).rejects.toMatchObject({ message: 'Realmroot authority is unavailable' })

    const noOrigin = harness()
    const { oidc: _oidc, ...authWithoutOidc } = auth
    await expect(
      createManagedAgent(noOrigin.deps, authWithoutOidc, 'key', request(), () =>
        noOrigin.deps.realmrootManagementAuthority!.forAgentAdministration(authWithoutOidc, 'Bearer test'),
      ),
    ).rejects.toMatchObject({ message: 'Realmroot origin is unavailable' })
  })

  it('resumes from the encrypted final credential without registering again', async () => {
    const value = harness()
    await create(value)
    value.agents.clear()
    value.calls.complete = 0
    value.calls.commit = 0

    await create(value)

    expect(value.calls.initialize).toBe(1)
    expect(value.calls.prepare).toBe(1)
    expect(value.calls.complete).toBe(1)
    expect(value.calls.commit).toBe(1)
  })

  it('rejects an existing checkpoint that belongs to another request', async () => {
    const value = harness()
    await create(value)
    value.agents.clear()
    const final = [...value.credentials.values()].find(
      (credential) => credential.spec.type === 'ama.dev/realmroot-agent-state',
    )
    if (!final) throw new Error('missing final credential')
    final.spec.metadata.requestFingerprint = 'different'

    await expect(create(value)).rejects.toBeInstanceOf(AgentCreationConflict)
  })

  it('resumes the initialization checkpoint and rejects a conflicting initialization fingerprint', async () => {
    const resumed = harness()
    if (!resumed.deps.realmrootEnrollment) throw new Error('missing test gateway')
    const originalPrepare = resumed.deps.realmrootEnrollment.prepare
    resumed.deps.realmrootEnrollment.prepare = async () => {
      throw new Error('interrupt after initialization')
    }
    await expect(create(resumed)).rejects.toBeInstanceOf(AgentCreationUpstreamError)
    resumed.deps.realmrootEnrollment.prepare = originalPrepare
    await create(resumed)
    expect(resumed.calls.initialize).toBe(1)

    const conflict = harness()
    if (!conflict.deps.realmrootEnrollment) throw new Error('missing test gateway')
    conflict.deps.realmrootEnrollment.prepare = async () => {
      throw new Error('interrupt after initialization')
    }
    await expect(create(conflict)).rejects.toBeInstanceOf(AgentCreationUpstreamError)
    const initialization = [...conflict.credentials.values()].find((credential) => credential.spec.type === 'opaque')
    if (!initialization) throw new Error('missing initialization credential')
    initialization.spec.metadata.requestFingerprint = 'different'
    await expect(create(conflict)).rejects.toBeInstanceOf(AgentCreationConflict)
  })

  it('recovers a concurrently created Vault and reports an unrecoverable Vault write', async () => {
    const concurrent = harness()
    const insert = concurrent.deps.vaults.insert
    concurrent.deps.vaults.insert = async (...args) => {
      await insert(...args)
      throw new Error('concurrent vault')
    }
    await expect(create(concurrent)).resolves.toMatchObject({ status: { ready: true } })

    const failed = harness()
    failed.deps.vaults.insert = async () => {
      throw new Error('vault down')
    }
    await expect(create(failed)).rejects.toMatchObject({ message: 'Could not persist the managed Agent Vault' })
  })

  it('fails when an encrypted checkpoint is missing from the runtime projection', async () => {
    const value = harness()
    await create(value)
    value.agents.clear()
    value.secrets.clear()
    await expect(create(value)).rejects.toMatchObject({ message: 'Managed Agent identity state is unavailable' })
  })

  it('resumes from the active final credential without falling back to revoked initialization state', async () => {
    const value = harness()
    await create(value)
    value.agents.clear()

    await expect(create(value)).resolves.toMatchObject({ status: { ready: true } })

    value.agents.clear()
    const state = [...value.credentials.values()].find(
      (credential) => credential.spec.type === 'ama.dev/realmroot-agent-state',
    )
    if (!state) throw new Error('missing state credential')
    const originalFind = value.deps.vaults.findCredential
    value.deps.vaults.findCredential = async (vaultId, credentialId) =>
      credentialId === state.metadata.uid ? null : await originalFind(vaultId, credentialId)

    await expect(create(value)).rejects.toMatchObject({ message: 'Managed Agent identity state is unavailable' })
  })

  it('preserves creation errors raised while preparing the Realmroot identity', async () => {
    for (const failure of [
      new AgentCreationConflict('conflict'),
      new AgentCreationUpstreamError('upstream'),
      new Error('realmroot down'),
      'realmroot down',
    ]) {
      const value = harness()
      if (!value.deps.realmrootEnrollment) throw new Error('missing test gateway')
      value.deps.realmrootEnrollment.prepare = async () => {
        throw failure
      }
      if (failure instanceof AgentCreationConflict) {
        await expect(create(value)).rejects.toBe(failure)
      } else if (failure instanceof AgentCreationUpstreamError) {
        await expect(create(value)).rejects.toBe(failure)
      } else {
        await expect(create(value)).rejects.toMatchObject({
          message: failure instanceof Error ? 'realmroot down' : 'Realmroot Agent identity creation failed',
        })
      }
    }
  })

  it('recovers a concurrent Agent commit and distinguishes a conflicting winner', async () => {
    const same = harness()
    const originalSame = same.deps.agents.createWithInitialVersion
    same.deps.agents.createWithInitialVersion = async (...args) => {
      await originalSame(...args)
      throw new Error('concurrent insert')
    }
    await expect(create(same)).resolves.toMatchObject({ metadata: { name: 'Worker' } })

    const different = harness()
    const originalDifferent = different.deps.agents.createWithInitialVersion
    different.deps.agents.createWithInitialVersion = async (...args) => {
      const winner = await originalDifferent(...args)
      different.agents.set(winner.metadata.uid, { ...winner, metadata: { ...winner.metadata, name: 'Other' } })
      throw new Error('concurrent insert')
    }
    await expect(create(different)).rejects.toBeInstanceOf(AgentCreationConflict)

    const failed = harness()
    failed.deps.agents.createWithInitialVersion = async () => {
      throw new Error('database down')
    }
    await expect(create(failed)).rejects.toThrow('database down')
  })
})
