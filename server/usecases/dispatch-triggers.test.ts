import { resourceMetadata } from '@server/domain/resource'
import type { Session, SessionMessage } from '@server/domain/session'
import type { Trigger } from '@server/domain/trigger'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Deps } from './deps'
import type { AuthScope, ClaimedRun, DueTrigger } from './ports'

// dispatchDueScheduledTriggers now calls the runtime createSession usecase
// directly (the SessionRuntimeGateway indirection was removed). Mock that module
// so these tests drive the create outcome the way they previously drove the
// gateway.
vi.mock('./runtime/sessions', () => ({
  createSession: vi.fn(),
  closeSession: vi.fn(),
  reopenSession: vi.fn(),
  archiveSession: vi.fn(),
  unarchiveSession: vi.fn(),
  dispatchPrompt: vi.fn(),
  decideApproval: vi.fn(),
  markExpiredPending: vi.fn(),
}))

import { dispatchDueScheduledTriggers, dispatchHttpTrigger } from './dispatch-triggers'
import * as runtimeSessions from './runtime/sessions'

type RuntimeSessionOverrides = { createSession?: typeof runtimeSessions.createSession }

beforeEach(() => {
  vi.clearAllMocks()
})

const auth: AuthScope = {
  organization: { id: 'org_1', name: 'Org' },
  project: { id: 'project_1', name: 'Project' },
  user: { id: 'user_1' },
  roles: [],
  permissions: [],
}

function dueTrigger(overrides: Partial<DueTrigger> = {}): DueTrigger {
  return {
    id: 'trigger_1',
    organizationId: 'org_1',
    projectId: 'project_1',
    name: 'Nightly Agent',
    template: {
      metadata: { labels: {}, annotations: {} },
      spec: {
        agentId: 'agent_1',
        environmentId: 'env_1',
        runtime: 'ama',
        promptTemplate: 'Run the analysis',
        env: {},
        envFrom: [],
        volumes: [],
        volumeMounts: [],
      },
    },
    nextDueAt: '2026-01-01T00:00:00.000Z',
    intervalSeconds: 3600,
    ...overrides,
  }
}

function httpTrigger(
  overrides: {
    metadata?: Partial<Trigger['metadata']>
    spec?: Partial<Trigger['spec']>
    status?: Partial<Trigger['status']>
  } = {},
): Trigger {
  const timestamp = '2026-01-01T00:00:00.000Z'
  return {
    metadata: {
      ...resourceMetadata({
        uid: 'trigger_http',
        pid: 'project_1',
        name: 'HTTP Agent',
        createdBy: 'user_1',
        createdAt: timestamp,
        updatedAt: timestamp,
      }),
      ...overrides.metadata,
    },
    spec: {
      source: { type: 'http' },
      suspend: false,
      template: {
        metadata: { labels: {}, annotations: {} },
        spec: {
          agentId: 'agent_1',
          environmentId: 'env_1',
          runtime: 'ama',
          promptTemplate: 'Handle {{ body.ticket.id }} from {{ query.source }}',
          env: {},
          envFrom: [],
          volumes: [],
          volumeMounts: [],
        },
      },
      ...overrides.spec,
    },
    status: {
      phase: 'active',
      nextDueAt: null,
      lastDispatchedAt: null,
      lastRunId: null,
      ...overrides.status,
    },
  }
}

function claimedRun(overrides: Partial<ClaimedRun> = {}): ClaimedRun {
  return {
    id: 'run_1',
    scheduledFor: '2026-01-01T00:00:00.000Z',
    correlationId: 'corr_1',
    ...overrides,
  }
}

function sessionRecord(overrides: Partial<Session> = {}): Session {
  return {
    metadata: {
      uid: 'sess_1',
      pid: 'project_1',
      name: 'sess_1',
      labels: {},
      annotations: {},
      createdBy: 'user_1',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      archivedAt: null,
    },
    spec: {
      agentId: 'agent_1',
      environmentId: 'env_1',
      runtime: 'ama',
      env: {},
      envFrom: [],
      volumes: [],
      volumeMounts: [],
    },
    status: {
      phase: 'pending',
      reason: null,
      conditions: [],
      bindings: {
        agent: {
          versionId: 'agentver_1',
          snapshot: {
            id: 'agentver_1',
            agentId: 'agent_1',
            projectId: 'project_1',
            version: 1,
            systemPrompt: 'Do the work.',
            provider: 'workers-ai',
            model: null,
            skills: [],
            subagents: [],
            allowedTools: ['read', 'bash'],
            mcpConnectors: [],
            createdAt: '2026-01-01T00:00:00.000Z',
          },
        },
        environment: { id: 'env_1', versionId: null, snapshot: null },
        runtime: 'ama',
      },
      placement: {
        hostingMode: 'cloud',
        provider: 'workers-ai',
        model: null,
        driver: null,
        backend: null,
        protocol: null,
      },
      startedAt: null,
      closedAt: null,
    },
    ...overrides,
  }
}

