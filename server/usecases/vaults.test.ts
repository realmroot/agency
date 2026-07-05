import { resourceMetadata } from '@server/domain/resource'
import type { Credential, CredentialVersion, Vault } from '@server/domain/vault'
import { describe, expect, it } from 'vitest'
import type { Deps } from './deps'
import { VaultSecretError } from './ports'
import { createCredential, rotateCredential } from './vaults'

function vault(
  overrides: {
    metadata?: Partial<Vault['metadata']>
    spec?: Partial<Vault['spec']>
    status?: Partial<Vault['status']>
  } = {},
): Vault {
  const timestamp = '2026-01-01T00:00:00.000Z'
  return {
    metadata: {
      ...resourceMetadata({
        uid: 'vault_1',
        pid: 'project_1',
        name: 'Vault',
        createdAt: timestamp,
        updatedAt: timestamp,
      }),
      ...overrides.metadata,
    },
    spec: { organizationId: 'org_1', scope: 'project', ...overrides.spec },
    status: { phase: 'active', ...overrides.status },
  }
}

function credential(
  overrides: {
    metadata?: Partial<Credential['metadata']>
    spec?: Partial<Credential['spec']>
    status?: Partial<Credential['status']>
  } = {},
): Credential {
  const timestamp = '2026-01-01T00:00:00.000Z'
  return {
    metadata: {
      ...resourceMetadata({
        uid: 'vaultcred_1',
        pid: 'project_1',
        name: 'Token',
        createdAt: timestamp,
        updatedAt: timestamp,
      }),
      ...overrides.metadata,
    },
    spec: { vaultId: 'vault_1', organizationId: 'org_1', type: 'opaque', metadata: {}, ...overrides.spec },
    status: {
      phase: 'active',
      activeVersionId: 'vaultver_1',
      revokedAt: null,
      revokedByUserId: null,
      revokeReason: null,
      ...overrides.status,
    },
  }
}

function version(
  overrides: {
    metadata?: Partial<CredentialVersion['metadata']>
    spec?: Partial<CredentialVersion['spec']>
    status?: Partial<CredentialVersion['status']>
  } = {},
): CredentialVersion {
  const timestamp = '2026-01-01T00:00:00.000Z'
  return {
    metadata: {
      ...resourceMetadata({
        uid: 'vaultver_2',
        pid: 'project_1',
        name: 'v2',
        createdAt: timestamp,
        updatedAt: timestamp,
      }),
      ...overrides.metadata,
    },
    spec: {
      credentialId: 'vaultcred_1',
      vaultId: 'vault_1',
      organizationId: 'org_1',
      version: 2,
      provider: 'ama',
      secretRef: 'ama://vaults/vault_x/credentials/cred_x/versions/ver_x',
      referenceName: 'X',
      hasSecret: true,
      metadata: {},
      ...overrides.spec,
    },
    status: { phase: 'active', supersededAt: null, revokedAt: null, ...overrides.status },
  }
}

function fakeDeps(
  overrides: { vaults?: Partial<Deps['vaults']>; secretStore?: Partial<Deps['secretStore']> } = {},
): Deps {
  const vaults: Deps['vaults'] = {
    list: async () => ({ rows: [], hasMore: false }),
    find: async () => null,
    insert: async () => vault(),
    update: async () => {},
    hasCredentials: async () => false,
    listCredentials: async () => ({ rows: [], hasMore: false }),
    findCredential: async () => null,
    activeVersion: async () => null,
    latestVersionNumber: async () => 1,
    insertCredentialWithVersion: async (cred, ver) => ({
      credential: credential({
        metadata: { uid: ver.credentialId, name: cred.name },
        status: { activeVersionId: ver.id },
      }),
      version: version({ metadata: { uid: ver.id }, spec: { version: ver.version } }),
    }),
    updateCredential: async () => {},
    listVersions: async () => ({ rows: [], hasMore: false }),
    findVersion: async () => null,
    insertVersionRotation: async (ver) => version({ metadata: { uid: ver.id }, spec: { version: ver.version } }),
    ...overrides.vaults,
  }
  const secretStore: Deps['secretStore'] = {
    store: async () => ({ encryptedSecretData: { value: 'cipher' } }),
    ...overrides.secretStore,
  }
  return {
    agents: undefined as unknown as Deps['agents'],
    environments: undefined as unknown as Deps['environments'],
    providers: undefined as unknown as Deps['providers'],
    providerCatalog: undefined as unknown as Deps['providerCatalog'],
    vaults,
    secretStore,
    connectors: undefined as unknown as Deps['connectors'],
    policies: undefined as unknown as Deps['policies'],
    budgets: undefined as unknown as Deps['budgets'],
    usageRecords: undefined as unknown as Deps['usageRecords'],
    auditRecords: undefined as unknown as Deps['auditRecords'],
    triggers: undefined as unknown as Deps['triggers'],
    triggerDispatch: undefined as unknown as Deps['triggerDispatch'],
    projects: undefined as unknown as Deps['projects'],
    federatedTenants: undefined as unknown as Deps['federatedTenants'],
    runners: undefined as unknown as Deps['runners'],
    workItems: undefined as unknown as Deps['workItems'],
    leases: undefined as unknown as Deps['leases'],
    runtimeSecrets: undefined as unknown as Deps['runtimeSecrets'],
    cloudTurnQueue: undefined as unknown as Deps['cloudTurnQueue'],
    runnerChannel: undefined as unknown as Deps['runnerChannel'],
    cloudRuntime: undefined as unknown as Deps['cloudRuntime'],
    runtimeWorkspace: undefined as unknown as Deps['runtimeWorkspace'],
    sandboxExecutor: undefined as unknown as Deps['sandboxExecutor'],
    amaTurnExecutor: undefined as unknown as Deps['amaTurnExecutor'],
    sessionOrchestration: undefined as unknown as Deps['sessionOrchestration'],
    sessionEventStore: undefined as unknown as Deps['sessionEventStore'],
    sessions: undefined as unknown as Deps['sessions'],
    createApprovalGate: undefined as unknown as Deps['createApprovalGate'],
    rereadStartedSession: false,
    audit: { record: async () => {} },
    policy: {
      resolveToolPolicy: async () => ({}),
      resolveMcpPolicy: async () => ({}),
      evaluateMcpTool: async () => ({ allowed: true, category: 'mcp', rule: null, message: '' }),
      resolveEffective: async () => ({
        source: { type: 'platform_default', id: 'workers-ai-default' },
        sources: [],
        toolPolicy: {},
        mcpPolicy: {},
        sandboxPolicy: {},
      }),
      evaluateProvider: async () => ({ allowed: true, category: 'provider', rule: null, message: '' }),
      evaluateSandboxRuntime: async () => ({ allowed: true, category: 'sandbox', rule: null, message: '' }),
      policyBlocksSandboxOperation: async () => null,
      toolPolicyRequiresApproval: async () => false,
      evaluateProviderForSession: async () => ({
        decision: { allowed: true, category: 'provider', rule: null, message: '' },
        override: null,
      }),
    },
  }
}

