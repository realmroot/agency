import type { Identity, IdentityCheckpoint, IdentityDescriptor } from '@server/domain/identity'
import { resourceMetadata } from '@server/domain/resource'
import type { Credential, CredentialVersion, Vault } from '@server/domain/vault'
import { describe, expect, it, vi } from 'vitest'
import type { Deps } from './deps'
import { archiveIdentity, createIdentity, IdentityConflictError } from './identities'
import type { AuthScope } from './ports'

const timestamp = '2026-01-01T00:00:00.000Z'
const auth: AuthScope = {
  authenticationMethod: 'bearer',
  organization: { id: 'user:user_1', name: 'Personal' },
  project: { id: 'project_1', name: 'Project' },
  user: { id: 'user_1' },
  roles: [],
  permissions: [],
  oidc: { issuer: 'https://realmroot.example/api/auth', runnerId: null },
}

function vault(): Vault {
  return {
    metadata: resourceMetadata({
      uid: 'vault_identity',
      pid: 'project_1',
      name: 'Identity',
      createdAt: timestamp,
      updatedAt: timestamp,
    }),
    spec: { organizationId: 'user:user_1', scope: 'project' },
    status: { phase: 'active' },
  }
}

function identityRecord(
  values: {
    id?: string
    state?: Identity['status']['state']
    failureCode?: string | null
    descriptor?: IdentityDescriptor | null
    boundAgentId?: string | null
  } = {},
): Identity {
  return {
    metadata: resourceMetadata({
      uid: values.id ?? 'identity_1',
      pid: 'project_1',
      name: 'Codex identity',
      createdAt: timestamp,
      updatedAt: timestamp,
    }),
    spec: { username: 'reviewer', runtime: 'codex' },
    status: {
      phase: 'active',
      state: values.state ?? 'provisioning',
      failureCode: values.failureCode ?? null,
      boundAgentId: values.boundAgentId ?? null,
      descriptor: values.descriptor ?? null,
    },
  }
}

function credential(id: string, type: Credential['spec']['type']): Credential {
  return {
    metadata: resourceMetadata({ uid: id, pid: 'project_1', name: id, createdAt: timestamp, updatedAt: timestamp }),
    spec: { vaultId: 'vault_identity', organizationId: 'user:user_1', type, metadata: {} },
    status: {
      phase: 'active',
      activeVersionId: `ver_${id}`,
      revokedAt: null,
      revokedByUserId: null,
      revokeReason: null,
    },
  }
}

function version(id: string, credentialId: string, versionNumber: number): CredentialVersion {
  return {
    metadata: resourceMetadata({
      uid: id,
      pid: 'project_1',
      name: `v${versionNumber}`,
      createdAt: timestamp,
      updatedAt: timestamp,
    }),
    spec: {
      credentialId,
      vaultId: 'vault_identity',
      organizationId: 'user:user_1',
      version: versionNumber,
      provider: 'ama',
      secretRef: `ama://vaults/vault_identity/credentials/${credentialId}/versions/${id}`,
      referenceName: 'IDENTITY_STATE',
      hasSecret: true,
      metadata: {},
    },
    status: { phase: 'active', supersededAt: null, revokedAt: null },
  }
}

function enrolledCheckpoint(runtime = 'codex' as const): IdentityCheckpoint {
  const remote = {
    agentId: 'rr_agent_1',
    issuer: 'https://realmroot.example/api/auth',
    subject: 'rr_agent_1',
    username: 'reviewer',
    runtime,
  }
  return {
    version: 1,
    stage: 'enrolled',
    remote,
    state: {
      version: 18,
      origin: 'https://realmroot.example',
      issuer: remote.issuer,
      runtime,
      agent_id: remote.agentId,
      host_id: 'host_1',
      agent_key_id: 'key_1',
      agent_private_key: 'BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBw',
      enrollment_idempotency_key: 'idem-1',
      identity: {
        id: remote.agentId,
        issuer: remote.issuer,
        subject: remote.subject,
        username: remote.username,
        name: 'Codex identity',
        runtime,
      },
    },
  }
}

