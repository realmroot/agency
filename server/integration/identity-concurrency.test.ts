import { env } from 'cloudflare:workers'
import { createAgentRepo } from '@server/adapters/repos/agents'
import { createIdentityRepo } from '@server/adapters/repos/identities'
import type { AgentSpec } from '@server/domain/agent'
import type { IdentityCheckpoint, IdentityDescriptor } from '@server/domain/identity'
import { resourceMetadata } from '@server/domain/resource'
import type { Credential, CredentialVersion, Vault } from '@server/domain/vault'
import type { Deps } from '@server/usecases/deps'
import { createIdentity } from '@server/usecases/identities'
import type { AuthScope } from '@server/usecases/ports'
import { drizzle } from 'drizzle-orm/d1'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { setupOidcProvider } from './auth'

const timestamp = '2026-08-28T00:00:00.000Z'

async function scope(): Promise<AuthScope> {
  const userId = 'user_123'
  const organizationId = `user:${userId}`
  const projectId = `project_identity_${crypto.randomUUID().replaceAll('-', '')}`
  await env.DB.prepare(
    'INSERT INTO projects (id, organization_id, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
  )
    .bind(projectId, organizationId, 'Personal Identity Project', timestamp, timestamp)
    .run()
  return {
    authenticationMethod: 'bearer',
    organization: { id: organizationId, name: 'Personal' },
    project: { id: projectId, name: 'Project' },
    user: { id: userId },
    roles: [],
    permissions: [],
    oidc: { issuer: 'https://realmroot.example/api/auth', runnerId: null },
  }
}

function checkpoint(runtime = 'codex' as const): IdentityCheckpoint {
  return {
    version: 1,
    stage: 'initialized',
    remote: null,
    state: { version: 18, runtime, installation_private_key: 'private-checkpoint' },
  }
}

function enrolledCheckpoint(runtime = 'codex' as const): IdentityCheckpoint {
  return {
    version: 1,
    stage: 'enrolled',
    remote: {
      agentId: 'rr_agent_1',
      issuer: 'https://realmroot.example/api/auth',
      subject: 'rr_agent_1',
      username: 'reviewer',
      runtime,
    },
    state: {
      version: 18,
      origin: 'https://realmroot.example',
      issuer: 'https://realmroot.example/api/auth',
      runtime,
      agent_id: 'rr_agent_1',
      host_id: 'host_1',
      agent_key_id: 'key_1',
      agent_private_key: 'BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBw',
      enrollment_idempotency_key: 'same-key',
      identity: {
        id: 'rr_agent_1',
        issuer: 'https://realmroot.example/api/auth',
        subject: 'rr_agent_1',
        username: 'reviewer',
        runtime,
      },
    },
  }
}

function managedVault(id: string, auth: AuthScope): Vault {
  return {
    metadata: resourceMetadata({ uid: id, pid: auth.project.id, name: 'Managed Identity', createdAt: timestamp }),
    spec: { organizationId: auth.organization.id, scope: 'project' },
    status: { phase: 'active' },
  }
}

