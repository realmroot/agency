import type { Agent } from '@server/domain/agent'
import { resourceMetadata } from '@server/domain/resource'
import type { Trigger } from '@server/domain/trigger'
import { describe, expect, it } from 'vitest'
import type { Deps } from './deps'
import { type AuthScope, type TriggerConfig, TriggerValidationError } from './ports'
import { createTrigger, deleteTrigger, updateTrigger } from './triggers'

const auth: AuthScope = {
  organization: { id: 'org_1', name: 'Org' },
  project: { id: 'project_1', name: 'Project' },
  user: { id: 'user_1' },
  roles: [],
  permissions: [],
}

function baseConfig(overrides: Partial<TriggerConfig> = {}): TriggerConfig {
  return {
    name: 'Heartbeat',
    source: { type: 'schedule', schedule: { type: 'interval', intervalSeconds: 3600, windowSeconds: 0 } },
    suspend: false,
    template: {
      metadata: { labels: {}, annotations: {} },
      spec: {
        agentId: 'agent_1',
        environmentId: 'env_1',
        runtime: 'ama',
        promptTemplate: 'Do work.',
        env: {},
        envFrom: [],
        volumes: [],
        volumeMounts: [],
      },
    },
    nextDueAt: '2026-05-26T12:00:00.000Z',
    ...overrides,
  }
}

function triggerRecord(
  overrides: {
    metadata?: Partial<Trigger['metadata']>
    spec?: Partial<Trigger['spec']>
    status?: Partial<Trigger['status']>
  } = {},
): Trigger {
  const base = baseConfig()
  const timestamp = '2026-01-01T00:00:00.000Z'
  return {
    metadata: {
      ...resourceMetadata({
        uid: 'trigger_1',
        pid: 'project_1',
        name: base.name,
        createdBy: 'user_1',
        createdAt: timestamp,
        updatedAt: timestamp,
      }),
      ...overrides.metadata,
    },
    spec: {
      source: base.source,
      suspend: base.suspend,
      template: base.template,
      ...overrides.spec,
    },
    status: {
      phase: 'active',
      nextDueAt: base.nextDueAt,
      lastDispatchedAt: null,
      lastRunId: null,
      subscription: null,
      ...overrides.status,
    },
  }
}

function fakeDeps(repo: Partial<Deps['triggers']> = {}): Deps {
  const triggers: Deps['triggers'] = {
    list: async () => ({ rows: [], hasMore: false }),
    find: async () => null,
    insert: async (input, timestamp) =>
      triggerRecord({
        metadata: {
          uid: 'trigger_1',
          pid: input.projectId,
          name: input.config.name,
          createdBy: input.createdByUserId,
          createdAt: timestamp,
          updatedAt: timestamp,
        },
        spec: {
          source: input.config.source,
          suspend: input.config.suspend,
          template: input.config.template,
        },
        status: { nextDueAt: input.config.nextDueAt },
      }),
    update: async (_p, id, fields, updatedAt) =>
      triggerRecord({
        metadata: { uid: id, name: fields.config.name, updatedAt },
        spec: {
          source: fields.config.source,
          suspend: fields.config.suspend,
          template: fields.config.template,
        },
        status: { phase: 'active', nextDueAt: fields.config.nextDueAt },
      }),
    delete: async () => true,
    listRuns: async () => ({ rows: [], hasMore: false }),
    findRun: async () => null,
    agentUsable: async () => null,
    environmentUsable: async () => null,
    ...repo,
  }
  const agent: Agent = {
    metadata: resourceMetadata({
      uid: 'agent_1',
      pid: 'project_1',
      name: 'Agent',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    }),
    spec: {
      systemPrompt: 'Work.',
      provider: null,
      model: null,
      skills: [],
      subagents: [],
      allowedTools: [],
      mcpConnectors: [],
      identity: null,
    },
    status: { phase: 'active', currentVersionId: 'agentver_1', version: 1, schedulable: false },
  }
  return { triggers, agents: { find: async () => agent } } as unknown as Deps
}

function identityAgent(runtime: 'ama' | 'codex' | 'claude-code' | 'copilot'): Agent {
  return {
    metadata: resourceMetadata({
      uid: 'agent_1',
      pid: 'project_1',
      name: 'Agent',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    }),
    spec: {
      systemPrompt: 'Work.',
      provider: null,
      model: null,
      skills: [],
      subagents: [],
      allowedTools: [],
      mcpConnectors: [],
      identity: {
        identityId: 'identity_1',
        agentId: 'rr_agent_1',
        issuer: 'https://realmroot.example/api/auth',
        subject: 'rr_agent_1',
        username: 'runner',
        runtime,
        credentialRef: 'ama://vaults/vault_1/credentials/cred_1',
      },
    },
    status: { phase: 'active', currentVersionId: 'agentver_1', version: 1, schedulable: false },
  }
}