function fixture(
  options: {
    provisionFailure?: boolean | { value: boolean }
    exchangeFailure?: boolean | { value: boolean }
    checkpointJson?: string
  } = {},
) {
  let currentIdentity: Identity | null = null
  let keyHash = ''
  let requestFingerprint = ''
  let checkpointCredentialId: string | null = null
  let checkpointJson = options.checkpointJson ?? ''
  let credentialNumber = 0
  let provisioningOwner: string | null = null
  const credentials = new Map<string, Credential>()
  const initialize = vi.fn(
    async (): Promise<IdentityCheckpoint> => ({
      version: 1,
      stage: 'initialized',
      remote: null,
      state: { version: 18, runtime: 'codex', installation_private_key: 'checkpoint-secret' },
    }),
  )
  const provision = vi.fn(async (input: Parameters<NonNullable<Deps['realmrootEnrollment']>['provision']>[0]) => {
    if (
      options.provisionFailure === true ||
      (typeof options.provisionFailure === 'object' && options.provisionFailure.value)
    )
      throw new Error('remote unavailable')
    const checkpoint = enrolledCheckpoint()
    await input.onCheckpoint(checkpoint)
    return { checkpoint, descriptor: checkpoint.remote! }
  })
  const exchange = vi.fn(async () => {
    if (
      options.exchangeFailure === true ||
      (typeof options.exchangeFailure === 'object' && options.exchangeFailure.value)
    )
      throw new Error('authorization expired')
    return { headers: async () => ({ authorization: 'Bearer management' }) }
  })

  const deps = {
    identities: {
      list: async () => ({ rows: [], hasMore: false }),
      find: async () => currentIdentity,
      provisioning: async () =>
        currentIdentity
          ? { vaultId: 'vault_identity', credentialId: checkpointCredentialId, requestFingerprint }
          : null,
      claim: async (input: { id: string; idempotencyKeyHash: string; requestFingerprint: string }, owner: string) => {
        if (!currentIdentity) {
          keyHash = input.idempotencyKeyHash
          requestFingerprint = input.requestFingerprint
          provisioningOwner = owner
          currentIdentity = identityRecord({ id: input.id })
          return { identity: currentIdentity, acquired: true, requestFingerprint }
        }
        if (input.idempotencyKeyHash !== keyHash || input.requestFingerprint !== requestFingerprint) {
          return { identity: currentIdentity, acquired: false, requestFingerprint }
        }
        if (currentIdentity.status.state === 'error') {
          provisioningOwner = owner
          currentIdentity = identityRecord({ id: currentIdentity.metadata.uid })
          return { identity: currentIdentity, acquired: true, requestFingerprint }
        }
        return { identity: currentIdentity, acquired: false, requestFingerprint }
      },
      setCredential: async (_id: string, owner: string, id: string) => {
        if (owner !== provisioningOwner) throw new Error('Identity provisioning ownership was lost')
        checkpointCredentialId = id
      },
      activate: async (_id: string, owner: string, credentialId: string, descriptor: IdentityDescriptor) => {
        if (owner !== provisioningOwner) throw new Error('Identity provisioning ownership was lost')
        checkpointCredentialId = credentialId
        currentIdentity = identityRecord({ id: currentIdentity!.metadata.uid, state: 'active', descriptor })
        provisioningOwner = null
        return currentIdentity
      },
      fail: async (_id: string, owner: string, failureCode: string) => {
        if (owner !== provisioningOwner || currentIdentity?.status.state === 'active') return
        currentIdentity = identityRecord({ id: currentIdentity!.metadata.uid, state: 'error', failureCode })
        provisioningOwner = null
      },
      archive: async () => true,
    },
    realmrootEnrollment: { initialize, provision },
    realmrootManagement: { exchange },
    vaults: {
      insert: async () => vault(),
      find: async () => vault(),
      findIdentityManaged: async () => vault(),
      findCredential: async (_vaultId: string, id: string) => credentials.get(id) ?? null,
      latestVersionNumber: async () => 1,
      insertCredentialWithVersion: async (
        credInput: { type: Credential['spec']['type'] },
        verInput: { credentialId: string; id: string },
      ) => {
        credentialNumber += 1
        const created = credential(verInput.credentialId, credInput.type)
        credentials.set(verInput.credentialId, created)
        return { credential: created, version: version(verInput.id, verInput.credentialId, 1) }
      },
      insertVersionRotation: async (verInput: { id: string; credentialId: string; version: number }) =>
        version(verInput.id, verInput.credentialId, verInput.version),
    },
    secretStore: {
      store: async (_reference: unknown, secret: { stringData?: Record<string, string> }) => {
        if (secret.stringData?.['state.json']) checkpointJson = secret.stringData['state.json']
        return {}
      },
    },
    runtimeSecrets: {
      resolveWorkspaceManifest: async () => ({
        root: '/workspace',
        mounts: [
          {
            type: 'secret',
            name: 'identity-checkpoint',
            mountPath: '/identity',
            readOnly: true,
            files: [{ path: 'state.json', content: checkpointJson, mode: 0o400 }],
          },
        ],
      }),
    },
    agents: { find: async () => null },
  } as unknown as Deps

  return {
    deps,
    initialize,
    provision,
    exchange,
    getIdentity: () => currentIdentity,
    getCheckpoint: () => checkpointJson,
    setCheckpoint: (value: string) => {
      checkpointJson = value
    },
    credentialCount: () => credentialNumber,
  }
}