function provisioningHarness(
  auth: AuthScope,
  options: {
    initializeGate?: Promise<void>
    failProvision?: { value: boolean }
    failSetCredentialOnce?: { value: boolean }
    failActivateOnce?: { value: boolean }
    provision?: (
      input: Parameters<NonNullable<Deps['realmrootEnrollment']>['provision']>[0],
      next: IdentityCheckpoint,
    ) => Promise<{
      checkpoint: IdentityCheckpoint
      descriptor: Omit<IdentityDescriptor, 'identityId' | 'credentialRef'>
    }>
  } = {},
) {
  const identities = createIdentityRepo(drizzle(env.DB))
  const vaults = new Map<string, Vault>()
  const credentials = new Map<string, Credential>()
  const secrets = new Map<string, string>()
  const credentialCreates = new Map<string, number>()
  let credentialCount = 0
  const remoteAgentId = `rr_${crypto.randomUUID().replaceAll('-', '')}`
  const initialize = vi.fn(async () => {
    await options.initializeGate
    return checkpoint()
  })
  const provision = vi.fn(async (input: Parameters<NonNullable<Deps['realmrootEnrollment']>['provision']>[0]) => {
    if (options.failProvision?.value) throw new Error('remote unavailable')
    const next = enrolledCheckpoint()
    if (next.remote) {
      next.remote.agentId = remoteAgentId
      next.remote.subject = remoteAgentId
      next.state.agent_id = remoteAgentId
      if (next.state.identity) {
        next.state.identity.id = remoteAgentId
        next.state.identity.subject = remoteAgentId
      }
    }
    if (options.provision) return options.provision(input, next)
    await input.onCheckpoint(next)
    return { checkpoint: next, descriptor: next.remote! }
  })
  const identityRepo = {
    ...identities,
    setCredential: async (...args: Parameters<typeof identities.setCredential>) => {
      if (options.failSetCredentialOnce?.value) {
        options.failSetCredentialOnce.value = false
        throw new Error('crash after credential commit')
      }
      await identities.setCredential(...args)
    },
    activate: async (...args: Parameters<typeof identities.activate>) => {
      if (options.failActivateOnce?.value) {
        options.failActivateOnce.value = false
        throw new Error('crash after final credential commit')
      }
      return identities.activate(...args)
    },
  }
  const deps = {
    identities: identityRepo,
    realmrootEnrollment: { initialize, provision },
    realmrootManagement: {
      exchange: async () => ({ headers: async () => ({ authorization: 'Bearer management' }) }),
    },
    vaults: {
      findIdentityManaged: async (id: string) => vaults.get(id) ?? null,
      insert: async (input: { id: string }) => {
        const value = managedVault(input.id, auth)
        vaults.set(input.id, value)
        return value
      },
      findCredential: async (_vaultId: string, id: string) => credentials.get(id) ?? null,
      findIdentityCredential: async (vaultId: string, identityId: string, purpose: string) =>
        [...credentials.values()].find(
          (value) =>
            value.spec.vaultId === vaultId &&
            value.spec.metadata.identityId === identityId &&
            value.spec.metadata.purpose === purpose,
        ) ?? null,
      latestVersionNumber: async () => 1,
      insertCredentialWithVersion: async (
        credentialInput: { type: Credential['spec']['type']; metadata: Record<string, unknown> },
        versionInput: { id: string; credentialId: string; vaultId: string },
      ) => {
        credentialCount += 1
        credentialCreates.set(versionInput.credentialId, (credentialCreates.get(versionInput.credentialId) ?? 0) + 1)
        const credential: Credential = {
          metadata: resourceMetadata({
            uid: versionInput.credentialId,
            pid: auth.project.id,
            name: versionInput.credentialId,
            createdAt: timestamp,
          }),
          spec: {
            vaultId: versionInput.vaultId,
            organizationId: auth.organization.id,
            type: credentialInput.type,
            metadata: credentialInput.metadata,
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
            pid: auth.project.id,
            name: 'v1',
            createdAt: timestamp,
          }),
          spec: {
            credentialId: versionInput.credentialId,
            vaultId: versionInput.vaultId,
            organizationId: auth.organization.id,
            version: 1,
            provider: 'ama',
            secretRef: `ama://vaults/${versionInput.vaultId}/credentials/${versionInput.credentialId}/versions/${versionInput.id}`,
            referenceName: 'IDENTITY_STATE',
            hasSecret: true,
            metadata: {},
          },
          status: { phase: 'active', supersededAt: null, revokedAt: null },
        }
        credentials.set(versionInput.credentialId, credential)
        return { credential, version }
      },
      insertVersionRotation: async (input: { id: string; credentialId: string; vaultId: string; version: number }) => ({
        metadata: resourceMetadata({
          uid: input.id,
          pid: auth.project.id,
          name: `v${input.version}`,
          createdAt: timestamp,
        }),
        spec: {
          credentialId: input.credentialId,
          vaultId: input.vaultId,
          organizationId: auth.organization.id,
          version: input.version,
          provider: 'ama',
          secretRef: `ama://vaults/${input.vaultId}/credentials/${input.credentialId}/versions/${input.id}`,
          referenceName: 'IDENTITY_STATE',
          hasSecret: true,
          metadata: {},
        },
        status: { phase: 'active', supersededAt: null, revokedAt: null },
      }),
    },
    secretStore: {
      store: async (reference: { secretRef: string }, secret: { stringData?: Record<string, string> }) => {
        const credentialId = /\/credentials\/([^/]+)/.exec(reference.secretRef)?.[1]
        if (credentialId && secret.stringData?.['state.json']) {
          secrets.set(decodeURIComponent(credentialId), secret.stringData['state.json'])
        }
        return {}
      },
    },
    runtimeSecrets: {
      resolveWorkspaceManifest: async (_visibility: unknown, resources: Array<{ secretRef: string }>) => {
        const credentialId = /\/credentials\/([^/]+)/.exec(resources[0]?.secretRef ?? '')?.[1]
        return {
          root: '/workspace',
          mounts: [
            {
              type: 'secret',
              name: 'identity-checkpoint',
              mountPath: '/identity',
              readOnly: true,
              files: [
                {
                  path: 'state.json',
                  content: credentialId ? (secrets.get(decodeURIComponent(credentialId)) ?? '') : '',
                  mode: 0o400,
                },
              ],
            },
          ],
        }
      },
    },
  } as unknown as Deps
  return {
    deps,
    identities,
    initialize,
    provision,
    credentials,
    secrets,
    credentialCount: () => credentialCount,
    credentialCreates: (id: string) => credentialCreates.get(id) ?? 0,
    credentialFor: (identityId: string, purpose: string) =>
      [...credentials.values()].find(
        (value) => value.spec.metadata.identityId === identityId && value.spec.metadata.purpose === purpose,
      ) ?? null,
  }
}

