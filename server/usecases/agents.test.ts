import type { Agent, AgentSpec, AgentVersion, RealmrootAgentIdentity } from '@server/domain/agent'
import { resourceMetadata } from '@server/domain/resource'
import { describe, expect, it } from 'vitest'
import { createAgent as createReadyAgent, updateAgent } from './agents'
import type { Deps } from './deps'
import { AgentArchivedError, AgentInUseError, type AuditEntry, type AuthScope } from './ports'

const auth: AuthScope = {
  organization: { id: 'org_1', name: 'Org' },
  project: { id: 'project_1', name: 'Project' },
  user: { id: 'user_1' },
  roles: [],
  permissions: [],
}

function spec(overrides: Partial<AgentSpec> = {}): AgentSpec {
  return {
    runtime: 'codex',
    systemPrompt: 'Do the work.',
    provider: null,
    model: null,
    skills: [],
    subagents: [],
    allowedTools: ['read', 'bash'],
    mcpConnectors: [],
    ...overrides,
  }
}

function withRealmrootVault(
  deps: Deps,
  values: { vaultPhase?: 'active' | 'revoked'; credentialPhase?: 'active' | 'revoked'; type?: string } = {},
) {
  deps.vaults = {
    find: async () =>
      values.vaultPhase === 'revoked' ? null : ({ status: { phase: values.vaultPhase ?? 'active' } } as never),
    findCredential: async () => ({
      spec: { vaultId: 'vault_1', type: values.type ?? 'ama.dev/realmroot-agent-state' },
      status: { phase: values.credentialPhase ?? 'active' },
    }),
  } as never
  return deps
}

const realmroot = {
  issuer: 'https://realmroot.example.com/api/auth',
  subject: 'agt_worker',
  username: 'worker',
  runtime: 'codex' as const,
  credentialRef: 'ama://vaults/vault_1/credentials/cred_1',
}

function agentRecord(
  overrides: {
    metadata?: Partial<Agent['metadata']>
    spec?: Partial<Agent['spec']>
    status?: Partial<Agent['status']>
  } = {},
): Agent {
  const timestamp = '2026-01-01T00:00:00.000Z'
  return {
    metadata: {
      ...resourceMetadata({
        uid: 'agent_1',
        pid: 'project_1',
        name: 'Agent',
        createdAt: timestamp,
        updatedAt: timestamp,
      }),
      ...overrides.metadata,
    },
    identity: realmroot,
    spec: { ...spec(), ...overrides.spec },
    status: {
      phase: 'active',
      ready: true,
      currentVersionId: 'agentver_1',
      version: 1,
      ...overrides.status,
    },
  }
}

function agentVersion(agent: Agent, value: AgentSpec, createdAt: string, values: Partial<AgentVersion> = {}) {
  return {
    metadata: resourceMetadata({
      uid: 'agentver_new',
      pid: agent.metadata.pid,
      name: 'v2',
      createdAt,
      updatedAt: createdAt,
    }),
    spec: value,
    status: { agentId: agent.metadata.uid, version: 2 },
    ...values,
  } satisfies AgentVersion
}