const input = {
  name: 'Codex identity',
  description: null,
  username: 'reviewer',
  runtime: 'codex' as const,
  idempotencyKey: 'idem-1',
  subjectToken: 'user-access-token',
}

describe('[spec: identities/provision] createIdentity', () => {
  it('persists the private checkpoint, exchanges user authority, and activates a safe descriptor', async () => {
    const fx = fixture()
    const result = await createIdentity(fx.deps, auth, input)

    expect(fx.initialize).toHaveBeenCalledWith(expect.objectContaining({ runtime: 'codex', username: 'reviewer' }))
    expect(fx.exchange).toHaveBeenCalledWith({ subjectToken: 'user-access-token', subject: 'user_1' })
    expect(fx.provision).toHaveBeenCalledWith(expect.objectContaining({ runtime: 'codex', idempotencyKey: 'idem-1' }))
    expect(result.status.state).toBe('active')
    expect(result.status.descriptor).toMatchObject({ runtime: 'codex', username: 'reviewer', agentId: 'rr_agent_1' })
    expect(JSON.stringify(result)).not.toContain('checkpoint-secret')
    expect(JSON.stringify(result)).not.toContain('agent_private_key')
    expect(fx.credentialCount()).toBe(3)
  })

  it('[spec: identities/idempotent-resume] returns an active Identity without creating another key or Remote Agent', async () => {
    const fx = fixture()
    const first = await createIdentity(fx.deps, auth, input)
    const second = await createIdentity(fx.deps, auth, input)

    expect(second).toEqual(first)
    expect(fx.initialize).toHaveBeenCalledTimes(1)
    expect(fx.provision).toHaveBeenCalledTimes(1)
  })

  it('[spec: identities/idempotent-resume] rejects reusing a key for a different request', async () => {
    const fx = fixture()
    await createIdentity(fx.deps, auth, input)
    await expect(createIdentity(fx.deps, auth, { ...input, username: 'different' })).rejects.toBeInstanceOf(
      IdentityConflictError,
    )
    await expect(createIdentity(fx.deps, auth, { ...input, username: 'different' })).rejects.toMatchObject({
      code: 'idempotency_conflict',
    })
  })

  it('[spec: identities/idempotent-resume] keeps a safe failure code when authorization exchange fails', async () => {
    const fx = fixture({ exchangeFailure: true })
    await expect(createIdentity(fx.deps, auth, input)).rejects.toMatchObject({
      name: 'IdentityProvisioningError',
      code: 'realmroot_authorization_failed',
    })
    expect(fx.getIdentity()?.status).toMatchObject({ state: 'error', failureCode: 'realmroot_authorization_failed' })
    expect(fx.getCheckpoint()).toContain('checkpoint-secret')
  })

  it('[spec: identities/idempotent-resume] preserves the same checkpoint when Remote provisioning fails', async () => {
    const fx = fixture({ provisionFailure: true })
    await expect(createIdentity(fx.deps, auth, input)).rejects.toMatchObject({ code: 'realmroot_provisioning_failed' })
    expect(fx.initialize).toHaveBeenCalledTimes(1)
    expect(fx.getCheckpoint()).toContain('checkpoint-secret')
  })

  it('resumes an authorization failure from the persisted checkpoint', async () => {
    const exchangeFailure = { value: true }
    const fx = fixture({ exchangeFailure })
    await expect(createIdentity(fx.deps, auth, input)).rejects.toMatchObject({ code: 'realmroot_authorization_failed' })
    exchangeFailure.value = false
    await expect(createIdentity(fx.deps, auth, input)).resolves.toMatchObject({ status: { state: 'active' } })
    expect(fx.initialize).toHaveBeenCalledOnce()
  })

  it('returns a stable conflict while another request owns the provisioning lease', async () => {
    const fx = fixture()
    const claim = fx.deps.identities!.claim
    fx.deps.identities!.claim = async (...args) => ({ ...(await claim(...args)), acquired: false })
    await expect(createIdentity(fx.deps, auth, input)).rejects.toMatchObject({
      code: 'identity_provisioning_in_progress',
    })
    expect(fx.initialize).not.toHaveBeenCalled()
  })

  it.each([
    'identities',
    'realmrootEnrollment',
    'realmrootManagement',
  ] as const)('fails fast when %s dependencies are absent', async (dependency) => {
    const fx = fixture()
    const deps = { ...fx.deps, [dependency]: undefined } as unknown as Deps
    await expect(createIdentity(deps, auth, input)).rejects.toThrow('Identity dependencies are not configured')
  })

  it('maps a missing Realmroot issuer to a safe initialization failure', async () => {
    const fx = fixture()
    const { oidc: _oidc, ...authWithoutOidc } = auth
    await expect(createIdentity(fx.deps, authWithoutOidc, input)).rejects.toMatchObject({
      code: 'identity_initialization_failed',
    })
    expect(fx.getIdentity()?.status.failureCode).toBe('identity_initialization_failed')
  })

  it('maps a missing provisioning location to a safe initialization failure', async () => {
    const fx = fixture()
    fx.deps.identities!.provisioning = async () => null
    await expect(createIdentity(fx.deps, auth, input)).rejects.toMatchObject({
      code: 'identity_initialization_failed',
    })
  })

  it('creates the deterministic managed Vault when it does not exist', async () => {
    const fx = fixture()
    let lookup = 0
    const insert = vi.fn(async () => vault())
    fx.deps.vaults.findIdentityManaged = async () => {
      lookup += 1
      return lookup === 1 ? null : vault()
    }
    fx.deps.vaults.insert = insert
    await expect(createIdentity(fx.deps, auth, input)).resolves.toMatchObject({ status: { state: 'active' } })
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'vault_identity', managedBy: 'identity' }),
      expect.any(String),
    )
  })

  it('initializes when the checkpoint lookup loses its provisioning row', async () => {
    const fx = fixture()
    const provisioning = fx.deps.identities!.provisioning
    let calls = 0
    fx.deps.identities!.provisioning = async (...args) => {
      calls += 1
      return calls === 2 ? null : provisioning(...args)
    }
    await expect(createIdentity(fx.deps, auth, input)).resolves.toMatchObject({ status: { state: 'active' } })
    expect(fx.initialize).toHaveBeenCalledOnce()
  })

  it('rejects an unavailable persisted checkpoint manifest', async () => {
    const exchangeFailure = { value: true }
    const fx = fixture({ exchangeFailure })
    await expect(createIdentity(fx.deps, auth, input)).rejects.toMatchObject({ code: 'realmroot_authorization_failed' })
    exchangeFailure.value = false
    fx.deps.runtimeSecrets.resolveWorkspaceManifest = async () => ({ root: '/workspace', mounts: [] })
    await expect(createIdentity(fx.deps, auth, input)).rejects.toMatchObject({ code: 'identity_initialization_failed' })
  })

  it('recovers a committed deterministic checkpoint before generating another key', async () => {
    const fx = fixture({
      checkpointJson: JSON.stringify({
        version: 1,
        stage: 'initialized',
        remote: null,
        state: { version: 18, runtime: 'codex', installation_private_key: 'recovered-key' },
      }),
    })
    const findCredential = fx.deps.vaults.findCredential
    fx.deps.vaults.findCredential = async (vaultId, credentialId) =>
      credentialId.startsWith('vaultcred_checkpoint_')
        ? credential(credentialId, 'opaque')
        : findCredential(vaultId, credentialId)
    await expect(createIdentity(fx.deps, auth, input)).resolves.toMatchObject({ status: { state: 'active' } })
    expect(fx.initialize).not.toHaveBeenCalled()
  })

  it('fails safely when checkpoint persistence loses its owner location', async () => {
    const fx = fixture()
    const provisioning = fx.deps.identities!.provisioning
    let calls = 0
    fx.deps.identities!.provisioning = async (...args) => {
      calls += 1
      return calls === 3 ? null : provisioning(...args)
    }
    await expect(createIdentity(fx.deps, auth, input)).rejects.toMatchObject({ code: 'realmroot_provisioning_failed' })
  })

  it('fails safely when managed Vault access disappears during checkpoint persistence', async () => {
    const fx = fixture()
    fx.deps.realmrootEnrollment!.provision = async (request) => {
      delete fx.deps.vaults.findIdentityManaged
      await request.onCheckpoint(enrolledCheckpoint())
      throw new Error('unreachable')
    }
    await expect(createIdentity(fx.deps, auth, input)).rejects.toMatchObject({ code: 'realmroot_provisioning_failed' })
  })

  it('fails safely when the managed Vault disappears during checkpoint persistence', async () => {
    const fx = fixture()
    let lookups = 0
    fx.deps.vaults.findIdentityManaged = async () => {
      lookups += 1
      return lookups === 2 ? null : vault()
    }
    await expect(createIdentity(fx.deps, auth, input)).rejects.toMatchObject({ code: 'realmroot_provisioning_failed' })
  })

  it('reuses deterministic enrolled and final credentials after a crash', async () => {
    const fx = fixture()
    const findCredential = fx.deps.vaults.findCredential
    fx.deps.vaults.findCredential = async (vaultId, credentialId) =>
      credentialId.startsWith('vaultcred_enrolled_')
        ? credential(credentialId, 'opaque')
        : credentialId.startsWith('vaultcred_state_')
          ? credential(credentialId, 'ama.dev/realmroot-agent-state')
          : findCredential(vaultId, credentialId)
    await expect(createIdentity(fx.deps, auth, input)).resolves.toMatchObject({ status: { state: 'active' } })
    expect(fx.credentialCount()).toBe(1)
  })

  it('fails safely when the final provisioning location loses its checkpoint pointer', async () => {
    const fx = fixture()
    const provisioning = fx.deps.identities!.provisioning
    let calls = 0
    fx.deps.identities!.provisioning = async (...args) => {
      calls += 1
      return calls === 4 ? null : provisioning(...args)
    }
    await expect(createIdentity(fx.deps, auth, input)).rejects.toMatchObject({ code: 'realmroot_provisioning_failed' })
  })

  it('fails safely when managed Vault access disappears before final activation', async () => {
    const fx = fixture()
    fx.deps.realmrootEnrollment!.provision = async (request) => {
      const checkpoint = enrolledCheckpoint()
      await request.onCheckpoint(checkpoint)
      delete fx.deps.vaults.findIdentityManaged
      return { checkpoint, descriptor: checkpoint.remote! }
    }
    await expect(createIdentity(fx.deps, auth, input)).rejects.toMatchObject({ code: 'realmroot_provisioning_failed' })
  })

  it('fails safely when the managed Vault disappears before final activation', async () => {
    const fx = fixture()
    let lookups = 0
    fx.deps.vaults.findIdentityManaged = async () => {
      lookups += 1
      return lookups === 3 ? null : vault()
    }
    await expect(createIdentity(fx.deps, auth, input)).rejects.toMatchObject({ code: 'realmroot_provisioning_failed' })
  })

  it('fails provisioning when a recovered checkpoint has no issuer for the Remote call', async () => {
    const fx = fixture({
      checkpointJson: JSON.stringify({
        version: 1,
        stage: 'initialized',
        remote: null,
        state: { version: 18, runtime: 'codex' },
      }),
    })
    const findCredential = fx.deps.vaults.findCredential
    fx.deps.vaults.findCredential = async (vaultId, credentialId) =>
      credentialId.startsWith('vaultcred_checkpoint_')
        ? credential(credentialId, 'opaque')
        : findCredential(vaultId, credentialId)
    const { oidc: _oidc, ...authWithoutOidc } = auth
    await expect(createIdentity(fx.deps, authWithoutOidc, input)).rejects.toMatchObject({
      code: 'realmroot_provisioning_failed',
    })
  })

  it('[spec: identities/personal-only] rejects organization projects with the stable conflict', async () => {
    const fx = fixture()
    await expect(
      createIdentity(fx.deps, { ...auth, organization: { id: 'org_1', name: 'Org' } }, input),
    ).rejects.toMatchObject({
      name: 'IdentityConflictError',
      code: 'organization_identity_not_supported',
    })
    expect(fx.initialize).not.toHaveBeenCalled()
  })

  it.each([
    { agentActor: { issuer: 'https://realmroot.example/api/auth', subject: 'agent_1' } },
    { oidc: { issuer: 'https://realmroot.example/api/auth', runnerId: 'runner_1' } },
  ])('[spec: identities/personal-only] requires a User principal', async (principal) => {
    const fx = fixture()
    await expect(createIdentity(fx.deps, { ...auth, ...principal }, input)).rejects.toMatchObject({
      code: 'user_principal_required',
    })
  })
})