const createInput = {
  name: 'Codex identity',
  description: null,
  username: 'reviewer',
  runtime: 'codex' as const,
  idempotencyKey: 'same-key',
  subjectToken: 'user-token',
}

describe('[CF] Identity concurrency invariants', () => {
  beforeEach(setupOidcProvider)

  it('allows one same-key provisioner and returns a stable conflict to the concurrent loser', async () => {
    const auth = await scope()
    let releaseInitialize!: () => void
    const initializeGate = new Promise<void>((resolve) => {
      releaseInitialize = resolve
    })
    const fx = provisioningHarness(auth, { initializeGate })

    const winner = createIdentity(fx.deps, auth, createInput)
    await vi.waitFor(() => expect(fx.initialize).toHaveBeenCalledOnce())
    await expect(createIdentity(fx.deps, auth, createInput)).rejects.toMatchObject({
      code: 'identity_provisioning_in_progress',
    })
    releaseInitialize()
    await expect(winner).resolves.toMatchObject({ status: { state: 'active' } })

    expect(fx.initialize).toHaveBeenCalledOnce()
    expect(fx.provision).toHaveBeenCalledOnce()
    expect(fx.credentialCount()).toBe(3)
  })

  it('does not let a stale owner failure overwrite the new owner active result', async () => {
    const auth = await scope()
    const repo = createIdentityRepo(drizzle(env.DB))
    const record = {
      id: 'identity_owner_race',
      projectId: auth.project.id,
      organizationId: auth.organization.id,
      name: 'Owner race',
      description: null,
      username: 'reviewer',
      runtime: 'codex' as const,
      vaultId: 'vault_owner_race',
      idempotencyKeyHash: 'owner-race-key',
      requestFingerprint: 'owner-race-request',
    }
    await repo.claim(record, 'owner_old', '2026-08-28T00:00:00.000Z', '2026-08-28T00:01:00.000Z')
    const takeover = await repo.claim(record, 'owner_new', '2026-08-28T00:02:00.000Z', '2026-08-28T00:07:00.000Z')
    expect(takeover.acquired).toBe(true)
    await repo.activate('identity_owner_race', 'owner_new', 'cred_final', descriptor('identity_owner_race'), timestamp)
    await repo.fail('identity_owner_race', 'owner_old', 'stale_failure', timestamp)

    await expect(repo.find(auth.project.id, 'identity_owner_race')).resolves.toMatchObject({
      status: { state: 'active', failureCode: null },
    })
  })

  it('reclaims an expired lease without replacing its checkpoint credential', async () => {
    const auth = await scope()
    const repo = createIdentityRepo(drizzle(env.DB))
    const record = {
      id: 'identity_lease_retry',
      projectId: auth.project.id,
      organizationId: auth.organization.id,
      name: 'Lease retry',
      description: null,
      username: 'reviewer',
      runtime: 'codex' as const,
      vaultId: 'vault_lease_retry',
      idempotencyKeyHash: 'lease-retry-key',
      requestFingerprint: 'lease-retry-request',
    }
    await repo.claim(record, 'owner_old', '2026-08-28T00:00:00.000Z', '2026-08-28T00:01:00.000Z')
    await repo.setCredential('identity_lease_retry', 'owner_old', 'cred_checkpoint', timestamp)
    const beforeExpiry = await repo.claim(record, 'owner_early', '2026-08-28T00:00:30.000Z', '2026-08-28T00:05:30.000Z')
    expect(beforeExpiry.acquired).toBe(false)
    const afterExpiry = await repo.claim(record, 'owner_retry', '2026-08-28T00:02:00.000Z', '2026-08-28T00:07:00.000Z')
    expect(afterExpiry.acquired).toBe(true)
    await expect(repo.provisioning('identity_lease_retry')).resolves.toMatchObject({
      credentialId: 'cred_checkpoint',
    })
  })

  it('retries an error with the stored checkpoint instead of initializing a new key', async () => {
    const auth = await scope()
    const failProvision = { value: true }
    const fx = provisioningHarness(auth, { failProvision })
    await expect(createIdentity(fx.deps, auth, createInput)).rejects.toMatchObject({
      code: 'realmroot_provisioning_failed',
    })
    failProvision.value = false
    await expect(createIdentity(fx.deps, auth, createInput)).resolves.toMatchObject({ status: { state: 'active' } })
    expect(fx.initialize).toHaveBeenCalledOnce()
    expect(fx.provision).toHaveBeenCalledTimes(2)
  })

  it('recovers a deterministic checkpoint committed before its Identity pointer', async () => {
    const auth = await scope()
    const failSetCredentialOnce = { value: true }
    const fx = provisioningHarness(auth, { failSetCredentialOnce })

    await expect(createIdentity(fx.deps, auth, createInput)).rejects.toMatchObject({
      code: 'identity_initialization_failed',
    })
    const row = await env.DB.prepare('SELECT id, credential_id FROM identities WHERE project_id = ?')
      .bind(auth.project.id)
      .first<{ id: string; credential_id: string | null }>()
    if (!row) throw new Error('Expected failed Identity')
    const checkpoint = fx.credentialFor(row.id, 'provisioning-checkpoint')
    expect(row.credential_id).toBeNull()
    expect(checkpoint).not.toBeNull()

    await expect(createIdentity(fx.deps, auth, createInput)).resolves.toMatchObject({ status: { state: 'active' } })
    expect(fx.initialize).toHaveBeenCalledOnce()
    expect(fx.credentialCreates(checkpoint!.metadata.uid)).toBe(1)
  })

  it('recovers a deterministic final credential committed before activation', async () => {
    const auth = await scope()
    const failActivateOnce = { value: true }
    const fx = provisioningHarness(auth, { failActivateOnce })

    await expect(createIdentity(fx.deps, auth, createInput)).rejects.toMatchObject({
      code: 'realmroot_provisioning_failed',
    })
    const row = await env.DB.prepare('SELECT id FROM identities WHERE project_id = ?')
      .bind(auth.project.id)
      .first<{ id: string }>()
    if (!row) throw new Error('Expected failed Identity')
    const finalCredential = fx.credentialFor(row.id, 'agent-state')
    expect(finalCredential).not.toBeNull()
    const committedFinalState = fx.secrets.get(finalCredential!.metadata.uid)
    expect(committedFinalState).toContain('agent_private_key')

    await expect(createIdentity(fx.deps, auth, createInput)).resolves.toMatchObject({ status: { state: 'active' } })
    expect(fx.initialize).toHaveBeenCalledOnce()
    expect(fx.credentialCreates(finalCredential!.metadata.uid)).toBe(1)
    expect(fx.secrets.get(finalCredential!.metadata.uid)).toBe(committedFinalState)
  })

  it('rejects a stale owner checkpoint CAS after takeover activation and preserves final state', async () => {
    const auth = await scope()
    let oldCheckpointWriter: ((checkpoint: IdentityCheckpoint) => Promise<void>) | null = null
    let rejectOldProvision!: (reason: Error) => void
    const oldProvision = new Promise<never>((_resolve, reject) => {
      rejectOldProvision = reject
    })
    let provisionCall = 0
    const fx = provisioningHarness(auth, {
      provision: async (input, next) => {
        provisionCall += 1
        if (provisionCall === 1) {
          oldCheckpointWriter = input.onCheckpoint
          await oldProvision
        }
        await input.onCheckpoint(next)
        return { checkpoint: next, descriptor: next.remote! }
      },
    })

    const staleOwner = createIdentity(fx.deps, auth, createInput)
    await vi.waitFor(() => expect(oldCheckpointWriter).not.toBeNull())
    await env.DB.prepare(
      "UPDATE identities SET provisioning_lease_expires_at = '2000-01-01T00:00:00.000Z' WHERE project_id = ?",
    )
      .bind(auth.project.id)
      .run()
    const winner = await createIdentity(fx.deps, auth, createInput)
    const finalCredential = fx.credentialFor(winner.metadata.uid, 'agent-state')
    expect(finalCredential).not.toBeNull()
    const finalState = fx.secrets.get(finalCredential!.metadata.uid)
    expect(finalState).toContain('agent_private_key')

    const staleWrite = oldCheckpointWriter
    if (!staleWrite) throw new Error('Expected stale checkpoint writer')
    await expect(staleWrite(enrolledCheckpoint())).rejects.toThrow('ownership was lost')
    expect(fx.secrets.get(finalCredential!.metadata.uid)).toBe(finalState)
    await expect(fx.identities.provisioning(winner.metadata.uid)).resolves.toMatchObject({
      credentialId: finalCredential!.metadata.uid,
    })

    rejectOldProvision(new Error('stale request terminated'))
    await expect(staleOwner).rejects.toMatchObject({ code: 'realmroot_provisioning_failed' })
    await expect(fx.identities.find(auth.project.id, winner.metadata.uid)).resolves.toMatchObject({
      status: { state: 'active' },
    })
  })

  it('serializes archive and bind in either order without an Agent pointing at an archived Identity', async () => {
    const auth = await scope()
    const db = drizzle(env.DB)
    const identities = createIdentityRepo(db)
    const agentRepo = createAgentRepo(db)
    const createActive = async (id: string) => {
      const record = {
        id,
        projectId: auth.project.id,
        organizationId: auth.organization.id,
        name: id,
        description: null,
        username: 'reviewer',
        runtime: 'codex' as const,
        vaultId: `vault_${id}`,
        idempotencyKeyHash: `key_${id}`,
        requestFingerprint: `request_${id}`,
      }
      await identities.claim(record, `owner_${id}`, timestamp, '2026-08-28T00:05:00.000Z')
      await identities.activate(id, `owner_${id}`, `cred_${id}`, descriptor(id), timestamp)
    }
    const spec = (id: string): AgentSpec => ({
      systemPrompt: 'Work.',
      provider: null,
      model: null,
      skills: [],
      subagents: [],
      allowedTools: [],
      mcpConnectors: [],
      identity: descriptor(id),
    })

    await createActive('identity_bind_first')
    const bound = await agentRepo.insertWithVersion(
      { projectId: auth.project.id, name: 'Bound first', description: null, spec: spec('identity_bind_first') },
      timestamp,
    )
    await expect(identities.archive(auth.project.id, 'identity_bind_first', timestamp)).resolves.toBe(false)
    expect((await agentRepo.find(auth.project.id, bound.agent.metadata.uid))?.spec.identity?.identityId).toBe(
      'identity_bind_first',
    )
    expect((await identities.find(auth.project.id, 'identity_bind_first'))?.metadata.archivedAt).toBeNull()

    await createActive('identity_archive_first')
    await expect(identities.archive(auth.project.id, 'identity_archive_first', timestamp)).resolves.toBe(true)
    await expect(
      agentRepo.insertWithVersion(
        { projectId: auth.project.id, name: 'Archive first', description: null, spec: spec('identity_archive_first') },
        timestamp,
      ),
    ).rejects.toMatchObject({ name: 'IdentityAlreadyBoundError' })
    expect((await identities.find(auth.project.id, 'identity_archive_first'))?.metadata.archivedAt).toBe(timestamp)
  })

  it('commits Agent/version binding atomically and leaves no orphan version after a binding race', async () => {
    const auth = await scope()
    const db = drizzle(env.DB)
    const identities = createIdentityRepo(db)
    const agentRepo = createAgentRepo(db)
    const identityId = 'identity_atomic_binding'
    const record = {
      id: identityId,
      projectId: auth.project.id,
      organizationId: auth.organization.id,
      name: 'Atomic binding',
      description: null,
      username: 'reviewer',
      runtime: 'codex' as const,
      vaultId: `vault_${identityId}`,
      idempotencyKeyHash: `key_${identityId}`,
      requestFingerprint: `request_${identityId}`,
    }
    await identities.claim(record, 'owner_atomic', timestamp, '2026-08-28T00:05:00.000Z')
    await identities.activate(identityId, 'owner_atomic', `cred_${identityId}`, descriptor(identityId), timestamp)
    const baseSpec = (identity: IdentityDescriptor | null): AgentSpec => ({
      systemPrompt: 'Work.',
      provider: null,
      model: null,
      skills: [],
      subagents: [],
      allowedTools: [],
      mcpConnectors: [],
      identity,
    })

    const owner = await agentRepo.insertWithVersion(
      { projectId: auth.project.id, name: 'Owner', description: null, spec: baseSpec(descriptor(identityId)) },
      timestamp,
    )
    await expect(agentRepo.listVersions(auth.project.id, owner.agent.metadata.uid)).resolves.toHaveLength(1)
    const countBeforeRejectedCreate = await env.DB.prepare(
      'SELECT (SELECT count(*) FROM agents) AS agents, (SELECT count(*) FROM agent_versions) AS versions',
    ).first<{ agents: number; versions: number }>()
    await expect(
      agentRepo.insertWithVersion(
        { projectId: auth.project.id, name: 'Loser', description: null, spec: baseSpec(descriptor(identityId)) },
        timestamp,
      ),
    ).rejects.toMatchObject({ name: 'IdentityAlreadyBoundError' })
    await expect(
      env.DB.prepare(
        'SELECT (SELECT count(*) FROM agents) AS agents, (SELECT count(*) FROM agent_versions) AS versions',
      ).first(),
    ).resolves.toEqual(countBeforeRejectedCreate)

    const unbound = await agentRepo.insertWithVersion(
      { projectId: auth.project.id, name: 'Unbound', description: null, spec: baseSpec(null) },
      timestamp,
    )
    await expect(
      agentRepo.updateWithVersion(
        auth.project.id,
        unbound.agent,
        {
          name: 'Unbound',
          description: null,
          archivedAt: null,
          spec: baseSpec(descriptor(identityId)),
        },
        '2026-08-28T00:01:00.000Z',
      ),
    ).rejects.toMatchObject({ name: 'IdentityAlreadyBoundError' })
    await expect(agentRepo.listVersions(auth.project.id, unbound.agent.metadata.uid)).resolves.toHaveLength(1)
    await expect(agentRepo.find(auth.project.id, unbound.agent.metadata.uid)).resolves.toMatchObject({
      spec: { identity: null },
      status: { currentVersionId: unbound.version.metadata.uid, version: 1 },
    })
  })
})

function descriptor(identityId: string): IdentityDescriptor {
  return {
    identityId,
    agentId: `rr_${identityId}`,
    issuer: 'https://realmroot.example/api/auth',
    subject: `rr_${identityId}`,
    username: 'reviewer',
    runtime: 'codex',
    credentialRef: `ama://vaults/vault_${identityId}/credentials/cred_${identityId}`,
  }
}
