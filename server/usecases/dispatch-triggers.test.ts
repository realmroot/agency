import { resourceMetadata } from '@server/domain/resource'
import type { Session, SessionMessage } from '@server/domain/session'
import type { Trigger } from '@server/domain/trigger'
import { AMA_ANNOTATION_KEY_ROUTING_KEY_HASH } from '@server/metadata-keys'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Deps } from './deps'
import type {
  AuthScope,
  ClaimedRun,
  DueTrigger,
  PendingHttpRun,
  RuntimeSessionHandle,
  StalePendingHttpRun,
} from './ports'

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

import {
  consumeSerialHttpTriggerWake,
  dispatchDueScheduledTriggers,
  dispatchHttpTrigger,
  dispatchNextSerialHttpTrigger,
  recoverSerialHttpTriggers,
  wakeSerialHttpTriggerForSettledSession,
} from './dispatch-triggers'
import * as runtimeSessions from './runtime/sessions'

type RuntimeSessionOverrides = {
  createSession?: typeof runtimeSessions.createSession
  reopenSession?: typeof runtimeSessions.reopenSession
}

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
          promptTemplate: 'Handle {{ .body.ticket.id }} from {{ .body.source }}',
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

function serialHttpTrigger(triggerId = 'trigger_http'): Trigger {
  return httpTrigger({
    metadata: { uid: triggerId },
    spec: { source: { type: 'http', concurrency: { mode: 'serial' } } },
  })
}

function claimedRun(overrides: Partial<ClaimedRun> = {}): ClaimedRun {
  return {
    id: 'run_1',
    scheduledFor: '2026-01-01T00:00:00.000Z',
    correlationId: 'corr_1',
    metadata: {},
    ...overrides,
  }
}

function pendingRun(
  overrides: Omit<Partial<PendingHttpRun>, 'run'> & { run?: Partial<ClaimedRun> } = {},
): PendingHttpRun {
  const { run, ...fields } = overrides
  return {
    run: claimedRun({ id: 'httprun_pending', ...run }),
    triggerId: 'trigger_http',
    organizationId: 'org_1',
    organizationName: 'Org',
    projectId: 'project_1',
    projectName: 'Project',
    requestedByUserId: 'user_1',
    routingKeyHash: null,
    renderedPrompt: 'Handle T-123 from portal',
    ...fields,
  }
}