describe('[spec: identities/archive] archiveIdentity', () => {
  const selectedIdentity = identityRecord({
    state: 'active',
    boundAgentId: 'agent_1',
    descriptor: {
      identityId: 'identity_1',
      agentId: 'rr_agent_1',
      issuer: 'https://realmroot.example/api/auth',
      subject: 'rr_agent_1',
      username: 'reviewer',
      runtime: 'codex',
      credentialRef: 'ama://vaults/vault_identity/credentials/cred_state',
    },
  })

  function archiveDeps(selectedIdentityId: string | null) {
    const archive = vi.fn(async () => selectedIdentityId !== 'identity_1')
    const deps = {
      identities: { archive },
      realmrootEnrollment: { initialize: vi.fn(), provision: vi.fn() },
      realmrootManagement: { exchange: vi.fn() },
    } as unknown as Deps
    return { deps, archive }
  }

  it('returns identity_in_use while the bound Agent is currently selecting the Identity', async () => {
    const fx = archiveDeps('identity_1')
    await expect(archiveIdentity(fx.deps, auth, selectedIdentity)).rejects.toMatchObject({
      name: 'IdentityConflictError',
      code: 'identity_in_use',
    })
    expect(fx.archive).toHaveBeenCalledOnce()
  })

  it('archives an old Identity after the Agent switches without a Remote deletion call', async () => {
    const fx = archiveDeps('identity_2')
    await archiveIdentity(fx.deps, auth, selectedIdentity)
    expect(fx.archive).toHaveBeenCalledOnce()
    expect(fx.archive).toHaveBeenCalledWith('project_1', 'identity_1', expect.any(String))
    expect(fx.deps).not.toHaveProperty('realmrootEnrollment.delete')
  })
})