describe('[spec: vaults/credential-create] createCredential', () => {
  it('stores the secret and inserts the credential with its first version', async () => {
    let stored = false
    const deps = fakeDeps({
      secretStore: {
        store: async () => {
          stored = true
          return { encryptedSecretData: { value: 'cipher' } }
        },
      },
    })
    const result = await createCredential(deps, vault(), {
      name: 'Token',
      type: 'opaque',
      metadata: {},
      secret: { stringData: { value: 'raw' } },
    })
    expect(stored).toBe(true)
    expect(result.version.spec.version).toBe(1)
    expect(result.credential.status.activeVersionId).toBe(result.version.metadata.uid)
  })

  it('merges version metadata even when the secret store returns undefined', async () => {
    const deps = fakeDeps({
      secretStore: {
        store: async () => undefined as unknown as Record<string, unknown>,
      },
    })
    const result = await createCredential(deps, vault(), {
      name: 'Token',
      type: 'opaque',
      metadata: {},
      secret: { stringData: { value: 'raw' } },
    })
    expect(result.credential.status.activeVersionId).toBeDefined()
  })

  it('maps an invalid secret reference to a VaultSecretError', async () => {
    await expect(
      createCredential(fakeDeps(), vault(), {
        name: 'Token',
        type: 'opaque',
        metadata: {},
        secret: {},
      }),
    ).rejects.toBeInstanceOf(VaultSecretError)
  })

  it('maps a secret-store failure to a VaultSecretError', async () => {
    const deps = fakeDeps({
      secretStore: {
        store: async () => {
          throw new Error('Cloudflare secret storage failed')
        },
      },
    })
    await expect(
      createCredential(deps, vault(), {
        name: 'Token',
        type: 'opaque',
        metadata: {},
        secret: { stringData: { value: 'raw' } },
      }),
    ).rejects.toBeInstanceOf(VaultSecretError)
  })
})

describe('[spec: vaults/credential-rotate] rotateCredential', () => {
  it('creates the next version and supersedes the previous active version', async () => {
    let supersededOf: string | null | undefined
    const deps = fakeDeps({
      vaults: {
        latestVersionNumber: async () => 1,
        insertVersionRotation: async (ver, previous) => {
          supersededOf = previous
          return version({ metadata: { uid: ver.id }, spec: { version: ver.version } })
        },
      },
    })
    const result = await rotateCredential(deps, credential({ status: { activeVersionId: 'vaultver_1' } }), {
      stringData: { value: 'raw' },
    })
    expect(result.version.spec.version).toBe(2)
    expect(supersededOf).toBe('vaultver_1')
  })

  it('maps a secret-store failure during rotation to a VaultSecretError', async () => {
    const deps = fakeDeps({
      secretStore: {
        store: async () => {
          throw new Error('Cloudflare rotation storage failed')
        },
      },
    })
    await expect(rotateCredential(deps, credential(), { stringData: { value: 'raw' } })).rejects.toBeInstanceOf(
      VaultSecretError,
    )
  })
  it('uses a fallback message when the secret-store throws a non-Error during rotation', async () => {
    const deps = fakeDeps({
      secretStore: {
        store: async () => {
          throw 'string failure'
        },
      },
    })
    const error = await rotateCredential(deps, credential(), { stringData: { value: 'raw' } }).catch((e) => e)
    expect(error).toBeInstanceOf(VaultSecretError)
    expect(error.message).toBe('Invalid secret reference')
  })
})