function sessionMessageRecord(overrides: Partial<SessionMessage> = {}): SessionMessage {
  return {
    id: 'msg_1',
    sessionId: 'sess_existing',
    type: 'prompt',
    content: 'message',
    delivery: 'queued',
    state: 'accepted',
    error: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

function fakeDeps(
  overrides: {
    triggerDispatch?: Partial<Deps['triggerDispatch']>
    sessionRuntime?: RuntimeSessionOverrides
    sessions?: Partial<Deps['sessions']>
    audit?: Partial<Deps['audit']>
  } = {},
): Deps {
  const triggerDispatch: Deps['triggerDispatch'] = {
    dueTriggers: async () => [],
    claimRun: async () => claimedRun(),
    claimHttpRun: async () => claimedRun({ id: 'httprun_1', scheduledFor: '2026-01-01T00:00:00.000Z' }),
    projectName: async () => 'My Project',
    markRunFailed: async () => {},
    markRunDispatched: async () => {},
    ...overrides.triggerDispatch,
  }
  vi.mocked(runtimeSessions.createSession).mockImplementation(
    overrides.sessionRuntime?.createSession ?? (async () => ({ ok: true, value: sessionRecord() })),
  )
  vi.mocked(runtimeSessions.dispatchPrompt).mockImplementation(async () => ({
    ok: true,
    delivery: 'queued',
    state: 'accepted',
  }))
  const sessionsRepo = {
    findActiveHttpTriggerSession: async () => null,
    insertMessage: async (record: Parameters<Deps['sessions']['insertMessage']>[0]) =>
      sessionMessageRecord({ sessionId: record.sessionId, content: record.content }),
    ...overrides.sessions,
  } as Deps['sessions']
  return {
    agents: undefined as unknown as Deps['agents'],
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
    sessions: sessionsRepo,
    createApprovalGate: undefined as unknown as Deps['createApprovalGate'],
    rereadStartedSession: false,
    audit: { record: async () => {}, ...overrides.audit },
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
    triggerDispatch,
  }
}

// ── dispatchDueScheduledTriggers ─────────────────────────────────────────────

describe('[spec: triggers/dispatch] dispatchDueScheduledTriggers — empty queue', () => {
  it('returns zero counts when no triggers are due', async () => {
    const result = await dispatchDueScheduledTriggers(fakeDeps())
    expect(result.claimed).toBe(0)
    expect(result.dispatched).toBe(0)
    expect(result.failed).toBe(0)
    expect(result.skipped).toBe(0)
    expect(result.runs).toHaveLength(0)
  })

  it('uses the provided heartbeatAt timestamp', async () => {
    let captured: string | null = null
    const deps = fakeDeps({
      triggerDispatch: {
        dueTriggers: async (opts) => {
          captured = opts.heartbeatAt
          return []
        },
      },
    })
    await dispatchDueScheduledTriggers(deps, { heartbeatAt: '2026-06-01T00:00:00.000Z' })
    expect(captured).toBe('2026-06-01T00:00:00.000Z')
  })

  it('defaults to a current ISO timestamp when heartbeatAt is omitted', async () => {
    let captured: string | null = null
    const deps = fakeDeps({
      triggerDispatch: {
        dueTriggers: async (opts) => {
          captured = opts.heartbeatAt
          return []
        },
      },
    })
    await dispatchDueScheduledTriggers(deps)
    expect(captured).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })

  it('filters by projectId when provided', async () => {
    let capturedProjectId: string | undefined
    const deps = fakeDeps({
      triggerDispatch: {
        dueTriggers: async (opts) => {
          capturedProjectId = opts.projectId
          return []
        },
      },
    })
    await dispatchDueScheduledTriggers(deps, { projectId: 'project_x' })
    expect(capturedProjectId).toBe('project_x')
  })

  it('omits projectId from the query when not provided', async () => {
    let capturedOpts: Record<string, unknown> = {}
    const deps = fakeDeps({
      triggerDispatch: {
        dueTriggers: async (opts) => {
          capturedOpts = opts as unknown as Record<string, unknown>
          return []
        },
      },
    })
    await dispatchDueScheduledTriggers(deps)
    expect(capturedOpts).not.toHaveProperty('projectId')
  })

  it('uses the default limit of 50 when not specified', async () => {
    let capturedLimit: number | null = null
    const deps = fakeDeps({
      triggerDispatch: {
        dueTriggers: async (opts) => {
          capturedLimit = opts.limit
          return []
        },
      },
    })
    await dispatchDueScheduledTriggers(deps)
    expect(capturedLimit).toBe(50)
  })

  it('forwards a custom limit', async () => {
    let capturedLimit: number | null = null
    const deps = fakeDeps({
      triggerDispatch: {
        dueTriggers: async (opts) => {
          capturedLimit = opts.limit
          return []
        },
      },
    })
    await dispatchDueScheduledTriggers(deps, { limit: 10 })
    expect(capturedLimit).toBe(10)
  })
})

describe('[spec: triggers/dispatch] dispatchDueScheduledTriggers — successful dispatch', () => {
  it('increments claimed and dispatched for a successfully dispatched trigger', async () => {
    const trigger = dueTrigger()
    const deps = fakeDeps({
      triggerDispatch: {
        dueTriggers: async () => [trigger],
      },
    })
    const result = await dispatchDueScheduledTriggers(deps)
    expect(result.claimed).toBe(1)
    expect(result.dispatched).toBe(1)
    expect(result.failed).toBe(0)
    expect(result.skipped).toBe(0)
  })

  it('records a run entry with dispatched status', async () => {
    const trigger = dueTrigger()
    const deps = fakeDeps({
      triggerDispatch: {
        dueTriggers: async () => [trigger],
      },
    })
    const result = await dispatchDueScheduledTriggers(deps)
    expect(result.runs).toHaveLength(1)
    expect(result.runs[0]!.status).toBe('dispatched')
    expect(result.runs[0]!.sessionId).toBe('sess_1')
    expect(result.runs[0]!.triggerId).toBe('trigger_1')
    expect(result.runs[0]!.errorMessage).toBeNull()
  })

  it('marks the run as dispatched in the repo', async () => {
    const trigger = dueTrigger()
    let marked = false
    const deps = fakeDeps({
      triggerDispatch: {
        dueTriggers: async () => [trigger],
        markRunDispatched: async () => {
          marked = true
        },
      },
    })
    await dispatchDueScheduledTriggers(deps)
    expect(marked).toBe(true)
  })

  it('records the dispatch outcome in the audit log on success', async () => {
    const trigger = dueTrigger()
    const auditEntries: string[] = []
    const deps = fakeDeps({
      triggerDispatch: {
        dueTriggers: async () => [trigger],
      },
      audit: {
        record: async (_auth, entry) => {
          auditEntries.push(entry.action)
        },
      },
    })
    await dispatchDueScheduledTriggers(deps)
    expect(auditEntries).toContain('scheduled_trigger.dispatch')
  })

  it('includes trigger metadata in session metadata', async () => {
    const trigger = dueTrigger({
      template: {
        ...dueTrigger().template,
        metadata: { labels: {}, annotations: { env: 'staging' } },
      },
    })
    let capturedMetadata: Record<string, unknown> | null = null
    const deps = fakeDeps({
      triggerDispatch: {
        dueTriggers: async () => [trigger],
        markRunDispatched: async (_t, _r, _sid, meta) => {
          capturedMetadata = meta
        },
      },
    })
    await dispatchDueScheduledTriggers(deps)
    expect(capturedMetadata).toMatchObject({
      annotations: { env: 'staging' },
      source: 'scheduled-agent-trigger',
      scheduledTriggerId: 'trigger_1',
    })
  })

  it('builds system auth with resolved project name', async () => {
    const trigger = dueTrigger()
    let capturedProjectName: string | null = null
    const deps = fakeDeps({
      triggerDispatch: {
        dueTriggers: async () => [trigger],
        projectName: async () => 'Resolved Name',
      },
      audit: {
        record: async (authArg) => {
          capturedProjectName = authArg.project.name
        },
      },
    })
    await dispatchDueScheduledTriggers(deps)
    expect(capturedProjectName).toBe('Resolved Name')
  })
})

describe('[spec: triggers/dispatch] dispatchDueScheduledTriggers — environment pass-through', () => {
  it('passes a null environment through to createSession for an unpinned trigger', async () => {
    // The dispatcher no longer resolves an environment; createSession resolves a
    // runner-capable one when it receives null.
    const trigger = dueTrigger({
      template: {
        ...dueTrigger().template,
        spec: { ...dueTrigger().template.spec, environmentId: null, runtime: 'codex' },
      },
    })
    let dispatchedEnvironmentId: string | null | undefined = 'unset'
    const deps = fakeDeps({
      triggerDispatch: { dueTriggers: async () => [trigger] },
      sessionRuntime: {
        createSession: async (_deps, _auth, input) => {
          dispatchedEnvironmentId = (input as { environmentId?: string | null }).environmentId
          return { ok: true, value: sessionRecord() }
        },
      },
    })
    const result = await dispatchDueScheduledTriggers(deps)
    expect(result.dispatched).toBe(1)
    expect(dispatchedEnvironmentId).toBeNull()
  })

  it('passes the pinned environment through to createSession', async () => {
    const trigger = dueTrigger({
      template: {
        ...dueTrigger().template,
        spec: { ...dueTrigger().template.spec, environmentId: 'env_pinned' },
      },
    })
    let dispatchedEnvironmentId: string | null | undefined = 'unset'
    const deps = fakeDeps({
      triggerDispatch: { dueTriggers: async () => [trigger] },
      sessionRuntime: {
        createSession: async (_deps, _auth, input) => {
          dispatchedEnvironmentId = (input as { environmentId?: string | null }).environmentId
          return { ok: true, value: sessionRecord() }
        },
      },
    })
    await dispatchDueScheduledTriggers(deps)
    expect(dispatchedEnvironmentId).toBe('env_pinned')
  })

  it('passes scheduled trigger env and envFrom through to createSession', async () => {
    const envFrom = [
      {
        type: 'secret' as const,
        name: 'AK_AGENT_KEY',
        secretRef: 'ama://vaults/vault_1/credentials/cred_1/versions/ver_1',
      },
    ]
    const trigger = dueTrigger({
      template: {
        ...dueTrigger().template,
        spec: {
          ...dueTrigger().template.spec,
          env: { AK_AGENT_ID: 'agent_1', AK_SESSION_ID: 'ak_session_1' },
          envFrom,
        },
      },
    })
    let capturedOptions: Record<string, unknown> | null = null
    const deps = fakeDeps({
      triggerDispatch: { dueTriggers: async () => [trigger] },
      sessionRuntime: {
        createSession: async (_deps, _auth, input) => {
          capturedOptions = input.options as unknown as Record<string, unknown>
          return { ok: true, value: sessionRecord() }
        },
      },
    })
    await dispatchDueScheduledTriggers(deps)
    expect(capturedOptions).toMatchObject({ env: trigger.template.spec.env, envFrom })
  })
})

describe('[spec: triggers/dispatch] dispatchDueScheduledTriggers — skipped (already claimed)', () => {
  it('increments skipped when claimRun returns null', async () => {
    const trigger = dueTrigger()
    const deps = fakeDeps({
      triggerDispatch: {
        dueTriggers: async () => [trigger],
        claimRun: async () => null,
      },
    })
    const result = await dispatchDueScheduledTriggers(deps)
    expect(result.skipped).toBe(1)
    expect(result.claimed).toBe(0)
    expect(result.runs).toHaveLength(0)
  })
})

describe('[spec: triggers/dispatch] dispatchDueScheduledTriggers — failed dispatch', () => {
  it('increments failed and records a run entry when createSession returns an error', async () => {
    const trigger = dueTrigger()
    const deps = fakeDeps({
      triggerDispatch: {
        dueTriggers: async () => [trigger],
      },
      sessionRuntime: {
        createSession: async () => ({
          ok: false,
          error: { status: 400, code: 'validation', message: 'Agent not found' },
        }),
      },
    })
    const result = await dispatchDueScheduledTriggers(deps)
    expect(result.failed).toBe(1)
    expect(result.claimed).toBe(1)
    expect(result.dispatched).toBe(0)
    expect(result.runs[0]!.status).toBe('failed')
    expect(result.runs[0]!.errorMessage).toBe('Agent not found')
    expect(result.runs[0]!.sessionId).toBeNull()
  })

  it('marks the run as failed in the repo when createSession errors', async () => {
    const trigger = dueTrigger()
    let markedFailed = false
    const deps = fakeDeps({
      triggerDispatch: {
        dueTriggers: async () => [trigger],
        markRunFailed: async () => {
          markedFailed = true
        },
      },
      sessionRuntime: {
        createSession: async () => ({
          ok: false,
          error: { status: 500, code: 'runtime_error', message: 'Crash' },
        }),
      },
    })
    await dispatchDueScheduledTriggers(deps)
    expect(markedFailed).toBe(true)
  })

  it('records failure in audit log when createSession errors', async () => {
    const trigger = dueTrigger()
    let outcome: string | null = null
    const deps = fakeDeps({
      triggerDispatch: {
        dueTriggers: async () => [trigger],
      },
      sessionRuntime: {
        createSession: async () => ({
          ok: false,
          error: { status: 500, code: 'runtime_error', message: 'Crash' },
        }),
      },
      audit: {
        record: async (_auth, entry) => {
          outcome = (entry as { outcome?: string }).outcome ?? null
        },
      },
    })
    await dispatchDueScheduledTriggers(deps)
    expect(outcome).toBe('failure')
  })

  it('handles thrown error from projectName gracefully, incrementing failed', async () => {
    const trigger = dueTrigger()
    const deps = fakeDeps({
      triggerDispatch: {
        dueTriggers: async () => [trigger],
        projectName: async () => {
          throw new Error('DB connection failed')
        },
      },
    })
    const result = await dispatchDueScheduledTriggers(deps)
    expect(result.failed).toBe(1)
    expect(result.runs[0]!.status).toBe('failed')
    expect(result.runs[0]!.errorMessage).toContain('DB connection failed')
  })

  it('fails the run when projectName returns null', async () => {
    const trigger = dueTrigger()
    const deps = fakeDeps({
      triggerDispatch: {
        dueTriggers: async () => [trigger],
        projectName: async () => null,
      },
    })
    const result = await dispatchDueScheduledTriggers(deps)
    expect(result.failed).toBe(1)
    expect(result.runs[0]!.errorMessage).toContain('project is unavailable')
  })

  it('preserves error messages', async () => {
    const trigger = dueTrigger()
    const deps = fakeDeps({
      triggerDispatch: {
        dueTriggers: async () => [trigger],
        projectName: async () => {
          throw new Error('bearer secrettoken123')
        },
      },
    })
    const result = await dispatchDueScheduledTriggers(deps)
    expect(result.runs[0]!.errorMessage).toBe('bearer secrettoken123')
  })
})

describe('[spec: triggers/dispatch] dispatchDueScheduledTriggers — outer exception (dispatchTrigger throws)', () => {
  it('handles a thrown error from claimRun without crashing, incrementing failed', async () => {
    const trigger = dueTrigger()
    const deps = fakeDeps({
      triggerDispatch: {
        dueTriggers: async () => [trigger],
        claimRun: async () => {
          throw new Error('Unexpected DB error')
        },
      },
    })
    const result = await dispatchDueScheduledTriggers(deps)
    expect(result.failed).toBe(1)
    expect(result.runs).toHaveLength(1)
    expect(result.runs[0]!.runId).toBe('')
    expect(result.runs[0]!.triggerId).toBe('trigger_1')
    expect(result.runs[0]!.errorMessage).toContain('Unexpected DB error')
  })

  it('processes remaining triggers after one throws', async () => {
    const t1 = dueTrigger({ id: 'trigger_1' })
    const t2 = dueTrigger({ id: 'trigger_2' })
    let firstClaim = true
    const deps = fakeDeps({
      triggerDispatch: {
        dueTriggers: async () => [t1, t2],
        claimRun: async () => {
          if (firstClaim) {
            firstClaim = false
            throw new Error('boom')
          }
          return claimedRun()
        },
      },
    })
    const result = await dispatchDueScheduledTriggers(deps)
    expect(result.failed).toBe(1)
    expect(result.dispatched).toBe(1)
    expect(result.claimed).toBe(1)
  })

  it('uses trigger.nextDueAt as scheduledFor in the outer error run entry', async () => {
    const trigger = dueTrigger({ nextDueAt: '2026-06-01T12:00:00.000Z' })
    const deps = fakeDeps({
      triggerDispatch: {
        dueTriggers: async () => [trigger],
        claimRun: async () => {
          throw new Error('boom')
        },
      },
    })
    const result = await dispatchDueScheduledTriggers(deps)
    expect(result.runs[0]!.scheduledFor).toBe('2026-06-01T12:00:00.000Z')
  })

  it('converts a non-Error thrown value to a string error message', async () => {
    const trigger = dueTrigger()
    const deps = fakeDeps({
      triggerDispatch: {
        dueTriggers: async () => [trigger],
        claimRun: async () => {
          // eslint-disable-next-line no-throw-literal
          throw 'string-error'
        },
      },
    })
    const result = await dispatchDueScheduledTriggers(deps)
    expect(result.runs[0]!.errorMessage).toBe('string-error')
  })
})

describe('[spec: triggers/http-dispatch] dispatchHttpTrigger', () => {
  it('creates a session with a prompt rendered from request fields', async () => {
    let prompt: string | undefined
    const deps = fakeDeps({
      sessionRuntime: {
        createSession: async (_deps, _auth, input) => {
          prompt = input.options.prompt
          return { ok: true, value: sessionRecord({ metadata: { ...sessionRecord().metadata, uid: 'sess_http' } }) }
        },
      },
    })
    const result = await dispatchHttpTrigger(deps, auth, {
      trigger: httpTrigger(),
      context: {
        body: { ticket: { id: 'T-123' } },
        query: { source: 'portal' },
        headers: {},
      },
    })
    expect(result.state).toBe('dispatched')
    expect(result.sessionId).toBe('sess_http')
    expect(prompt).toBe('Handle T-123 from portal')
  })

  it('creates a run without a reusable session key when the body is not an object', async () => {
    let lookedUpKey: string | null | undefined = 'unset'
    const deps = fakeDeps({
      sessions: {
        findActiveHttpTriggerSession: async (_projectId, _triggerId, key) => {
          lookedUpKey = key
          return null
        },
      },
    })
    const result = await dispatchHttpTrigger(deps, auth, {
      trigger: httpTrigger({
        spec: {
          template: {
            ...httpTrigger().spec.template,
            spec: { ...httpTrigger().spec.template.spec, promptTemplate: 'Handle webhook' },
          },
        },
      }),
      context: {
        body: null,
        query: {},
        headers: {},
      },
    })
    expect(result.state).toBe('dispatched')
    expect(lookedUpKey).toBe('unset')
  })

  it('adds request metadata from the HTTP body to newly created session metadata and run metadata', async () => {
    let sessionMetadata: Record<string, unknown> | undefined
    let runMetadata: Record<string, unknown> | undefined
    const deps = fakeDeps({
      sessionRuntime: {
        createSession: async (_deps, _auth, input) => {
          sessionMetadata = input.options.metadata
          return { ok: true, value: sessionRecord({ metadata: { ...sessionRecord().metadata, uid: 'sess_http' } }) }
        },
      },
      triggerDispatch: {
        markRunDispatched: async (_trigger, _run, _sessionId, metadata) => {
          runMetadata = metadata
        },
      },
    })

    await dispatchHttpTrigger(deps, auth, {
      trigger: httpTrigger({
        spec: {
          template: {
            ...httpTrigger().spec.template,
            metadata: { labels: { maintainerId: 'maintainer_1' }, annotations: { retained: 'true' } },
          },
        },
      }),
      context: {
        body: {
          key: 'github:owner/repo:issue:123',
          ticket: { id: 'T-123' },
          metadata: {
            labels: { subject: 'github-issue' },
            github: {
              repository: 'owner/repo',
              type: 'issue',
              number: 123,
              url: 'https://github.com/owner/repo/issues/123',
            },
          },
        },
        query: { source: 'portal' },
        headers: {},
      },
    })

    expect(sessionMetadata).toMatchObject({
      annotations: { retained: 'true' },
      labels: { maintainerId: 'maintainer_1', subject: 'github-issue' },
      github: {
        repository: 'owner/repo',
        type: 'issue',
        number: 123,
        url: 'https://github.com/owner/repo/issues/123',
      },
      source: 'http-trigger',
      key: 'github:owner/repo:issue:123',
    })
    expect(runMetadata).toMatchObject(sessionMetadata!)
  })

  it('reuses an active HTTP trigger session when request body carries the same key', async () => {
    let markedSessionId: string | null = null
    let messageContent: string | null = null
    const deps = fakeDeps({
      triggerDispatch: {
        markRunDispatched: async (_trigger, _run, sessionId) => {
          markedSessionId = sessionId
        },
      },
      sessions: {
        findActiveHttpTriggerSession: async (_projectId, _triggerId, key) =>
          key === 'github:owner/repo:issue:123'
            ? {
                id: 'sess_existing',
                projectId: 'project_1',
                organizationId: 'org_1',
                state: 'idle',
                archivedAt: null,
                sandboxId: 'sandbox_1',
                metadata: { source: 'http-trigger', httpTriggerId: 'http_trigger_1', key },
              }
            : null,
        insertMessage: async (record) => {
          messageContent = record.content
          return sessionMessageRecord({ sessionId: record.sessionId, content: record.content })
        },
      },
    })
    const result = await dispatchHttpTrigger(deps, auth, {
      trigger: httpTrigger({ metadata: { uid: 'http_trigger_1' } }),
      context: {
        body: { key: 'github:owner/repo:issue:123', ticket: { id: 'T-123' } },
        query: { source: 'portal' },
        headers: {},
      },
    })

    expect(result).toMatchObject({ state: 'dispatched', sessionId: 'sess_existing' })
    expect(markedSessionId).toBe('sess_existing')
    expect(messageContent).toBe('Handle T-123 from portal')
    expect(runtimeSessions.createSession).not.toHaveBeenCalled()
  })

  it('records request metadata on runs that reuse an existing keyed session', async () => {
    let markedMetadata: Record<string, unknown> | null = null
    const deps = fakeDeps({
      triggerDispatch: {
        markRunDispatched: async (_trigger, _run, _sessionId, metadata) => {
          markedMetadata = metadata
        },
      },
      sessions: {
        findActiveHttpTriggerSession: async () => ({
          id: 'sess_existing',
          projectId: 'project_1',
          organizationId: 'org_1',
          state: 'idle',
          archivedAt: null,
          sandboxId: 'sandbox_1',
          metadata: {},
        }),
      },
    })

    await dispatchHttpTrigger(deps, auth, {
      trigger: httpTrigger({ metadata: { uid: 'http_trigger_1' } }),
      context: {
        body: {
          key: 'github:owner/repo:pull:456',
          ticket: { id: 'T-123' },
          metadata: {
            github: {
              repository: 'owner/repo',
              type: 'pull',
              number: 456,
              url: 'https://github.com/owner/repo/pull/456',
            },
          },
        },
        query: { source: 'portal' },
        headers: {},
      },
    })

    expect(markedMetadata).toMatchObject({
      source: 'http-trigger',
      httpTriggerId: 'http_trigger_1',
      key: 'github:owner/repo:pull:456',
      reusedSession: true,
      github: {
        repository: 'owner/repo',
        type: 'pull',
        number: 456,
        url: 'https://github.com/owner/repo/pull/456',
      },
    })
  })

  it('queues a message when reusing a pending HTTP trigger session with the same key', async () => {
    let markedSessionId: string | null = null
    let inserted: Parameters<Deps['sessions']['insertMessage']>[0] | null = null
    const deps = fakeDeps({
      triggerDispatch: {
        markRunDispatched: async (_trigger, _run, sessionId) => {
          markedSessionId = sessionId
        },
      },
      sessions: {
        findActiveHttpTriggerSession: async (_projectId, _triggerId, key) =>
          key === 'github:owner/repo:issue:123'
            ? {
                id: 'sess_pending',
                projectId: 'project_1',
                organizationId: 'org_1',
                state: 'pending',
                archivedAt: null,
                sandboxId: null,
                metadata: { source: 'http-trigger', httpTriggerId: 'http_trigger_1', key },
              }
            : null,
        insertMessage: async (record) => {
          inserted = record
          return sessionMessageRecord({ sessionId: record.sessionId, content: record.content })
        },
      },
    })

    const result = await dispatchHttpTrigger(deps, auth, {
      trigger: httpTrigger({ metadata: { uid: 'http_trigger_1' } }),
      context: {
        body: { key: 'github:owner/repo:issue:123', ticket: { id: 'T-123' } },
        query: { source: 'portal' },
        headers: {},
      },
    })

    expect(result).toMatchObject({ state: 'dispatched', sessionId: 'sess_pending' })
    expect(markedSessionId).toBe('sess_pending')
    expect(inserted).toMatchObject({
      sessionId: 'sess_pending',
      content: 'Handle T-123 from portal',
      delivery: 'queued',
      state: 'accepted',
    })
    expect(runtimeSessions.dispatchPrompt).not.toHaveBeenCalled()
    expect(runtimeSessions.createSession).not.toHaveBeenCalled()
  })

  it('fails the HTTP run when sending to a reused keyed session fails', async () => {
    let markedMessage: string | null = null
    let auditOutcome: string | null = null
    const deps = fakeDeps({
      triggerDispatch: {
        markRunFailed: async (_trigger, _run, message) => {
          markedMessage = message
        },
      },
      sessions: {
        findActiveHttpTriggerSession: async () => ({
          id: 'sess_existing',
          projectId: 'project_1',
          organizationId: 'org_1',
          state: 'idle',
          archivedAt: null,
          sandboxId: 'sandbox_1',
          metadata: {
            source: 'http-trigger',
            httpTriggerId: 'http_trigger_1',
            key: 'github:owner/repo:issue:123',
          },
        }),
      },
      audit: {
        record: async (_auth, entry) => {
          auditOutcome = (entry as { outcome?: string }).outcome ?? null
        },
      },
    })
    vi.mocked(runtimeSessions.dispatchPrompt).mockImplementation(async () => ({
      ok: false,
      status: 409,
      message: 'Session is not accepting prompts',
    }))

    const result = await dispatchHttpTrigger(deps, auth, {
      trigger: httpTrigger({ metadata: { uid: 'http_trigger_1' } }),
      context: {
        body: { key: 'github:owner/repo:issue:123', ticket: { id: 'T-123' } },
        query: { source: 'portal' },
        headers: {},
      },
    })

    expect(result).toMatchObject({
      state: 'failed',
      sessionId: null,
      errorMessage: 'Session is not accepting prompts',
    })
    expect(markedMessage).toBe('Session is not accepting prompts')
    expect(auditOutcome).toBe('failure')
    expect(runtimeSessions.createSession).not.toHaveBeenCalled()
  })

  it('passes HTTP trigger env and envFrom through to createSession', async () => {
    const envFrom = [
      {
        type: 'secret' as const,
        name: 'AK_AGENT_KEY',
        secretRef: 'ama://vaults/vault_1/credentials/cred_1/versions/ver_1',
      },
    ]
    const trigger = httpTrigger({
      spec: {
        template: {
          ...httpTrigger().spec.template,
          spec: {
            ...httpTrigger().spec.template.spec,
            env: { AK_AGENT_ID: 'agent_1', AK_SESSION_ID: 'ak_session_1' },
            envFrom,
          },
        },
      },
    })
    let capturedOptions: Record<string, unknown> | null = null
    const deps = fakeDeps({
      sessionRuntime: {
        createSession: async (_deps, _auth, input) => {
          capturedOptions = input.options as unknown as Record<string, unknown>
          return { ok: true, value: sessionRecord({ metadata: { ...sessionRecord().metadata, uid: 'sess_http' } }) }
        },
      },
    })
    await dispatchHttpTrigger(deps, auth, {
      trigger,
      context: {
        body: { ticket: { id: 'T-123' } },
        query: { source: 'portal' },
        headers: {},
      },
    })
    expect(capturedOptions).toMatchObject({ env: trigger.spec.template.spec.env, envFrom })
  })

  it('records the HTTP session key on newly created trigger run metadata', async () => {
    let markedMetadata: Record<string, unknown> | null = null
    const deps = fakeDeps({
      triggerDispatch: {
        markRunDispatched: async (_trigger, _run, _sessionId, metadata) => {
          markedMetadata = metadata
        },
      },
    })

    await dispatchHttpTrigger(deps, auth, {
      trigger: httpTrigger({ metadata: { uid: 'http_trigger_1' } }),
      context: {
        body: { key: 'github:owner/repo:issue:123', ticket: { id: 'T-123' } },
        query: { source: 'portal' },
        headers: {},
      },
    })

    expect(markedMetadata).toMatchObject({
      source: 'http-trigger',
      httpTriggerId: 'http_trigger_1',
      key: 'github:owner/repo:issue:123',
    })
  })

  it('rejects a missing template variable before claiming a run', async () => {
    let claimed = false
    const deps = fakeDeps({
      triggerDispatch: {
        claimHttpRun: async () => {
          claimed = true
          return claimedRun()
        },
      },
    })
    await expect(
      dispatchHttpTrigger(deps, auth, {
        trigger: httpTrigger(),
        context: { body: {}, query: { source: 'portal' }, headers: {} },
      }),
    ).rejects.toMatchObject({ name: 'TriggerValidationError' })
    expect(claimed).toBe(false)
  })

  it('rejects scheduled triggers at the HTTP dispatch entry', async () => {
    await expect(
      dispatchHttpTrigger(fakeDeps(), auth, {
        trigger: httpTrigger({
          spec: {
            source: { type: 'schedule', schedule: { type: 'interval', intervalSeconds: 3600, windowSeconds: 0 } },
          },
        }),
        context: { body: {}, query: {}, headers: {} },
      }),
    ).rejects.toMatchObject({ name: 'TriggerConflictError' })
  })

  it('rejects suspended HTTP triggers', async () => {
    await expect(
      dispatchHttpTrigger(fakeDeps(), auth, {
        trigger: httpTrigger({ spec: { suspend: true } }),
        context: { body: {}, query: {}, headers: {} },
      }),
    ).rejects.toMatchObject({ name: 'TriggerConflictError' })
  })

  it('rejects archived HTTP triggers', async () => {
    await expect(
      dispatchHttpTrigger(fakeDeps(), auth, {
        trigger: httpTrigger({
          metadata: { archivedAt: '2026-01-02T00:00:00.000Z' },
          status: { phase: 'archived' },
        }),
        context: { body: {}, query: {}, headers: {} },
      }),
    ).rejects.toMatchObject({ name: 'TriggerConflictError' })
  })

  it('rejects duplicate idempotency keys', async () => {
    const deps = fakeDeps({ triggerDispatch: { claimHttpRun: async () => null } })
    await expect(
      dispatchHttpTrigger(deps, auth, {
        trigger: httpTrigger(),
        context: { body: { ticket: { id: 'T-123' } }, query: { source: 'portal' }, headers: {} },
        idempotencyKey: 'same-key',
      }),
    ).rejects.toMatchObject({ name: 'TriggerConflictError' })
  })

  it('marks an HTTP run failed when session creation fails', async () => {
    let markedMessage: string | null = null
    let auditOutcome: string | null = null
    const deps = fakeDeps({
      triggerDispatch: {
        markRunFailed: async (_trigger, _run, message) => {
          markedMessage = message
        },
      },
      sessionRuntime: {
        createSession: async () => ({
          ok: false,
          error: { status: 400, code: 'validation', message: 'Invalid agent' },
        }),
      },
      audit: {
        record: async (_auth, entry) => {
          auditOutcome = (entry as { outcome?: string }).outcome ?? null
        },
      },
    })
    const result = await dispatchHttpTrigger(deps, auth, {
      trigger: httpTrigger(),
      context: { body: { ticket: { id: 'T-123' } }, query: { source: 'portal' }, headers: {} },
    })
    expect(result).toMatchObject({ state: 'failed', sessionId: null, errorMessage: 'Invalid agent' })
    expect(markedMessage).toBe('Invalid agent')
    expect(auditOutcome).toBe('failure')
  })

  it('propagates unexpected template rendering errors', async () => {
    const body = {}
    Object.defineProperty(body, 'ticket', {
      get() {
        throw new Error('getter failed')
      },
    })
    await expect(
      dispatchHttpTrigger(fakeDeps(), auth, {
        trigger: httpTrigger(),
        context: { body, query: { source: 'portal' }, headers: {} },
      }),
    ).rejects.toThrow('getter failed')
  })
})

describe('[spec: triggers/inactive] dispatchDueScheduledTriggers — no-op when inactive', () => {
  it('does not create sessions when dueTriggers returns empty', async () => {
    let created = false
    const deps = fakeDeps({
      triggerDispatch: {
        dueTriggers: async () => [],
      },
      sessionRuntime: {
        createSession: async () => {
          created = true
          return { ok: true, value: sessionRecord() }
        },
      },
    })
    await dispatchDueScheduledTriggers(deps)
    expect(created).toBe(false)
  })
})