function stalePendingRun(
  overrides: Omit<Partial<StalePendingHttpRun>, 'run'> & { run?: Partial<ClaimedRun> } = {},
): StalePendingHttpRun {
  const { existingSession, ...pending } = overrides
  return { ...pendingRun(pending), existingSession: existingSession ?? null }
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
            realmroot: null,
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

function runtimeSession(overrides: Partial<RuntimeSessionHandle> = {}): RuntimeSessionHandle {
  return {
    id: 'sess_existing',
    projectId: 'project_1',
    organizationId: 'org_1',
    state: 'idle',
    archivedAt: null,
    sandboxId: 'sandbox_1',
    metadata: {
      source: 'http-trigger',
      httpTriggerId: 'http_trigger_1',
      annotations: { [AMA_ANNOTATION_KEY_ROUTING_KEY_HASH]: 'key_hash' },
    },
    ...overrides,
  }
}

function fakeDeps(
  overrides: {
    triggerDispatch?: Partial<Deps['triggerDispatch']>
    sessionRuntime?: RuntimeSessionOverrides
    sessions?: Partial<Deps['sessions']>
    audit?: Partial<Deps['audit']>
    triggers?: Partial<Deps['triggers']>
    triggerDispatchQueue?: Deps['triggerDispatchQueue']
    sessionOrchestration?: Partial<Deps['sessionOrchestration']>
  } = {},
): Deps {
  const triggerDispatch: Deps['triggerDispatch'] = {
    dueTriggers: async () => [],
    claimRun: async () => claimedRun(),
    claimHttpRun: async () => claimedRun({ id: 'httprun_1', scheduledFor: '2026-01-01T00:00:00.000Z' }),
    enqueueHttpRun: async () => ({ replayed: false, run: claimedRun(), wake: true }),
    claimNextHttpRun: async () => null,
    requeueHttpRun: async () => {},
    staleHttpRuns: async () => [],
    hasPendingHttpRuns: async () => false,
    pendingHttpTriggers: async () => [],
    projectName: async () => 'My Project',
    markRunFailed: async () => {},
    markRunDispatched: async () => {},
    ...overrides.triggerDispatch,
  }
  vi.mocked(runtimeSessions.createSession).mockImplementation(
    overrides.sessionRuntime?.createSession ?? (async () => ({ ok: true, value: sessionRecord() })),
  )
  vi.mocked(runtimeSessions.reopenSession).mockImplementation(
    overrides.sessionRuntime?.reopenSession ??
      (async (_deps, _auth, session) => ({
        ok: true,
        value: sessionRecord({
          metadata: { ...sessionRecord().metadata, uid: session.id },
          status: { ...sessionRecord().status, phase: 'idle' },
        }),
      })),
  )
  vi.mocked(runtimeSessions.dispatchPrompt).mockImplementation(async () => ({
    ok: true,
    delivery: 'queued',
    state: 'accepted',
  }))
  const sessionsRepo = {
    findReusableHttpTriggerSession: async () => null,
    findRuntimeRow: async (_projectId: string, sessionId: string) => runtimeSession({ id: sessionId, state: 'idle' }),
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
    triggers: overrides.triggers as Deps['triggers'],
    ...(overrides.triggerDispatchQueue ? { triggerDispatchQueue: overrides.triggerDispatchQueue } : {}),
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
    sessionOrchestration: {
      findSession: async () => null,
      ...overrides.sessionOrchestration,
    } as Deps['sessionOrchestration'],
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
      annotations: {
        env: 'staging',
        source: 'scheduled-agent-trigger',
        scheduledTriggerId: 'trigger_1',
      },
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
  const issueKeyHash = 'c54d83738741c7e14509b968123cae0c54ca45e644a54f7f3f863de4ca70e655'
  const pullKeyHash = '65fb13105a39fcbae2c3444031759996a62b7b4be7251baec618dd9dd3b128dc'

  it('creates a session with a prompt rendered from request fields', async () => {
    let prompt: string | undefined
    const baseTrigger = httpTrigger()
    const deps = fakeDeps({
      sessionRuntime: {
        createSession: async (_deps, _auth, input) => {
          prompt = input.options.prompt
          return { ok: true, value: sessionRecord({ metadata: { ...sessionRecord().metadata, uid: 'sess_http' } }) }
        },
      },
    })
    const result = await dispatchHttpTrigger(deps, auth, {
      trigger: httpTrigger({
        spec: {
          template: {
            ...baseTrigger.spec.template,
            spec: {
              ...baseTrigger.spec.template.spec,
              promptTemplate:
                '{% if .ama.run.session_reused == false %}New{% else %}Reused{% endif %} {{ .body.ticket.id }} from {{ .body.source }}',
            },
          },
        },
      }),
      context: {
        body: { ticket: { id: 'T-123' }, source: 'portal' },
        header: {},
      },
    })
    expect(result.state).toBe('dispatched')
    expect(result.sessionId).toBe('sess_http')
    expect(prompt).toBe('New T-123 from portal')
  })

  it('creates a run without a reusable routing key when the body is not an object', async () => {
    let lookedUpKey: string | null | undefined = 'unset'
    const deps = fakeDeps({
      sessions: {
        findReusableHttpTriggerSession: async (_projectId, _triggerId, key) => {
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
        header: {},
      },
    })
    expect(result.state).toBe('dispatched')
    expect(lookedUpKey).toBe('unset')
  })

  it('adds request metadata from the HTTP body to newly created session metadata and run metadata', async () => {
    let sessionMetadata: Pick<Trigger['metadata'], 'labels' | 'annotations'> | undefined
    let runMetadata: Record<string, unknown> | undefined
    let markedMetadata: Pick<Trigger['metadata'], 'labels' | 'annotations'> | undefined
    const deps = fakeDeps({
      sessionRuntime: {
        createSession: async (_deps, _auth, input) => {
          sessionMetadata = input.options.metadata
          return { ok: true, value: sessionRecord({ metadata: { ...sessionRecord().metadata, uid: 'sess_http' } }) }
        },
      },
      triggerDispatch: {
        claimHttpRun: async (_auth, _trigger, _triggeredAt, _idempotencyKey, metadata) => {
          runMetadata = metadata
          return claimedRun({ id: 'httprun_1', metadata })
        },
        markRunDispatched: async (_trigger, _run, _sessionId, metadata) => {
          markedMetadata = metadata
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
          routing_key: 'github:owner/repo:issue:123',
          ticket: { id: 'T-123' },
          metadata: {
            labels: { subject: 'github-issue', ignored: 123 },
            annotations: { externalUrl: 'https://github.com/owner/repo/issues/123', ignored: false },
            github: {
              repository: 'owner/repo',
              type: 'issue',
              number: 123,
              url: 'https://github.com/owner/repo/issues/123',
            },
          },
        },
        header: {},
      },
    })

    expect(sessionMetadata).toMatchObject({
      annotations: {
        retained: 'true',
        externalUrl: 'https://github.com/owner/repo/issues/123',
        [AMA_ANNOTATION_KEY_ROUTING_KEY_HASH]: issueKeyHash,
      },
      labels: { maintainerId: 'maintainer_1', subject: 'github-issue' },
    })
    expect(sessionMetadata).not.toHaveProperty('github')
    expect(sessionMetadata?.labels).not.toHaveProperty('ignored')
    expect(sessionMetadata?.annotations).not.toHaveProperty('ignored')
    expect(runMetadata).toMatchObject({
      annotations: {
        externalUrl: 'https://github.com/owner/repo/issues/123',
      },
      labels: { subject: 'github-issue' },
    })
    expect(runMetadata).not.toHaveProperty('github')
    expect(markedMetadata).toMatchObject(sessionMetadata!)
  })

  it('ignores unsupported HTTP request metadata fields and non-string map entries', async () => {
    let sessionMetadata: Pick<Trigger['metadata'], 'labels' | 'annotations'> | undefined
    const deps = fakeDeps({
      sessionRuntime: {
        createSession: async (_deps, _auth, input) => {
          sessionMetadata = input.options.metadata
          return { ok: true, value: sessionRecord({ metadata: { ...sessionRecord().metadata, uid: 'sess_http' } }) }
        },
      },
    })

    await dispatchHttpTrigger(deps, auth, {
      trigger: httpTrigger(),
      context: {
        body: {
          ticket: { id: 'T-123' },
          metadata: {
            labels: { subject: 'github-issue', priority: 2 },
            annotations: { externalId: 'issue-123', payload: { nested: true } },
            github: { repository: 'owner/repo' },
          },
        },
        header: {},
      },
    })

    expect(sessionMetadata).toMatchObject({
      labels: { subject: 'github-issue' },
      annotations: { externalId: 'issue-123', source: 'http-trigger' },
    })
    expect(sessionMetadata).not.toHaveProperty('github')
    expect(sessionMetadata?.labels).not.toHaveProperty('priority')
    expect(sessionMetadata?.annotations).not.toHaveProperty('payload')
  })

  it('keeps system HTTP annotations authoritative over request annotations', async () => {
    let sessionMetadata: Pick<Trigger['metadata'], 'labels' | 'annotations'> | undefined
    const deps = fakeDeps({
      sessionRuntime: {
        createSession: async (_deps, _auth, input) => {
          sessionMetadata = input.options.metadata
          return { ok: true, value: sessionRecord({ metadata: { ...sessionRecord().metadata, uid: 'sess_http' } }) }
        },
      },
    })

    await dispatchHttpTrigger(deps, auth, {
      trigger: httpTrigger({ metadata: { uid: 'http_trigger_1' } }),
      context: {
        body: {
          ticket: { id: 'T-123' },
          metadata: { annotations: { source: 'spoofed', httpTriggerId: 'spoofed', correlationId: 'spoofed' } },
        },
        header: {},
      },
    })

    expect(sessionMetadata?.annotations).toMatchObject({
      source: 'http-trigger',
      httpTriggerId: 'http_trigger_1',
      correlationId: 'corr_1',
    })
  })

  it('reuses an active HTTP trigger session when request body carries the same routing key', async () => {
    let markedSessionId: string | null = null
    let messageContent: string | null = null
    const baseTrigger = httpTrigger()
    const deps = fakeDeps({
      triggerDispatch: {
        markRunDispatched: async (_trigger, _run, sessionId) => {
          markedSessionId = sessionId
        },
      },
      sessions: {
        findReusableHttpTriggerSession: async (_projectId, _triggerId, keyHash) =>
          keyHash === issueKeyHash
            ? runtimeSession({ metadata: { annotations: { [AMA_ANNOTATION_KEY_ROUTING_KEY_HASH]: keyHash } } })
            : null,
        insertMessage: async (record) => {
          messageContent = record.content
          return sessionMessageRecord({ sessionId: record.sessionId, content: record.content })
        },
      },
    })
    vi.mocked(runtimeSessions.dispatchPrompt).mockImplementation(async (_deps, _auth, _sessionId, content) => {
      messageContent = content
      return { ok: true, delivery: 'queued', state: 'accepted' }
    })
    const result = await dispatchHttpTrigger(deps, auth, {
      trigger: httpTrigger({
        metadata: { uid: 'http_trigger_1' },
        spec: {
          template: {
            ...baseTrigger.spec.template,
            spec: {
              ...baseTrigger.spec.template.spec,
              promptTemplate:
                '{% if .ama.run.session_reused %}Reused {{ .ama.run.session_id }} {{ .ama.run.session_state }}{% else %}New{% endif %} {{ .body.ticket.id }}',
            },
          },
        },
      }),
      context: {
        body: { routing_key: 'github:owner/repo:issue:123', ticket: { id: 'T-123' }, source: 'portal' },
        header: {},
      },
    })

    expect(result).toMatchObject({ state: 'dispatched', sessionId: 'sess_existing' })
    expect(markedSessionId).toBe('sess_existing')
    expect(messageContent).toBe('Reused sess_existing idle T-123')
    expect(runtimeSessions.createSession).not.toHaveBeenCalled()
  })

  it('records request metadata on runs that reuse an existing routing-keyed session', async () => {
    let runMetadata: Record<string, unknown> | undefined
    let markedMetadata: Pick<Trigger['metadata'], 'labels' | 'annotations'> | null = null
    const deps = fakeDeps({
      triggerDispatch: {
        claimHttpRun: async (_auth, _trigger, _triggeredAt, _idempotencyKey, metadata) => {
          runMetadata = metadata
          return claimedRun({ id: 'httprun_1', metadata })
        },
        markRunDispatched: async (_trigger, _run, _sessionId, metadata) => {
          markedMetadata = metadata
        },
      },
      sessions: {
        findReusableHttpTriggerSession: async () => runtimeSession({ metadata: {} }),
      },
    })

    await dispatchHttpTrigger(deps, auth, {
      trigger: httpTrigger({ metadata: { uid: 'http_trigger_1' } }),
      context: {
        body: {
          routing_key: 'github:owner/repo:pull:456',
          ticket: { id: 'T-123' },
          metadata: {
            labels: { subject: 'github-pull' },
            annotations: { externalUrl: 'https://github.com/owner/repo/pull/456' },
            github: { repository: 'owner/repo' },
          },
        },
        header: {},
      },
    })

    expect(runMetadata).toMatchObject({
      labels: { subject: 'github-pull' },
      annotations: { externalUrl: 'https://github.com/owner/repo/pull/456' },
    })
    expect(markedMetadata).toMatchObject({
      labels: { subject: 'github-pull' },
      annotations: {
        source: 'http-trigger',
        httpTriggerId: 'http_trigger_1',
        [AMA_ANNOTATION_KEY_ROUTING_KEY_HASH]: pullKeyHash,
        reusedSession: 'true',
        externalUrl: 'https://github.com/owner/repo/pull/456',
      },
    })
    expect(markedMetadata).not.toHaveProperty('github')
    expect(runtimeSessions.createSession).not.toHaveBeenCalled()
  })

  it('queues a message when reusing a pending HTTP trigger session with the same routing key', async () => {
    let markedSessionId: string | null = null
    let inserted: Parameters<Deps['sessions']['insertMessage']>[0] | null = null
    const deps = fakeDeps({
      triggerDispatch: {
        markRunDispatched: async (_trigger, _run, sessionId) => {
          markedSessionId = sessionId
        },
      },
      sessions: {
        findReusableHttpTriggerSession: async (_projectId, _triggerId, keyHash) =>
          keyHash === issueKeyHash
            ? runtimeSession({
                id: 'sess_pending',
                state: 'pending',
                sandboxId: null,
                metadata: {
                  source: 'http-trigger',
                  httpTriggerId: 'http_trigger_1',
                  annotations: { [AMA_ANNOTATION_KEY_ROUTING_KEY_HASH]: keyHash },
                },
              })
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
        body: { routing_key: 'github:owner/repo:issue:123', ticket: { id: 'T-123' }, source: 'portal' },
        header: {},
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

  it('reopens and reuses a closed HTTP trigger session with the same routing key', async () => {
    let markedSessionId: string | null = null
    let reopenedRequestId: string | null = null
    let dispatchedSessionId: string | null = null
    let dispatchedPrompt: string | null = null
    const deps = fakeDeps({
      triggerDispatch: {
        markRunDispatched: async (_trigger, _run, sessionId) => {
          markedSessionId = sessionId
        },
      },
      sessionRuntime: {
        reopenSession: async (_deps, _auth, session, requestId) => {
          reopenedRequestId = requestId
          return {
            ok: true,
            value: sessionRecord({
              metadata: { ...sessionRecord().metadata, uid: session.id },
              status: { ...sessionRecord().status, phase: 'idle' },
            }),
          }
        },
      },
      sessions: {
        findReusableHttpTriggerSession: async () =>
          runtimeSession({ id: 'sess_closed', state: 'closed', sandboxId: null }),
        findRuntimeRow: async (_projectId, sessionId) =>
          runtimeSession({ id: sessionId, state: 'idle', sandboxId: null }),
      },
    })
    let dispatchedRequestId: string | null | undefined
    vi.mocked(runtimeSessions.dispatchPrompt).mockImplementation(async (_deps, _auth, session, content, requestId) => {
      dispatchedSessionId = session.id
      dispatchedPrompt = content
      dispatchedRequestId = requestId
      return { ok: true, delivery: 'queued', state: 'accepted' }
    })

    const result = await dispatchHttpTrigger(deps, auth, {
      trigger: httpTrigger({ metadata: { uid: 'http_trigger_1' } }),
      context: {
        body: { routing_key: 'github:owner/repo:issue:123', ticket: { id: 'T-123' }, source: 'portal' },
        header: {},
      },
    })

    expect(result).toMatchObject({ state: 'dispatched', sessionId: 'sess_closed' })
    expect(markedSessionId).toBe('sess_closed')
    expect(reopenedRequestId).toBe('corr_1')
    expect(dispatchedSessionId).toBe('sess_closed')
    expect(dispatchedPrompt).toBe('Handle T-123 from portal')
    expect(dispatchedRequestId).toBe('corr_1')
    expect(runtimeSessions.createSession).not.toHaveBeenCalled()
  })

  it('does not create another HTTP trigger session when a reusable routing-keyed session is unhealthy', async () => {
    let markedMessage: string | null = null
    const deps = fakeDeps({
      triggerDispatch: {
        markRunFailed: async (_trigger, _run, message) => {
          markedMessage = message
        },
      },
      sessions: {
        findReusableHttpTriggerSession: async () =>
          runtimeSession({ id: 'sess_error', state: 'error', sandboxId: null }),
      },
    })
    vi.mocked(runtimeSessions.dispatchPrompt).mockImplementation(async () => ({
      ok: false,
      status: 409,
      message: 'Session runtime is not active',
    }))

    const result = await dispatchHttpTrigger(deps, auth, {
      trigger: httpTrigger({ metadata: { uid: 'http_trigger_1' } }),
      context: {
        body: { routing_key: 'github:owner/repo:issue:123', ticket: { id: 'T-123' }, source: 'portal' },
        header: {},
      },
    })

    expect(result).toMatchObject({
      state: 'failed',
      sessionId: null,
      errorMessage: 'Session runtime is not active',
    })
    expect(markedMessage).toBe('Session runtime is not active')
    expect(runtimeSessions.createSession).not.toHaveBeenCalled()
  })

  it('fails the HTTP run when sending to a reused routing-keyed session fails', async () => {
    let markedMessage: string | null = null
    let auditOutcome: string | null = null
    const deps = fakeDeps({
      triggerDispatch: {
        markRunFailed: async (_trigger, _run, message) => {
          markedMessage = message
        },
      },
      sessions: {
        findReusableHttpTriggerSession: async () => runtimeSession(),
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
        body: { routing_key: 'github:owner/repo:issue:123', ticket: { id: 'T-123' } },
        header: {},
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
        body: { ticket: { id: 'T-123' }, source: 'portal' },
        header: {},
      },
    })
    expect(capturedOptions).toMatchObject({ env: trigger.spec.template.spec.env, envFrom })
  })

  it('records the HTTP routing key on newly created trigger run metadata', async () => {
    let markedMetadata: Pick<Trigger['metadata'], 'labels' | 'annotations'> | null = null
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
        body: { routing_key: 'github:owner/repo:issue:123', ticket: { id: 'T-123' } },
        header: {},
      },
    })

    expect(markedMetadata).toMatchObject({
      labels: {},
      annotations: {
        source: 'http-trigger',
        httpTriggerId: 'http_trigger_1',
        [AMA_ANNOTATION_KEY_ROUTING_KEY_HASH]: issueKeyHash,
      },
    })
  })

  it('renders missing template variables as empty text', async () => {
    let capturedPrompt: string | null = null
    const deps = fakeDeps({
      sessionRuntime: {
        createSession: async (_deps, _auth, input) => {
          capturedPrompt = input.options.prompt
          return { ok: true, value: sessionRecord() }
        },
      },
    })
    const result = await dispatchHttpTrigger(deps, auth, {
      trigger: httpTrigger(),
      context: { body: { source: 'portal' }, header: {} },
    })
    expect(result).toMatchObject({ state: 'dispatched' })
    expect(capturedPrompt).toBe('Handle  from portal')
  })

  it('rejects scheduled triggers at the HTTP dispatch entry', async () => {
    await expect(
      dispatchHttpTrigger(fakeDeps(), auth, {
        trigger: httpTrigger({
          spec: {
            source: { type: 'schedule', schedule: { type: 'interval', intervalSeconds: 3600, windowSeconds: 0 } },
          },
        }),
        context: { body: { source: 'portal' }, header: {} },
      }),
    ).rejects.toMatchObject({ name: 'TriggerConflictError' })
  })

  it('rejects suspended HTTP triggers', async () => {
    await expect(
      dispatchHttpTrigger(fakeDeps(), auth, {
        trigger: httpTrigger({ spec: { suspend: true } }),
        context: { body: { source: 'portal' }, header: {} },
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
        context: { body: { source: 'portal' }, header: {} },
      }),
    ).rejects.toMatchObject({ name: 'TriggerConflictError' })
  })

  it('rejects duplicate idempotency keys', async () => {
    const deps = fakeDeps({ triggerDispatch: { claimHttpRun: async () => null } })
    await expect(
      dispatchHttpTrigger(deps, auth, {
        trigger: httpTrigger(),
        context: { body: { ticket: { id: 'T-123' }, source: 'portal' }, header: {} },
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
      context: { body: { ticket: { id: 'T-123' }, source: 'portal' }, header: {} },
    })
    expect(result).toMatchObject({ state: 'failed', sessionId: null, errorMessage: 'Invalid agent' })
    expect(markedMessage).toBe('Invalid agent')
    expect(auditOutcome).toBe('failure')
  })

  it('rejects an invalid prompt template before claiming a run', async () => {
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
        trigger: httpTrigger({
          spec: {
            template: {
              metadata: { labels: {}, annotations: {} },
              spec: {
                agentId: 'agent_1',
                environmentId: 'env_1',
                runtime: 'ama',
                promptTemplate: '{% if .body.ticket.id %}Ticket',
                env: {},
                envFrom: [],
                volumes: [],
                volumeMounts: [],
              },
            },
          },
        }),
        context: { body: { ticket: { id: 'T-123' }, source: 'portal' }, header: {} },
      }),
    ).rejects.toMatchObject({ name: 'TriggerValidationError' })
    expect(claimed).toBe(false)
  })
})

describe('[spec: triggers/http-serial-dispatch] serial HTTP trigger dispatch', () => {
  it('wakes the serial trigger queue when its HTTP session settles', async () => {
    const wakeups: Array<{ type: string; projectId: string; triggerId: string }> = []
    const deps = fakeDeps({
      triggers: { find: async () => serialHttpTrigger() },
      sessionOrchestration: {
        findSession: async () =>
          ({
            state: 'idle',
            metadata: JSON.stringify({ annotations: { source: 'http-trigger', httpTriggerId: 'trigger_http' } }),
          }) as never,
      },
      triggerDispatchQueue: {
        configured: () => true,
        enqueue: async (message) => {
          wakeups.push(message)
        },
      },
    })

    await expect(wakeSerialHttpTriggerForSettledSession(deps, 'project_1', 'sess_1')).resolves.toBe(true)
    expect(wakeups).toEqual([{ type: 'trigger.dispatch', projectId: 'project_1', triggerId: 'trigger_http' }])
  })

  it.each([
    ['missing session', null],
    ['pending session', { state: 'pending', metadata: null }],
    ['running session', { state: 'running', metadata: null }],
    ['unrelated idle session', { state: 'idle', metadata: null }],
    [
      'idle session without an HTTP trigger id',
      { state: 'idle', metadata: JSON.stringify({ annotations: { source: 'http-trigger' } }) },
    ],
  ])('does not wake for a %s', async (_label, session) => {
    const findTrigger = vi.fn()
    const deps = fakeDeps({
      triggers: { find: findTrigger },
      sessionOrchestration: { findSession: async () => session as never },
    })

    await expect(wakeSerialHttpTriggerForSettledSession(deps, 'project_1', 'sess_1')).resolves.toBe(false)
    expect(findTrigger).not.toHaveBeenCalled()
  })

  it('does not wake a parallel HTTP trigger after its session settles', async () => {
    const deps = fakeDeps({
      triggers: { find: async () => httpTrigger() },
      sessionOrchestration: {
        findSession: async () =>
          ({
            state: 'idle',
            metadata: JSON.stringify({ annotations: { source: 'http-trigger', httpTriggerId: 'trigger_http' } }),
          }) as never,
      },
    })

    await expect(wakeSerialHttpTriggerForSettledSession(deps, 'project_1', 'sess_1')).resolves.toBe(false)
  })

  it('dispatches the FIFO head and leaves a different routing key queued while that session is active', async () => {
    const enqueuedRuns = [
      pendingRun({ run: { id: 'httprun_first', correlationId: 'http:first' }, renderedPrompt: 'First issue' }),
      pendingRun({ run: { id: 'httprun_second', correlationId: 'http:second' }, renderedPrompt: 'Second issue' }),
    ]
    const wakeups: Array<{ triggerId: string; delaySeconds?: number }> = []
    let enqueueIndex = 0
    let claimIndex = 0
    const deps = fakeDeps({
      triggerDispatch: {
        enqueueHttpRun: async () => ({ replayed: false, run: enqueuedRuns[enqueueIndex++]!.run, wake: true }),
        claimNextHttpRun: async () => (claimIndex++ === 0 ? enqueuedRuns[0]! : null),
        hasPendingHttpRuns: async () => false,
      },
      triggerDispatchQueue: {
        configured: () => true,
        enqueue: async (message, options) => {
          wakeups.push({
            triggerId: message.triggerId,
            ...(options?.delaySeconds ? { delaySeconds: options.delaySeconds } : {}),
          })
        },
      },
    })

    const first = await dispatchHttpTrigger(deps, auth, {
      trigger: serialHttpTrigger(),
      context: {
        body: { routing_key: 'github:owner/repo:issue:1', ticket: { id: '1' }, source: 'github' },
        header: {},
      },
      idempotencyKey: 'delivery-1',
    })
    const second = await dispatchHttpTrigger(deps, auth, {
      trigger: serialHttpTrigger(),
      context: {
        body: { routing_key: 'github:owner/repo:issue:2', ticket: { id: '2' }, source: 'github' },
        header: {},
      },
      idempotencyKey: 'delivery-2',
    })

    expect(first).toMatchObject({ runId: 'httprun_first', state: 'dispatched', sessionId: 'sess_1' })
    expect(second).toMatchObject({ runId: 'httprun_second', state: 'queued', sessionId: null })
    expect(runtimeSessions.createSession).toHaveBeenCalledTimes(1)
    expect(wakeups).toEqual([{ triggerId: 'trigger_http', delaySeconds: 5 }])
  })

  it('delivers the active routing key immediately even when another subject is already waiting', async () => {
    const active = runtimeSession({ id: 'sess_active', state: 'running' })
    const immediate = pendingRun({
      run: { id: 'httprun_active_subject', correlationId: 'http:active-subject' },
      routingKeyHash: 'active-subject-hash',
      renderedPrompt: 'Active issue follow-up',
    })
    const wakeups: number[] = []
    const claimNextHttpRun = vi.fn(async () => immediate)
    const deps = fakeDeps({
      triggerDispatch: {
        enqueueHttpRun: async () => ({ replayed: false, run: immediate.run, wake: true }),
        claimNextHttpRun,
        hasPendingHttpRuns: async () => true,
      },
      sessions: { findReusableHttpTriggerSession: async () => active },
      triggerDispatchQueue: {
        configured: () => true,
        enqueue: async (_message, options) => {
          wakeups.push(options?.delaySeconds ?? 0)
        },
      },
    })

    const result = await dispatchHttpTrigger(deps, auth, {
      trigger: serialHttpTrigger(),
      context: {
        body: { routing_key: 'github:owner/repo:issue:1', ticket: { id: '1' }, source: 'github' },
        header: {},
      },
      idempotencyKey: 'delivery-follow-up',
    })

    expect(result).toMatchObject({ runId: 'httprun_active_subject', state: 'dispatched', sessionId: 'sess_active' })
    expect(runtimeSessions.dispatchPrompt).toHaveBeenCalledWith(
      deps,
      expect.objectContaining({ project: { id: 'project_1', name: 'Project' } }),
      expect.objectContaining({ id: 'sess_active' }),
      'Active issue follow-up',
      'http:active-subject',
    )
    expect(claimNextHttpRun).toHaveBeenCalledWith('trigger_http')
    expect(runtimeSessions.createSession).not.toHaveBeenCalled()
    expect(wakeups).toEqual([5])
  })

  it('fails a serial run when delivery to its active routing-key session is rejected', async () => {
    const claimed = pendingRun({
      run: { id: 'httprun_rejected' },
      routingKeyHash: 'active-subject-hash',
      renderedPrompt: 'Rejected follow-up',
    })
    const failures: string[] = []
    const deps = fakeDeps({
      triggerDispatch: {
        enqueueHttpRun: async () => ({ replayed: false, run: claimed.run, wake: true }),
        claimNextHttpRun: async () => claimed,
        hasPendingHttpRuns: async () => false,
        markRunFailed: async (_trigger, _run, message) => {
          failures.push(message)
        },
      },
      sessions: {
        findReusableHttpTriggerSession: async () => runtimeSession({ id: 'sess_active', state: 'running' }),
      },
    })
    vi.mocked(runtimeSessions.dispatchPrompt).mockResolvedValue({
      ok: false,
      status: 409,
      message: 'Session runtime is not active',
    })

    const result = await dispatchHttpTrigger(deps, auth, {
      trigger: serialHttpTrigger(),
      context: { body: { routing_key: 'active', ticket: { id: '1' }, source: 'github' }, header: {} },
    })

    expect(result).toMatchObject({ state: 'failed', sessionId: null, errorMessage: 'Session runtime is not active' })
    expect(failures).toEqual(['Session runtime is not active'])
    expect(runtimeSessions.createSession).not.toHaveBeenCalled()
  })

  it('does not serialize independent trigger ids against each other', async () => {
    const triggerOne = serialHttpTrigger('trigger_one')
    const triggerTwo = serialHttpTrigger('trigger_two')
    const pendingByTrigger = new Map([
      ['trigger_one', pendingRun({ triggerId: 'trigger_one', run: { id: 'run_one' }, renderedPrompt: 'One' })],
      ['trigger_two', pendingRun({ triggerId: 'trigger_two', run: { id: 'run_two' }, renderedPrompt: 'Two' })],
    ])
    const deps = fakeDeps({
      triggerDispatch: {
        enqueueHttpRun: async (_auth, trigger) => ({
          replayed: false,
          run: pendingByTrigger.get(trigger.metadata.uid)!.run,
          wake: true,
        }),
        claimNextHttpRun: async (triggerId) => pendingByTrigger.get(triggerId) ?? null,
        hasPendingHttpRuns: async () => false,
      },
      sessionRuntime: {
        createSession: async (_deps, _auth, input) => ({
          ok: true,
          value: sessionRecord({ metadata: { ...sessionRecord().metadata, uid: `sess_${input.options.name}` } }),
        }),
      },
    })

    const [one, two] = await Promise.all([
      dispatchHttpTrigger(deps, auth, {
        trigger: triggerOne,
        context: { body: { routing_key: 'one', ticket: { id: '1' }, source: 'github' }, header: {} },
      }),
      dispatchHttpTrigger(deps, auth, {
        trigger: triggerTwo,
        context: { body: { routing_key: 'two', ticket: { id: '2' }, source: 'github' }, header: {} },
      }),
    ])

    expect(one).toMatchObject({ runId: 'run_one', state: 'dispatched' })
    expect(two).toMatchObject({ runId: 'run_two', state: 'dispatched' })
    expect(runtimeSessions.createSession).toHaveBeenCalledTimes(2)
  })

  it('returns the original run for an idempotency replay without dispatching twice', async () => {
    const wakeups: string[] = []
    const claimNextHttpRun = vi.fn()
    const deps = fakeDeps({
      triggerDispatch: {
        enqueueHttpRun: async () => ({ replayed: true, runId: 'httprun_original', wake: true }),
        claimNextHttpRun,
      },
      triggerDispatchQueue: {
        configured: () => true,
        enqueue: async (message) => {
          wakeups.push(message.triggerId)
        },
      },
    })

    const result = await dispatchHttpTrigger(deps, auth, {
      trigger: serialHttpTrigger(),
      context: { body: { routing_key: 'one', ticket: { id: '1' }, source: 'github' }, header: {} },
      idempotencyKey: 'same-delivery',
    })

    expect(result).toMatchObject({ runId: 'httprun_original', state: 'queued', replayed: true })
    expect(claimNextHttpRun).not.toHaveBeenCalled()
    expect(runtimeSessions.createSession).not.toHaveBeenCalled()
    expect(wakeups).toEqual(['trigger_http'])
  })

  it('requeues a claimed run and schedules another wake when dispatch throws', async () => {
    const claimed = pendingRun({ run: { id: 'httprun_retry' } })
    const requeued: string[] = []
    const wakeups: number[] = []
    const deps = fakeDeps({
      triggerDispatch: {
        enqueueHttpRun: async () => ({ replayed: false, run: claimed.run, wake: true }),
        claimNextHttpRun: async () => claimed,
        requeueHttpRun: async (runId) => {
          requeued.push(runId)
        },
      },
      sessionRuntime: {
        createSession: async () => {
          throw new Error('runner gateway unavailable')
        },
      },
      triggerDispatchQueue: {
        configured: () => true,
        enqueue: async (_message, options) => {
          wakeups.push(options?.delaySeconds ?? 0)
        },
      },
    })

    await expect(
      dispatchHttpTrigger(deps, auth, {
        trigger: serialHttpTrigger(),
        context: { body: { routing_key: 'retry', ticket: { id: '1' }, source: 'github' }, header: {} },
      }),
    ).rejects.toThrow('runner gateway unavailable')
    expect(requeued).toEqual(['httprun_retry'])
    expect(wakeups).toEqual([5])
  })

  it('marks a claimed serial run failed when session creation returns a permanent error', async () => {
    const claimed = pendingRun({ run: { id: 'httprun_failed' } })
    const failures: string[] = []
    const deps = fakeDeps({
      triggerDispatch: {
        enqueueHttpRun: async () => ({ replayed: false, run: claimed.run, wake: true }),
        claimNextHttpRun: async () => claimed,
        hasPendingHttpRuns: async () => false,
        markRunFailed: async (_trigger, _run, message) => {
          failures.push(message)
        },
      },
      sessionRuntime: {
        createSession: async () => ({
          ok: false,
          error: { status: 400, code: 'validation', message: 'Agent is unavailable' },
        }),
      },
    })

    const result = await dispatchHttpTrigger(deps, auth, {
      trigger: serialHttpTrigger(),
      context: { body: { routing_key: 'failed', ticket: { id: '1' }, source: 'github' }, header: {} },
    })

    expect(result).toMatchObject({ runId: 'httprun_failed', state: 'failed', errorMessage: 'Agent is unavailable' })
    expect(failures).toEqual(['Agent is unavailable'])
  })

  it('dispatches the next queued run after the active session no longer blocks the trigger', async () => {
    const next = pendingRun({ run: { id: 'httprun_next' }, renderedPrompt: 'Next issue' })
    let eligible = false
    const deps = fakeDeps({
      triggers: { find: async () => serialHttpTrigger() },
      triggerDispatch: {
        claimNextHttpRun: async () => (eligible ? next : null),
        hasPendingHttpRuns: async () => !eligible,
      },
    })

    const blocked = await dispatchNextSerialHttpTrigger(deps, 'project_1', 'trigger_http')
    eligible = true
    const resumed = await dispatchNextSerialHttpTrigger(deps, 'project_1', 'trigger_http')

    expect(blocked).toEqual({ pending: true, blocked: true })
    expect(resumed).toEqual({ pending: false, blocked: false })
    expect(runtimeSessions.createSession).toHaveBeenCalledTimes(1)
  })

  it('consumes a blocked wake without creating a polling loop [spec: triggers/http-serial-wake-bounded]', async () => {
    const enqueue = vi.fn()
    const deps = fakeDeps({
      triggers: { find: async () => serialHttpTrigger() },
      triggerDispatch: {
        claimNextHttpRun: async () => null,
        hasPendingHttpRuns: async () => true,
      },
      triggerDispatchQueue: {
        configured: () => true,
        enqueue,
      },
    })

    await consumeSerialHttpTriggerWake(deps, {
      type: 'trigger.dispatch',
      projectId: 'project_1',
      triggerId: 'trigger_http',
    })

    expect(enqueue).not.toHaveBeenCalled()
  })

  it('continues immediately after a wake dispatches one of multiple eligible runs', async () => {
    const claimed = pendingRun({ run: { id: 'httprun_first_eligible' } })
    const enqueue = vi.fn()
    const deps = fakeDeps({
      triggers: { find: async () => serialHttpTrigger() },
      triggerDispatch: {
        claimNextHttpRun: async () => claimed,
        hasPendingHttpRuns: async () => true,
      },
      triggerDispatchQueue: {
        configured: () => true,
        enqueue,
      },
    })
    const message = {
      type: 'trigger.dispatch' as const,
      projectId: 'project_1',
      triggerId: 'trigger_http',
    }

    await consumeSerialHttpTriggerWake(deps, message)

    expect(enqueue).toHaveBeenCalledWith(message)
  })

  it('leaves queued runs blocked when the trigger is suspended', async () => {
    const claimNextHttpRun = vi.fn()
    const suspended = httpTrigger({
      spec: { source: { type: 'http', concurrency: { mode: 'serial' } }, suspend: true },
    })
    const deps = fakeDeps({
      triggers: { find: async () => suspended },
      triggerDispatch: {
        claimNextHttpRun,
        hasPendingHttpRuns: async () => true,
      },
    })

    await expect(dispatchNextSerialHttpTrigger(deps, 'project_1', 'trigger_http')).resolves.toEqual({
      pending: true,
      blocked: true,
    })
    expect(claimNextHttpRun).not.toHaveBeenCalled()
  })

  it('ignores recovery messages for missing or non-HTTP triggers', async () => {
    const deps = fakeDeps({ triggers: { find: async () => null } })
    await expect(dispatchNextSerialHttpTrigger(deps, 'project_1', 'trigger_missing')).resolves.toEqual({
      pending: false,
      blocked: false,
    })
  })

  it('re-enqueues stranded trigger ids during scheduled recovery', async () => {
    const wakeups: Array<{ triggerId: string; projectId: string }> = []
    const deps = fakeDeps({
      triggerDispatch: {
        pendingHttpTriggers: async () => [
          { triggerId: 'trigger_one', projectId: 'project_1' },
          { triggerId: 'trigger_two', projectId: 'project_1' },
        ],
      },
      triggerDispatchQueue: {
        configured: () => true,
        enqueue: async (message) => {
          wakeups.push({ triggerId: message.triggerId, projectId: message.projectId })
        },
      },
    })

    await expect(recoverSerialHttpTriggers(deps)).resolves.toBe(2)
    expect(wakeups).toEqual([
      { triggerId: 'trigger_one', projectId: 'project_1' },
      { triggerId: 'trigger_two', projectId: 'project_1' },
    ])
  })

  it('requeues a stale dispatching run without a session and continues it in the same cron recovery', async () => {
    const stale = stalePendingRun({ run: { id: 'httprun_crashed' }, renderedPrompt: 'Resume crashed run' })
    const requeued: string[] = []
    let isQueued = false
    let staleBefore: string | null = null
    let staleLimit: number | null = null
    const deps = fakeDeps({
      triggers: { find: async () => serialHttpTrigger() },
      triggerDispatch: {
        staleHttpRuns: async (before, limit) => {
          staleBefore = before
          staleLimit = limit
          return [stale]
        },
        requeueHttpRun: async (runId) => {
          requeued.push(runId)
          isQueued = true
        },
        pendingHttpTriggers: async () => (isQueued ? [{ triggerId: 'trigger_http', projectId: 'project_1' }] : []),
        claimNextHttpRun: async () => (isQueued ? stale : null),
        hasPendingHttpRuns: async () => false,
      },
      triggerDispatchQueue: {
        configured: () => false,
        enqueue: async () => {
          throw new Error('unconfigured queue must not be used')
        },
      },
    })

    const now = new Date('2026-07-20T12:00:00.000Z')
    await expect(recoverSerialHttpTriggers(deps, 25, now)).resolves.toBe(1)

    expect(staleBefore).toBe('2026-07-20T11:55:00.000Z')
    expect(staleLimit).toBe(25)
    expect(requeued).toEqual(['httprun_crashed'])
    expect(runtimeSessions.createSession).toHaveBeenCalledTimes(1)
  })

  it('finalizes a stale dispatching run from its existing session without creating a duplicate', async () => {
    const sessionMetadata = {
      labels: { subject: 'github-issue' },
      annotations: { httpRunId: 'httprun_created_before_crash' },
    }
    const stale = stalePendingRun({
      run: { id: 'httprun_created_before_crash' },
      existingSession: { id: 'sess_created_before_crash', metadata: sessionMetadata },
    })
    const finalized: Array<{ runId: string; sessionId: string; metadata: typeof sessionMetadata }> = []
    const requeueHttpRun = vi.fn()
    const deps = fakeDeps({
      triggers: { find: async () => serialHttpTrigger() },
      triggerDispatch: {
        staleHttpRuns: async () => [stale],
        pendingHttpTriggers: async () => [],
        requeueHttpRun,
        markRunDispatched: async (_trigger, run, sessionId, metadata) => {
          finalized.push({ runId: run.id, sessionId, metadata: metadata as typeof sessionMetadata })
        },
      },
    })

    await expect(recoverSerialHttpTriggers(deps)).resolves.toBe(0)

    expect(finalized).toEqual([
      {
        runId: 'httprun_created_before_crash',
        sessionId: 'sess_created_before_crash',
        metadata: sessionMetadata,
      },
    ])
    expect(requeueHttpRun).not.toHaveBeenCalled()
    expect(runtimeSessions.createSession).not.toHaveBeenCalled()
  })

  it('dispatches stranded runs inline when the wake queue binding is unavailable', async () => {
    const claimed = pendingRun({ run: { id: 'httprun_inline_recovery' } })
    const deps = fakeDeps({
      triggers: { find: async () => serialHttpTrigger() },
      triggerDispatch: {
        pendingHttpTriggers: async () => [{ triggerId: 'trigger_http', projectId: 'project_1' }],
        claimNextHttpRun: async () => claimed,
        hasPendingHttpRuns: async () => false,
      },
      triggerDispatchQueue: {
        configured: () => false,
        enqueue: async () => {
          throw new Error('unconfigured queue must not be used')
        },
      },
    })

    await expect(recoverSerialHttpTriggers(deps)).resolves.toBe(1)
    expect(runtimeSessions.createSession).toHaveBeenCalledTimes(1)
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