function depsWithAgent(agent: Agent, repo: Partial<Deps['triggers']> = {}) {
  const deps = fakeDeps(repo)
  deps.agents = { ...deps.agents, find: async () => agent }
  return deps
}

describe('[spec: triggers/create] createTrigger', () => {
  it('creates a trigger when references are usable', async () => {
    const trigger = await createTrigger(fakeDeps(), auth, {
      config: { ...baseConfig(), nextDueAt: '2026-05-26T12:00:00.000Z' },
    })
    expect(trigger.spec.template.spec.agentId).toBe('agent_1')
    expect(trigger.status.nextDueAt).toBe('2026-05-26T12:00:00.000Z')
  })

  it.each([
    'ama',
    'codex',
    'claude-code',
    'copilot',
  ] as const)('[spec: identities/runtime-constraint] inherits %s from the selected Identity', async (runtime) => {
    const config = baseConfig()
    delete (config.template.spec as { runtime?: string }).runtime
    const trigger = await createTrigger(depsWithAgent(identityAgent(runtime)), auth, { config })
    expect(trigger.spec.template.spec.runtime).toBe(runtime)
  })

  it('[spec: identities/runtime-constraint] rejects a create runtime that conflicts with the Identity', async () => {
    await expect(
      createTrigger(depsWithAgent(identityAgent('codex')), auth, { config: baseConfig() }),
    ).rejects.toMatchObject({
      name: 'TriggerConflictError',
      status: 409,
      code: 'identity_runtime_mismatch',
    })
  })

  it('propagates unexpected Identity runtime resolution failures on create', async () => {
    const agent = identityAgent('codex')
    Object.defineProperty(agent.spec.identity, 'runtime', {
      get() {
        throw new Error('corrupt identity descriptor')
      },
    })
    await expect(createTrigger(depsWithAgent(agent), auth, { config: baseConfig() })).rejects.toThrow(
      'corrupt identity descriptor',
    )
  })

  it('maps an Agent missing after reference validation to a 404', async () => {
    const deps = fakeDeps()
    deps.agents = { ...deps.agents, find: async () => null }
    await expect(createTrigger(deps, auth, { config: baseConfig() })).rejects.toMatchObject({
      name: 'TriggerConflictError',
      status: 404,
    })
  })

  it('skips environment validation for an unpinned environment', async () => {
    let checkedEnvironment = false
    const deps = fakeDeps({
      environmentUsable: async () => {
        checkedEnvironment = true
        return null
      },
    })
    const config = baseConfig()
    config.template.spec.environmentId = null
    await createTrigger(deps, auth, { config })
    expect(checkedEnvironment).toBe(false)
  })

  it('creates an HTTP trigger without schedule timing [spec: triggers/http-create]', async () => {
    const trigger = await createTrigger(fakeDeps(), auth, {
      config: { ...baseConfig({ source: { type: 'http' }, nextDueAt: null }), nextDueAt: null },
    })
    expect(trigger.spec.source.type).toBe('http')
    expect(trigger.status.nextDueAt).toBeNull()
  })

  it('preserves serial concurrency when creating an HTTP trigger', async () => {
    const trigger = await createTrigger(fakeDeps(), auth, {
      config: {
        ...baseConfig({ source: { type: 'http', concurrency: { mode: 'serial' } }, nextDueAt: null }),
        nextDueAt: null,
      },
    })
    expect(trigger.spec.source).toEqual({ type: 'http', concurrency: { mode: 'serial' } })
  })

  it('derives nextDueAt from the interval when omitted', async () => {
    const trigger = await createTrigger(fakeDeps(), auth, {
      config: { ...baseConfig(), nextDueAt: null },
    })
    expect(trigger.status.nextDueAt).toEqual(expect.any(String))
  })

  it('rejects scheduled triggers without schedule timing', async () => {
    await expect(
      createTrigger(fakeDeps(), auth, {
        config: { ...baseConfig({ source: { type: 'schedule', schedule: undefined as never } }), nextDueAt: null },
      }),
    ).rejects.toBeInstanceOf(TriggerValidationError)
  })

  it('rejects HTTP triggers with schedule timing', async () => {
    await expect(
      createTrigger(fakeDeps(), auth, {
        config: { ...baseConfig({ source: { type: 'http' } }), nextDueAt: '2026-05-26T12:00:00.000Z' },
      }),
    ).rejects.toBeInstanceOf(TriggerValidationError)
  })

  it('rejects secret metadata [spec: triggers/validation]', async () => {
    await expect(
      createTrigger(fakeDeps(), auth, {
        config: {
          ...baseConfig({
            template: {
              ...baseConfig().template,
              metadata: { labels: {}, annotations: { private_key: 'x' } },
            },
          }),
          nextDueAt: null,
        },
      }),
    ).rejects.toBeInstanceOf(TriggerValidationError)
  })

  it('rejects envFrom', async () => {
    await expect(
      createTrigger(fakeDeps(), auth, {
        config: {
          ...baseConfig({
            template: {
              ...baseConfig().template,
              spec: { ...baseConfig().template.spec, env: { DOWNSTREAM_API_TOKEN: 'x' } },
            },
          }),
          nextDueAt: null,
        },
      }),
    ).rejects.toBeInstanceOf(TriggerValidationError)
  })

  it('rejects raw secret material in template volumes', async () => {
    await expect(
      createTrigger(fakeDeps(), auth, {
        config: {
          ...baseConfig({
            template: {
              ...baseConfig().template,
              spec: {
                ...baseConfig().template.spec,
                volumes: [
                  {
                    name: 'repo',
                    type: 'git_repository',
                    url: 'https://example.com/repo.git',
                    accessToken: 'raw-token',
                  },
                ],
              },
            },
          }),
          nextDueAt: null,
        },
      }),
    ).rejects.toBeInstanceOf(TriggerValidationError)
  })

  it('maps a missing agent to a 404 conflict', async () => {
    const deps = fakeDeps({ agentUsable: async () => ({ status: 404, message: 'Agent not found' }) })
    await expect(
      createTrigger(deps, auth, {
        config: {
          ...baseConfig({
            template: { ...baseConfig().template, spec: { ...baseConfig().template.spec, agentId: 'agent_missing' } },
          }),
          nextDueAt: null,
        },
      }),
    ).rejects.toMatchObject({ name: 'TriggerConflictError', status: 404 })
  })

  it('maps an archived environment to a 409 conflict', async () => {
    const deps = fakeDeps({
      environmentUsable: async () => ({ status: 409, message: 'Selected environment is archived or unavailable' }),
    })
    await expect(
      createTrigger(deps, auth, {
        config: {
          ...baseConfig({
            template: {
              ...baseConfig().template,
              spec: { ...baseConfig().template.spec, environmentId: 'env_archived' },
            },
          }),
          nextDueAt: null,
        },
      }),
    ).rejects.toMatchObject({ name: 'TriggerConflictError', status: 409 })
  })
})