function fakeDeps(overrides: { repo?: Partial<Deps['agents']>; audit?: AuditEntry[] } = {}): Deps {
  const auditLog = overrides.audit ?? []
  const repo: Deps['agents'] = {
    list: async () => ({ rows: [], hasMore: false }),
    find: async () => null,
    liveAgents: async () => [],
    latestVersionNumber: async () => null,
    insertVersion: async (agent, value, createdAt): Promise<AgentVersion> => agentVersion(agent, value, createdAt),
    listVersions: async () => [],
    findVersion: async () => null,
    insert: async (input, createdAt): Promise<Agent> =>
      agentRecord({
        metadata: {
          uid: 'agent_new',
          name: input.name,
          description: input.description,
          createdAt,
          updatedAt: createdAt,
        },
        spec: input.spec,
        status: { currentVersionId: null, version: 0 },
      }),
    createWithInitialVersion: async () => agentRecord(),
    setCurrentVersion: async () => {},
    update: async () => {},
    unarchive: async () => {},
    delete: async () => {},
    providerEnabled: async () => true,
    connectorAvailable: async () => true,
    ...overrides.repo,
  }
  return {
    agents: repo,
    environments: undefined as unknown as Deps['environments'],
    providers: undefined as unknown as Deps['providers'],
    providerCatalog: undefined as unknown as Deps['providerCatalog'],
    vaults: withRealmrootVault({} as Deps).vaults,
    secretStore: undefined as unknown as Deps['secretStore'],
    connectors: undefined as unknown as Deps['connectors'],
    policies: undefined as unknown as Deps['policies'],
    budgets: undefined as unknown as Deps['budgets'],
    usageRecords: undefined as unknown as Deps['usageRecords'],
    auditRecords: undefined as unknown as Deps['auditRecords'],
    triggers: undefined as unknown as Deps['triggers'],
    triggerDispatch: undefined as unknown as Deps['triggerDispatch'],
    projects: undefined as unknown as Deps['projects'],
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
    audit: { record: async (_auth, entry) => void auditLog.push(entry) },
    policy: undefined as unknown as Deps['policy'],
  }
}

function createAgent(
  deps: Deps,
  scope: AuthScope,
  input: { name: string; description: string | null; spec: AgentSpec; identity?: RealmrootAgentIdentity },
) {
  return createReadyAgent(deps, scope, {
    username: input.identity?.username ?? realmroot.username,
    identity: input.identity ?? realmroot,
    name: input.name,
    description: input.description,
    spec: input.spec,
  })
}

