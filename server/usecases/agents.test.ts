import type { Agent, AgentSpec, AgentVersion } from '@server/domain/agent'
import { resourceMetadata } from '@server/domain/resource'
import { describe, expect, it } from 'vitest'
import { createAgent, updateAgent } from './agents'
import type { Deps } from './deps'
import { AgentArchivedError, AgentInboxIdentityConflictError, type AuditEntry, type AuthScope } from './ports'

const auth: AuthScope = {
  organization: { id: 'org_1', name: 'Org' },
  project: { id: 'project_1', name: 'Project' },
  user: { id: 'user_1' },
  roles: [],
  permissions: [],
}

function spec(overrides: Partial<AgentSpec> = {}): AgentSpec {
  return {
    systemPrompt: 'Do the work.',
    provider: null,
    model: null,
    skills: [],
    subagents: [],
    allowedTools: ['read', 'bash'],
    mcpConnectors: [],
    identity: null,
    ...overrides,
  }
}

const identityDescriptor = {
  identityId: 'identity_1',
  agentId: 'rr_agent_1',
  issuer: 'https://realmroot.example.com/api/auth',
  subject: 'rr_agent_1',
  username: 'reviewer',
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
    spec: { ...spec(), ...overrides.spec },
    status: { phase: 'active', currentVersionId: 'agentver_1', version: 1, ...overrides.status },
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
    listVersions: async () => [],
    findVersion: async () => null,
    insertWithVersion: async (input, createdAt) => {
      const agent = agentRecord({
        metadata: {
          uid: 'agent_new',
          name: input.name,
          description: input.description,
          createdAt,
          updatedAt: createdAt,
        },
        spec: input.spec,
        status: { currentVersionId: 'agentver_1', version: 1 },
      })
      return {
        agent,
        version: {
          metadata: resourceMetadata({
            uid: 'agentver_1',
            pid: input.projectId,
            name: 'v1',
            createdAt,
            updatedAt: createdAt,
          }),
          spec: input.spec,
          status: { agentId: agent.metadata.uid, version: 1 },
        },
      }
    },
    updateWithVersion: async (_projectId, agent, fields, createdAt): Promise<AgentVersion> =>
      agentVersion(agent, fields.spec, createdAt),
    update: async () => {},
    unarchive: async () => {},
    providerEnabled: async () => true,
    connectorAvailable: async () => true,
    ...overrides.repo,
  }
  return {
    agents: repo,
    environments: undefined as unknown as Deps['environments'],
    providers: undefined as unknown as Deps['providers'],
    providerCatalog: undefined as unknown as Deps['providerCatalog'],
    vaults: undefined as unknown as Deps['vaults'],
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

describe('[spec: agents/create] createAgent', () => {
  it('inserts the agent, snapshots version 1, and sets it current', async () => {
    const agent = await createAgent(fakeDeps(), auth, { name: 'Research', description: null, spec: spec() })
    expect(agent.status.currentVersionId).toBe('agentver_1')
    expect(agent.status.version).toBe(1)
  })

  it('rejects an empty system prompt', async () => {
    await expect(
      createAgent(fakeDeps(), auth, { name: 'x', description: null, spec: spec({ systemPrompt: '   ' }) }),
    ).rejects.toMatchObject({ fields: { systemPrompt: 'System prompt is required.' } })
  })

  it('rejects a disabled provider reference', async () => {
    const deps = fakeDeps({ repo: { providerEnabled: async () => false } })
    await expect(
      createAgent(deps, auth, { name: 'x', description: null, spec: spec({ provider: 'provider_x' }) }),
    ).rejects.toMatchObject({ fields: { provider: expect.any(String) } })
  })

  it('accepts a non-catalog model because model validity is resolved at session creation', async () => {
    const agent = await createAgent(fakeDeps(), auth, {
      name: 'x',
      description: null,
      spec: spec({ provider: 'provider_x', model: 'opus' }),
    })
    expect(agent.spec.model).toBe('opus')
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

describe('[spec: agents/identity-binding] [spec: identities/lifetime-binding] Identity binding', () => {
  function withIdentity(deps: Deps, boundAgentId: string | null = null) {
    deps.identities = {
      find: async () => ({
        metadata: resourceMetadata({
          uid: 'identity_1',
          pid: 'project_1',
          name: 'Identity',
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        }),
        spec: { username: 'reviewer', runtime: 'codex' },
        status: { phase: 'active', state: 'active', failureCode: null, boundAgentId, descriptor: identityDescriptor },
      }),
      bind: async () => ({}) as never,
    } as never
    return deps
  }

  it('accepts an active Identity and snapshots its safe descriptor', async () => {
    const created = await createAgent(withIdentity(fakeDeps()), auth, {
      name: 'Identity agent',
      description: null,
      spec: spec(),
      identityRef: 'identity_1',
    })

    expect(created.spec.identity).toEqual(identityDescriptor)
  })

  it('rejects an Identity already bound to another Agent', async () => {
    await expect(
      createAgent(withIdentity(fakeDeps(), 'agent_other'), auth, {
        name: 'Identity agent',
        description: null,
        spec: spec(),
        identityRef: 'identity_1',
      }),
    ).rejects.toMatchObject({ name: 'IdentityAlreadyBoundError', code: 'identity_already_bound' })
  })

  it.each([
    null,
    { archivedAt: '2026-01-02T00:00:00.000Z', state: 'active', descriptor: identityDescriptor },
    { archivedAt: null, state: 'provisioning', descriptor: identityDescriptor },
    { archivedAt: null, state: 'active', descriptor: null },
  ])('rejects a missing, archived, provisioning, or descriptor-less Identity %#', async (condition) => {
    const deps = fakeDeps()
    deps.identities = {
      find: async () =>
        condition
          ? {
              metadata: resourceMetadata({
                uid: 'identity_invalid',
                pid: 'project_1',
                name: 'Invalid',
                createdAt: '2026-01-01T00:00:00.000Z',
                updatedAt: '2026-01-01T00:00:00.000Z',
                archivedAt: condition.archivedAt,
              }),
              spec: { username: 'reviewer', runtime: 'codex' },
              status: {
                phase: condition.archivedAt ? 'archived' : 'active',
                state: condition.state,
                failureCode: null,
                boundAgentId: null,
                descriptor: condition.descriptor,
              },
            }
          : null,
    } as never
    await expect(
      createAgent(deps, auth, {
        name: 'Invalid Identity',
        description: null,
        spec: spec(),
        identityRef: 'identity_invalid',
      }),
    ).rejects.toMatchObject({ fields: { identityRef: expect.any(String) } })
  })

  it('creates a new immutable Agent version when the binding changes', async () => {
    const inserted: AgentSpec[] = []
    const deps = withIdentity(
      fakeDeps({
        repo: {
          updateWithVersion: async (_projectId, agent, fields, createdAt) => {
            inserted.push(fields.spec)
            return agentVersion(agent, fields.spec, createdAt)
          },
        },
      }),
    )

    await updateAgent(deps, auth, agentRecord(), { identityRef: 'identity_1' })
    expect(inserted).toHaveLength(1)
    expect(inserted[0]?.identity).toEqual(identityDescriptor)
  })

  it('allows one Agent to select a new Identity while every prior Identity stays attributed to that Agent', async () => {
    const descriptors = {
      identity_1: identityDescriptor,
      identity_2: { ...identityDescriptor, identityId: 'identity_2', agentId: 'rr_agent_2', username: 'reviewer-2' },
    }
    const deps = fakeDeps()
    deps.identities = {
      find: async (_projectId: string, identityId: string) => ({
        metadata: resourceMetadata({
          uid: identityId,
          pid: 'project_1',
          name: identityId,
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        }),
        spec: { username: descriptors[identityId as keyof typeof descriptors].username, runtime: 'codex' },
        status: {
          phase: 'active',
          state: 'active',
          failureCode: null,
          boundAgentId: 'agent_1',
          descriptor: descriptors[identityId as keyof typeof descriptors],
        },
      }),
      bind: async () => ({}) as never,
    } as never

    const first = await updateAgent(deps, auth, agentRecord(), { identityRef: 'identity_1' })
    const second = await updateAgent(deps, auth, first.agent, { identityRef: 'identity_2' })
    expect(first.agent.spec.identity?.identityId).toBe('identity_1')
    expect(second.agent.spec.identity?.identityId).toBe('identity_2')
  })

  it('[spec: agents/inbox-identity-rebind] rejects Identity replacement and removal while allowing other updates', async () => {
    const deps = fakeDeps({
      repo: {
        updateWithVersion: async (_projectId, agent, fields, createdAt) => {
          if (fields.spec.identity?.identityId !== agent.spec.identity?.identityId) {
            throw new AgentInboxIdentityConflictError()
          }
          return agentVersion(agent, fields.spec, createdAt)
        },
      },
    })
    deps.identities = {
      find: async (_projectId: string, identityId: string) => ({
        metadata: resourceMetadata({
          uid: identityId,
          pid: 'project_1',
          name: identityId,
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        }),
        spec: { username: 'replacement', runtime: 'codex' },
        status: {
          phase: 'active',
          state: 'active',
          failureCode: null,
          boundAgentId: 'agent_1',
          descriptor: { ...identityDescriptor, identityId, subject: '01a05643-33a4-704f-8d6b-c30c04e18c6c' },
        },
      }),
    } as never
    const bound = agentRecord({ spec: { identity: identityDescriptor } })

    await expect(updateAgent(deps, auth, bound, { identityRef: 'identity_2' })).rejects.toMatchObject({
      code: 'agent_inbox_identity_conflict',
    })
    await expect(updateAgent(deps, auth, bound, { identityRef: null })).rejects.toMatchObject({
      code: 'agent_inbox_identity_conflict',
    })
    await expect(updateAgent(deps, auth, bound, { systemPrompt: 'Updated safely.' })).resolves.toMatchObject({
      agent: { spec: { systemPrompt: 'Updated safely.', identity: identityDescriptor } },
    })
  })
})

describe('[spec: agents/update] updateAgent', () => {
  it('snapshots a new version when a runtime field changes', async () => {
    const inserted: AgentSpec[] = []
    const deps = fakeDeps({
      repo: {
        updateWithVersion: async (_projectId, agent, fields, createdAt) => {
          inserted.push(fields.spec)
          return agentVersion(agent, fields.spec, createdAt, {
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
        updateWithVersion: async (_projectId, agent, fields, createdAt) => {
          versioned = true
          return agentVersion(agent, fields.spec, createdAt)
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
      provider: 'provider_new',
      model: 'gpt-4',
      allowedTools: ['read'],
    })
    expect(result.agent.spec.provider).toBe('provider_new')
    expect(result.agent.spec.model).toBe('gpt-4')
    expect(result.agent.spec.allowedTools).toEqual(['read'])
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