describe('[spec: triggers/lifecycle] updateTrigger', () => {
  it('merges field updates and snapshots schedule changes', async () => {
    const result = await updateTrigger(fakeDeps(), auth, triggerRecord(), {
      name: 'Renamed',
      source: { type: 'schedule', schedule: { intervalSeconds: 1800 } },
    })
    expect(result.trigger.metadata.name).toBe('Renamed')
    expect(result.trigger.spec.source).toMatchObject({ type: 'schedule', schedule: { intervalSeconds: 1800 } })
  })

  it('[spec: identities/runtime-constraint] re-materializes runtime when the Agent changes', async () => {
    const result = await updateTrigger(depsWithAgent(identityAgent('copilot')), auth, triggerRecord(), {
      template: { spec: { agentId: 'agent_identity' } },
    })
    expect(result.trigger.spec.template.spec.runtime).toBe('copilot')
  })

  it('[spec: identities/runtime-constraint] rejects a conflicting explicit runtime update', async () => {
    await expect(
      updateTrigger(depsWithAgent(identityAgent('claude-code')), auth, triggerRecord(), {
        template: { spec: { runtime: 'codex' } },
      }),
    ).rejects.toMatchObject({ name: 'TriggerConflictError', status: 409, code: 'identity_runtime_mismatch' })
  })

  it('propagates unexpected Identity runtime resolution failures on update', async () => {
    const agent = identityAgent('codex')
    Object.defineProperty(agent.spec.identity, 'runtime', {
      get() {
        throw new Error('corrupt identity descriptor')
      },
    })
    await expect(updateTrigger(depsWithAgent(agent), auth, triggerRecord(), {})).rejects.toThrow(
      'corrupt identity descriptor',
    )
  })

  it('maps an Agent missing during an update to a 404', async () => {
    const deps = fakeDeps()
    deps.agents = { ...deps.agents, find: async () => null }
    await expect(updateTrigger(deps, auth, triggerRecord(), {})).rejects.toMatchObject({
      name: 'TriggerConflictError',
      status: 404,
    })
  })

  it('re-validates references when the agent changes', async () => {
    const deps = fakeDeps({ agentUsable: async () => ({ status: 404, message: 'Agent not found' }) })
    await expect(
      updateTrigger(deps, auth, triggerRecord(), { template: { spec: { agentId: 'agent_other' } } }),
    ).rejects.toMatchObject({
      name: 'TriggerConflictError',
      status: 404,
    })
  })

  it('converts a scheduled trigger to HTTP and clears timing', async () => {
    const result = await updateTrigger(fakeDeps(), auth, triggerRecord(), { source: { type: 'http' } })
    expect(result.trigger.spec.source.type).toBe('http')
    expect(result.trigger.status.nextDueAt).toBeNull()
  })

  it('rejects converting a scheduled trigger to HTTP with nextDueAt', async () => {
    await expect(
      updateTrigger(fakeDeps(), auth, triggerRecord(), {
        source: { type: 'http' },
        nextDueAt: '2026-05-26T12:00:00.000Z',
      }),
    ).rejects.toBeInstanceOf(TriggerValidationError)
  })

  it('updates an HTTP trigger without changing timing', async () => {
    const result = await updateTrigger(
      fakeDeps(),
      auth,
      triggerRecord({ spec: { source: { type: 'http' } }, status: { nextDueAt: null } }),
      { name: 'Webhook renamed' },
    )
    expect(result.trigger.metadata.name).toBe('Webhook renamed')
    expect(result.trigger.spec.source.type).toBe('http')
    expect(result.trigger.status.nextDueAt).toBeNull()
  })

  it('updates and preserves HTTP trigger serial concurrency', async () => {
    const current = triggerRecord({ spec: { source: { type: 'http' } }, status: { nextDueAt: null } })
    const serialized = await updateTrigger(fakeDeps(), auth, current, {
      source: { type: 'http', concurrency: { mode: 'serial' } },
    })
    const preserved = await updateTrigger(fakeDeps(), auth, serialized.trigger, { source: { type: 'http' } })
    const renamed = await updateTrigger(fakeDeps(), auth, preserved.trigger, { name: 'Still serial' })

    expect(serialized.trigger.spec.source).toEqual({ type: 'http', concurrency: { mode: 'serial' } })
    expect(preserved.trigger.spec.source).toEqual({ type: 'http', concurrency: { mode: 'serial' } })
    expect(renamed.trigger.spec.source).toEqual({ type: 'http', concurrency: { mode: 'serial' } })
  })

  it('converts an HTTP trigger to a scheduled trigger when interval timing is supplied', async () => {
    const current = triggerRecord({ spec: { source: { type: 'http' } }, status: { nextDueAt: null } })
    const result = await updateTrigger(fakeDeps(), auth, current, {
      source: { type: 'schedule', schedule: { intervalSeconds: 1800 } },
    })

    expect(result.trigger.spec.source).toEqual({
      type: 'schedule',
      schedule: { type: 'interval', intervalSeconds: 1800, windowSeconds: 0 },
    })
    expect(result.trigger.status.nextDueAt).toEqual(expect.any(String))
  })

  it('rejects secret material in template metadata patch', async () => {
    await expect(
      updateTrigger(fakeDeps(), auth, triggerRecord(), {
        template: { metadata: { annotations: { private_key: 'raw' } } },
      }),
    ).rejects.toBeInstanceOf(TriggerValidationError)
  })

  it('rejects an HTTP trigger update with schedule timing', async () => {
    await expect(
      updateTrigger(
        fakeDeps(),
        auth,
        triggerRecord({ spec: { source: { type: 'http' } }, status: { nextDueAt: null } }),
        {
          nextDueAt: '2026-05-26T12:00:00.000Z',
        },
      ),
    ).rejects.toBeInstanceOf(TriggerValidationError)
  })

  it('rejects converting an HTTP trigger to a scheduled trigger without timing', async () => {
    await expect(
      updateTrigger(fakeDeps(), auth, triggerRecord({ spec: { source: { type: 'http' } } }), {
        source: { type: 'schedule' },
      }),
    ).rejects.toBeInstanceOf(TriggerValidationError)
  })
})

describe('[spec: triggers/delete] deleteTrigger', () => {
  it('deletes the trigger scoped to the project and reports that it existed', async () => {
    const calls: Array<{ projectId: string; triggerId: string }> = []
    const deps = fakeDeps({
      delete: async (projectId, triggerId) => {
        calls.push({ projectId, triggerId })
        return true
      },
    })
    const existed = await deleteTrigger(deps, auth, 'trigger_1')
    expect(existed).toBe(true)
    expect(calls).toEqual([{ projectId: 'project_1', triggerId: 'trigger_1' }])
  })

  it('reports a missing trigger so the caller can answer 404', async () => {
    const deps = fakeDeps({ delete: async () => false })
    await expect(deleteTrigger(deps, auth, 'trigger_missing')).resolves.toBe(false)
  })
})