describe('[spec: agents/create] createAgent', () => {
  it('inserts the agent, snapshots version 1, and sets it current', async () => {
    const setCurrent: string[] = []
    const deps = fakeDeps({
      repo: { setCurrentVersion: async (_agentId, versionId) => void setCurrent.push(versionId) },
    })
    const agent = await createAgent(deps, auth, { name: 'Research', description: null, spec: spec() })
    expect(agent.status.currentVersionId).toBe('agentver_new')
    expect(agent.status.version).toBe(2)
    expect(setCurrent).toEqual(['agentver_new'])
  })

  it('rejects an empty system prompt', async () => {
    await expect(
      createAgent(fakeDeps(), auth, { name: 'x', description: null, spec: spec({ systemPrompt: '   ' }) }),
    ).rejects.toMatchObject({ fields: { systemPrompt: 'System prompt is required.' } })
  })

  it.each([
    ['claude-code', 'openai'],
    ['codex', 'anthropic'],
    ['copilot', 'openai'],
  ] as const)('rejects provider %s/%s when the immutable runtime does not support its vendor', async (runtime, provider) => {
    await expect(
      createAgent(fakeDeps(), auth, {
        name: 'Unsupported vendor',
        description: null,
        spec: spec({ runtime, provider }),
      }),
    ).rejects.toMatchObject({ fields: { provider: expect.stringContaining(`Runtime ${runtime}`) } })
  })

  it.each([
    ['ama', 'custom-vendor'],
    ['claude-code', 'anthropic'],
    ['codex', 'openai'],
    ['copilot', 'github-copilot'],
  ] as const)('accepts provider %s/%s when supported by the immutable runtime', async (runtime, provider) => {
    const created = await createAgent(fakeDeps(), auth, {
      name: 'Supported vendor',
      description: null,
      identity: { ...realmroot, runtime },
      spec: spec({ runtime, provider }),
    })
    expect(created.spec).toMatchObject({ runtime, provider })
  })

  it('normalizes the legacy workers-ai transport alias before persisting the Agent and version', async () => {
    let providerChecks = 0
    const inserted: AgentSpec[] = []
    const versioned: AgentSpec[] = []
    const deps = fakeDeps({
      repo: {
        providerEnabled: async () => {
          providerChecks += 1
          return false
        },
        insert: async (input, createdAt) => {
          inserted.push(input.spec)
          return agentRecord({
            metadata: {
              uid: 'agent_new',
              name: input.name,
              description: input.description,
              createdAt,
              updatedAt: createdAt,
            },
            spec: input.spec,
            status: { currentVersionId: null, version: 0 },
          })
        },
        insertVersion: async (agent, value, createdAt) => {
          versioned.push(value)
          return agentVersion(agent, value, createdAt)
        },
      },
    })
    const agent = await createAgent(deps, auth, {
      name: 'x',
      description: null,
      spec: spec({ provider: 'workers-ai' }),
    })

    expect(providerChecks).toBe(0)
    expect(inserted).toHaveLength(1)
    expect(inserted[0]?.provider).toBeNull()
    expect(versioned).toHaveLength(1)
    expect(versioned[0]?.provider).toBeNull()
    expect(agent.spec.provider).toBeNull()
  })

  it('rejects a real unknown vendor reference', async () => {
    let providerChecks = 0
    const deps = fakeDeps({
      repo: {
        providerEnabled: async () => {
          providerChecks += 1
          return false
        },
      },
    })
    await expect(
      createAgent(deps, auth, { name: 'x', description: null, spec: spec({ provider: 'unknown-vendor' }) }),
    ).rejects.toMatchObject({ fields: { provider: expect.any(String) } })
    expect(providerChecks).toBe(1)
  })

  it('accepts a non-catalog model because model validity is resolved at session creation', async () => {
    const agent = await createAgent(fakeDeps(), auth, {
      name: 'x',
      description: null,
      spec: spec({ provider: 'openai', model: 'opus' }),
    })
    expect(agent.spec.model).toBe('opus')
  })

  it('rejects model and sub-agent model vendors unsupported by the immutable runtime', async () => {
    await expect(
      createAgent(fakeDeps(), auth, {
        name: 'x',
        description: null,
        identity: { ...realmroot, runtime: 'codex' },
        spec: spec({ runtime: 'codex', provider: 'openai', model: 'anthropic/claude-opus' }),
      }),
    ).rejects.toMatchObject({ fields: { model: expect.any(String) } })

    await expect(
      createAgent(fakeDeps(), auth, {
        name: 'x',
        description: null,
        identity: { ...realmroot, runtime: 'codex' },
        spec: spec({ runtime: 'codex', provider: null, model: 'anthropic/claude-opus' }),
      }),
    ).rejects.toMatchObject({ fields: { model: expect.any(String) } })

    await expect(
      createAgent(fakeDeps(), auth, {
        name: 'x',
        description: null,
        identity: { ...realmroot, runtime: 'codex' },
        spec: spec({
          runtime: 'codex',
          subagents: [
            {
              name: 'reviewer',
              description: 'Reviews the work.',
              systemPrompt: 'Review the work.',
              model: 'anthropic/claude-opus',
              allowedTools: ['read'],
              skills: [],
              mcpConnectors: [],
            },
          ],
        }),
      }),
    ).rejects.toMatchObject({ fields: { subagents: expect.any(String) } })
  })

  it('exposes the deletion conflict error used by the HTTP boundary', () => {
    expect(new AgentInUseError()).toMatchObject({
      name: 'AgentInUseError',
      message: 'Agent cannot be deleted while Sessions or Triggers reference it',
    })
  })

  it('rejects a disconnected MCP connector', async () => {
    const deps = fakeDeps({ repo: { connectorAvailable: async () => false } })
    await expect(
      createAgent(deps, auth, { name: 'x', description: null, spec: spec({ mcpConnectors: ['github'] }) }),
    ).rejects.toMatchObject({ fields: { mcpConnectors: expect.any(String) } })
  })

  it('rejects invalid allowed tools', async () => {
    await expect(
      createAgent(fakeDeps(), auth, { name: 'x', description: null, spec: spec({ allowedTools: ['repo.delete'] }) }),
    ).rejects.toMatchObject({ fields: { allowedTools: expect.stringContaining('not supported') } })
  })

  it('rejects duplicate allowed tools', async () => {
    await expect(
      createAgent(fakeDeps(), auth, { name: 'x', description: null, spec: spec({ allowedTools: ['read', 'read'] }) }),
    ).rejects.toMatchObject({ fields: { allowedTools: expect.stringContaining('more than once') } })
  })

  it('rejects an invalid skill reference format', async () => {
    await expect(
      createAgent(fakeDeps(), auth, {
        name: 'x',
        description: null,
        spec: spec({ skills: ['not-a-valid-skill'] }),
      }),
    ).rejects.toMatchObject({ fields: { skills: expect.any(String) } })
  })

  it('rejects invalid sub-agent definitions', async () => {
    await expect(
      createAgent(fakeDeps(), auth, {
        name: 'x',
        description: null,
        spec: spec({
          subagents: [
            {
              name: 'has space',
              description: 'Reviews the work.',
              systemPrompt: 'Review the work.',
              model: null,
              allowedTools: ['read'],
              skills: [],
              mcpConnectors: [],
            },
          ],
        }),
      }),
    ).rejects.toMatchObject({ fields: { subagents: expect.any(String) } })
  })

  it('rejects unavailable sub-agent MCP connectors', async () => {
    await expect(
      createAgent(fakeDeps({ repo: { connectorAvailable: async () => false } }), auth, {
        name: 'x',
        description: null,
        spec: spec({
          subagents: [
            {
              name: 'reviewer',
              description: 'Reviews the work.',
              systemPrompt: 'Review the work.',
              model: null,
              allowedTools: ['read'],
              skills: [],
              mcpConnectors: ['missing-connector'],
            },
          ],
        }),
      }),
    ).rejects.toMatchObject({ fields: { subagents: expect.stringContaining('MCP connector') } })
  })
})

describe('[spec: agents/realmroot-binding] Realmroot Agent binding', () => {
  it('accepts a visible active Realmroot state credential', async () => {
    const created = await createAgent(withRealmrootVault(fakeDeps()), auth, {
      name: 'Realmroot agent',
      description: null,
      identity: realmroot,
      spec: spec(),
    })

    expect(created.identity).toEqual(realmroot)
  })

  it('rejects a Realmroot identity whose runtime differs from the Agent runtime', async () => {
    await expect(
      createAgent(withRealmrootVault(fakeDeps()), auth, {
        name: 'Realmroot agent',
        description: null,
        identity: { ...realmroot, runtime: 'claude-code' },
        spec: spec({ runtime: 'codex' }),
      }),
    ).rejects.toMatchObject({ fields: { identity: expect.stringContaining('runtime') } })
  })

  it.each([
    [{ ...realmroot, issuer: 'http://realmroot.example.com' }, 'HTTPS'],
    [{ ...realmroot, credentialRef: 'external://secret' }, 'AMA Vault'],
    [{ ...realmroot, credentialRef: 'ama://vaults/vault_1' }, 'active credential'],
    [{ ...realmroot, credentialRef: 'ama://vaults/vault_1/credentials/cred_1/versions/ver_1' }, 'active credential'],
  ])('rejects an invalid or non-credential-scoped binding %#', async (binding, message) => {
    await expect(
      createAgent(withRealmrootVault(fakeDeps()), auth, {
        name: 'Realmroot agent',
        description: null,
        identity: binding,
        spec: spec(),
      }),
    ).rejects.toMatchObject({ fields: { identity: expect.stringContaining(message) } })
  })

  it.each([
    ['revoked credential', { credentialPhase: 'revoked' }],
    ['invisible vault', { vaultPhase: 'revoked' }],
    ['wrong credential type', { type: 'opaque' }],
  ])('rejects a %s', async (_name, values) => {
    await expect(
      createAgent(withRealmrootVault(fakeDeps(), values as never), auth, {
        name: 'Realmroot agent',
        description: null,
        identity: realmroot,
        spec: spec(),
      }),
    ).rejects.toMatchObject({ fields: { identity: expect.stringContaining('active credential') } })
  })

  it('keeps the stable identity immutable across profile updates', async () => {
    const before = agentRecord()
    const result = await updateAgent(withRealmrootVault(fakeDeps()), auth, before, { name: 'Renamed' })
    expect(result.agent.identity).toEqual(before.identity)
  })
})

describe('[spec: agents/update] updateAgent', () => {
  it('snapshots a new version when an editable Agent spec field changes', async () => {
    const inserted: AgentSpec[] = []
    const deps = fakeDeps({
      repo: {
        insertVersion: async (agent, value, createdAt) => {
          inserted.push(value)
          return agentVersion(agent, value, createdAt, {
            metadata: resourceMetadata({
              uid: 'agentver_2',
              pid: agent.metadata.pid,
              name: 'v2',
              createdAt,
              updatedAt: createdAt,
            }),
          })
        },
      },
    })
    const result = await updateAgent(deps, auth, agentRecord(), { systemPrompt: 'New' })
    expect(inserted).toHaveLength(1)
    expect(result.agent.status.version).toBe(2)
    expect(result.agent.status.currentVersionId).toBe('agentver_2')
    expect(result.agent.spec.systemPrompt).toBe('New')
  })

  it('does not snapshot when only name or description changes', async () => {
    let versioned = false
    const deps = fakeDeps({
      repo: {
        insertVersion: async (agent, value, createdAt) => {
          versioned = true
          return agentVersion(agent, value, createdAt)
        },
      },
    })
    const result = await updateAgent(deps, auth, agentRecord(), { description: 'Just a description' })
    expect(versioned).toBe(false)
    expect(result.agent.status.version).toBe(1)
    expect(result.agent.metadata.description).toBe('Just a description')
  })

  it('updates provider, model, and allowed tools when explicitly patched', async () => {
    const result = await updateAgent(fakeDeps(), auth, agentRecord(), {
      provider: 'openai',
      model: 'gpt-4',
      allowedTools: ['read'],
    })
    expect(result.agent.spec.provider).toBe('openai')
    expect(result.agent.spec.model).toBe('gpt-4')
    expect(result.agent.spec.allowedTools).toEqual(['read'])
  })

  it('normalizes the legacy workers-ai transport alias before persisting an update and version', async () => {
    const versioned: AgentSpec[] = []
    const updated: AgentSpec[] = []
    const deps = fakeDeps({
      repo: {
        insertVersion: async (agent, value, createdAt) => {
          versioned.push(value)
          return agentVersion(agent, value, createdAt)
        },
        update: async (_projectId, _agentId, value) => {
          updated.push(value.spec)
        },
      },
    })

    const result = await updateAgent(deps, auth, agentRecord(), { provider: 'workers-ai' })

    expect(versioned).toHaveLength(1)
    expect(versioned[0]?.provider).toBeNull()
    expect(updated).toHaveLength(1)
    expect(updated[0]?.provider).toBeNull()
    expect(result.agent.spec.provider).toBeNull()
  })

  it('archives via { archived: true } and reports the transition', async () => {
    const result = await updateAgent(fakeDeps(), auth, agentRecord(), { archived: true })
    expect(result.archived).toBe(true)
    expect(result.agent.metadata.archivedAt).toEqual(expect.any(String))
  })

  it('rejects field updates on an archived agent', async () => {
    await expect(
      updateAgent(
        fakeDeps(),
        auth,
        agentRecord({ metadata: { archivedAt: '2026-01-02T00:00:00.000Z' }, status: { phase: 'archived' } }),
        { description: 'x' },
      ),
    ).rejects.toBeInstanceOf(AgentArchivedError)
  })

  it('unarchives an archived agent via { archived: false }', async () => {
    const result = await updateAgent(
      fakeDeps(),
      auth,
      agentRecord({ metadata: { archivedAt: '2026-01-02T00:00:00.000Z' }, status: { phase: 'archived' } }),
      { archived: false },
    )
    expect(result.agent.metadata.archivedAt).toBeNull()
  })

  it('is a no-op when patching an archived agent with archived:true', async () => {
    const archived = agentRecord({
      metadata: { archivedAt: '2026-01-02T00:00:00.000Z' },
      status: { phase: 'archived' },
    })
    const result = await updateAgent(fakeDeps(), auth, archived, { archived: true })
    expect(result.agent.metadata.archivedAt).toBe('2026-01-02T00:00:00.000Z')
    expect(result.archived).toBe(false)
  })
})
