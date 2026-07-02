import type { Session, SessionMessage } from '@server/domain/session'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Deps } from './deps'
import { type AuthScope, type RuntimeSessionHandle, SessionValidationError } from './ports'

// The session write usecases now call the runtime session usecases directly
// (the SessionRuntimeGateway indirection was removed). Mock that module so these
// tests drive the runtime outcomes the way they previously drove the gateway.
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

import * as runtimeSessions from './runtime/sessions'
import { sendSessionMessage, updateSession } from './sessions'

// The runtime-session behaviors a test wants to override, mirroring the former
// gateway override surface. Applied onto the mocked module by fakeDeps.
type RuntimeSessionOverrides = {
  createSession?: typeof runtimeSessions.createSession
  closeSession?: typeof runtimeSessions.closeSession
  reopenSession?: typeof runtimeSessions.reopenSession
  archiveSession?: typeof runtimeSessions.archiveSession
  unarchiveSession?: typeof runtimeSessions.unarchiveSession
  dispatchPrompt?: typeof runtimeSessions.dispatchPrompt
  decideApproval?: typeof runtimeSessions.decideApproval
  markExpiredPending?: typeof runtimeSessions.markExpiredPending
}

const auth: AuthScope = {
  organization: { id: 'org_1', name: 'Org' },
  project: { id: 'project_1', name: 'Project' },
  user: { id: 'user_1' },
  roles: [],
  permissions: [],
}

function sessionRow(overrides: Partial<RuntimeSessionHandle> = {}): RuntimeSessionHandle {
  return {
    id: 'sess_1',
    projectId: 'project_1',
    organizationId: 'org_1',
    state: 'idle',
    archivedAt: null,
    sandboxId: null,
    metadata: {},
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
      environmentId: null,
      runtime: 'ama',
      env: {},
      envFrom: [],
      volumes: [],
      volumeMounts: [],
    },
    status: {
      phase: 'idle',
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
        environment: { id: null, versionId: null, snapshot: null },
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

function messageRecord(overrides: Partial<SessionMessage> = {}): SessionMessage {
  return {
    id: 'msg_1',
    sessionId: 'sess_1',
    type: 'prompt',
    content: 'hello',
    delivery: 'live',
    state: 'accepted',
    error: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

function fakeDeps(
  overrides: { sessions?: Partial<Deps['sessions']>; sessionRuntime?: RuntimeSessionOverrides } = {},
): Deps {
  const sessions: Deps['sessions'] = {
    list: async () => ({ rows: [], hasMore: false }),
    find: async () => sessionRecord(),
    findByOrganization: async () => sessionRecord(),
    findReusableHttpTriggerSession: async () => null,
    findRuntimeRow: async () => sessionRow(),
    updateFields: async () => sessionRecord(),
    listMessages: async () => ({ rows: [], hasMore: false }),
    findMessage: async () => null,
    insertMessage: async (record): Promise<SessionMessage> =>
      messageRecord({
        content: record.content,
        delivery: record.delivery,
        state: record.state,
        createdAt: record.createdAt,
      }),
    queryEvents: async () => ({ rows: [], hasMore: false }),
    insertEvents: async () => 0,
    listApprovals: async () => [],
    findApproval: async () => null,
    activeSessionLeaseForRunner: async () => null,
    resolveRunnerEnvironmentId: async () => 'env_1',
    resolveSandboxBackend: async () => null,
    ...overrides.sessions,
  }
  const runtime: Required<RuntimeSessionOverrides> = {
    createSession: async () => ({ ok: true, value: sessionRecord() }),
    closeSession: async () => ({
      ok: true,
      value: sessionRecord({ status: { ...sessionRecord().status, phase: 'closed' } }),
    }),
    reopenSession: async () => ({
      ok: true,
      value: sessionRecord({ status: { ...sessionRecord().status, phase: 'idle' } }),
    }),
    archiveSession: async () => ({
      ok: true,
      value: sessionRecord({
        metadata: { ...sessionRecord().metadata, archivedAt: '2026-01-02T00:00:00.000Z' },
      }),
    }),
    unarchiveSession: async () => sessionRecord(),
    dispatchPrompt: async () => ({ ok: true, delivery: 'live', state: 'accepted' }),
    decideApproval: async () => ({
      ok: true,
      value: {
        id: 'appr_1',
        sessionId: 'sess_1',
        toolCallId: 'tc_1',
        toolName: 'tool',
        input: {},
        relatedEventIds: [],
        state: 'approved',
        reason: null,
        result: null,
        requestedAt: 'T',
        decidedAt: 'T',
        createdAt: 'T',
        updatedAt: 'T',
      },
    }),
    markExpiredPending: async () => {},
    ...overrides.sessionRuntime,
  }
  vi.mocked(runtimeSessions.createSession).mockImplementation(runtime.createSession)
  vi.mocked(runtimeSessions.closeSession).mockImplementation(runtime.closeSession)
  vi.mocked(runtimeSessions.reopenSession).mockImplementation(runtime.reopenSession)
  vi.mocked(runtimeSessions.archiveSession).mockImplementation(runtime.archiveSession)
  vi.mocked(runtimeSessions.unarchiveSession).mockImplementation(runtime.unarchiveSession)
  vi.mocked(runtimeSessions.dispatchPrompt).mockImplementation(runtime.dispatchPrompt)
  vi.mocked(runtimeSessions.decideApproval).mockImplementation(runtime.decideApproval)
  vi.mocked(runtimeSessions.markExpiredPending).mockImplementation(runtime.markExpiredPending)
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
    sessions,
    createApprovalGate: undefined as unknown as Deps['createApprovalGate'],
    rereadStartedSession: false,
  }
}

// ── updateSession ────────────────────────────────────────────────────────────

describe('[spec: sessions/archive] updateSession — archived session', () => {
  it('unarchives when patch is {archived:false} and nothing else', async () => {
    let called = false
    const deps = fakeDeps({
      sessionRuntime: {
        unarchiveSession: async () => {
          called = true
          return sessionRecord()
        },
      },
    })
    const result = await updateSession(
      deps,
      auth,
      sessionRow({ archivedAt: '2026-01-02T00:00:00.000Z' }),
      { archived: false },
      null,
    )
    expect(result.ok).toBe(true)
    expect(called).toBe(true)
  })

  it('returns 409 conflict when patching an archived session with any other field', async () => {
    const result = await updateSession(
      fakeDeps(),
      auth,
      sessionRow({ archivedAt: '2026-01-02T00:00:00.000Z' }),
      { name: 'New' },
      null,
    )
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.status).toBe(409)
      expect(result.error.code).toBe('conflict')
    }
  })

  it('returns 409 conflict when archived session receives a state patch', async () => {
    const result = await updateSession(
      fakeDeps(),
      auth,
      sessionRow({ archivedAt: '2026-01-02T00:00:00.000Z' }),
      { state: 'closed' },
      null,
    )
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.status).toBe(409)
    }
  })

  it('returns 409 conflict when archived:false is combined with another patch field', async () => {
    const result = await updateSession(
      fakeDeps(),
      auth,
      sessionRow({ archivedAt: '2026-01-02T00:00:00.000Z' }),
      { archived: false, name: 'oops' },
      null,
    )
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe('conflict')
    }
  })
})

describe('[spec: sessions/archive] updateSession — name and metadata edits', () => {
  it('updates only name when name is provided', async () => {
    const updated: string[] = []
    const deps = fakeDeps({
      sessions: {
        updateFields: async (_pid, _sid, fields) => {
          updated.push(JSON.stringify(fields))
          return sessionRecord({ metadata: { ...sessionRecord().metadata, name: fields.title ?? 'sess_1' } })
        },
        findRuntimeRow: async () => sessionRow(),
        find: async () => sessionRecord({ metadata: { ...sessionRecord().metadata, name: 'New title' } }),
      },
    })
    const result = await updateSession(deps, auth, sessionRow(), { name: 'New title' }, null)
    expect(result.ok).toBe(true)
    expect(updated).toHaveLength(1)
    expect(JSON.parse(updated[0] ?? '')).toMatchObject({ title: 'New title' })
  })

  it('skips null name from the fields payload', async () => {
    const updated: object[] = []
    const deps = fakeDeps({
      sessions: {
        updateFields: async (_pid, _sid, fields) => {
          updated.push(fields)
          return sessionRecord()
        },
        findRuntimeRow: async () => sessionRow(),
        find: async () => sessionRecord(),
      },
    })
    await updateSession(deps, auth, sessionRow(), { name: null }, null)
    expect(updated[0]).not.toHaveProperty('title')
  })

  it('throws SessionValidationError when metadata contains secret material', async () => {
    await expect(
      updateSession(fakeDeps(), auth, sessionRow(), { metadata: { api_key: 'raw-secret' } }, null),
    ).rejects.toBeInstanceOf(SessionValidationError)
  })

  it('merges metadata update, removing null-keyed entries', async () => {
    let mergedMetadata: Record<string, unknown> | undefined
    const deps = fakeDeps({
      sessions: {
        updateFields: async (_pid, _sid, fields) => {
          mergedMetadata = fields.metadata
          return sessionRecord()
        },
        findRuntimeRow: async () =>
          sessionRow({ metadata: { runtime: 'ama', annotations: { keep: 'yes', remove: 'old' } } }),
        find: async () => sessionRecord(),
      },
    })
    await updateSession(
      deps,
      auth,
      sessionRow({ metadata: { runtime: 'ama', annotations: { keep: 'yes', remove: 'old' } } }),
      { metadata: { annotations: { remove: null } } },
      null,
    )
    expect(mergedMetadata).toEqual({ runtime: 'ama', labels: {}, annotations: { keep: 'yes' } })
  })

  it('throws when updateFields returns null', async () => {
    const deps = fakeDeps({
      sessions: {
        updateFields: async () => null,
      },
    })
    await expect(updateSession(deps, auth, sessionRow(), { name: 'X' }, null)).rejects.toThrow(
      'Updated session row is required',
    )
  })

  it('throws when findRuntimeRow returns null after updateFields', async () => {
    const deps = fakeDeps({
      sessions: {
        updateFields: async () => sessionRecord(),
        findRuntimeRow: async () => null,
      },
    })
    await expect(updateSession(deps, auth, sessionRow(), { name: 'X' }, null)).rejects.toThrow(
      'Updated session row is required',
    )
  })
})

describe('[spec: sessions/close] updateSession — close/reopen transitions', () => {
  it('closes a live session and returns the closed record', async () => {
    let closed = false
    const deps = fakeDeps({
      sessionRuntime: {
        closeSession: async () => {
          closed = true
          return { ok: true, value: sessionRecord({ status: { ...sessionRecord().status, phase: 'closed' } }) }
        },
      },
    })
    const result = await updateSession(deps, auth, sessionRow(), { state: 'closed' }, 'req_1')
    expect(result.ok).toBe(true)
    expect(closed).toBe(true)
  })

  it('returns the runtime error when close fails', async () => {
    const deps = fakeDeps({
      sessionRuntime: {
        closeSession: async () => ({ ok: false, error: { status: 409, code: 'conflict', message: 'Already closed' } }),
      },
    })
    const result = await updateSession(deps, auth, sessionRow(), { state: 'closed' }, null)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe('conflict')
    }
  })

  it('archives after close when both are requested', async () => {
    let archived = false
    const deps = fakeDeps({
      sessionRuntime: {
        closeSession: async () => ({
          ok: true,
          value: sessionRecord({ status: { ...sessionRecord().status, phase: 'closed' } }),
        }),
        archiveSession: async () => {
          archived = true
          return {
            ok: true,
            value: sessionRecord({
              metadata: { ...sessionRecord().metadata, archivedAt: '2026-01-02T00:00:00.000Z' },
            }),
          }
        },
      },
      sessions: {
        findRuntimeRow: async () => sessionRow({ state: 'closed' }),
      },
    })
    const result = await updateSession(deps, auth, sessionRow(), { state: 'closed', archived: true }, null)
    expect(result.ok).toBe(true)
    expect(archived).toBe(true)
  })

  it('throws when findRuntimeRow returns null after close+archive', async () => {
    const deps = fakeDeps({
      sessionRuntime: {
        closeSession: async () => ({
          ok: true,
          value: sessionRecord({ status: { ...sessionRecord().status, phase: 'closed' } }),
        }),
      },
      sessions: {
        findRuntimeRow: async () => null,
      },
    })
    await expect(updateSession(deps, auth, sessionRow(), { state: 'closed', archived: true }, null)).rejects.toThrow(
      'Closed session row is required',
    )
  })

  it('reopens a closed session and returns the idle record', async () => {
    let reopened = false
    const deps = fakeDeps({
      sessionRuntime: {
        reopenSession: async () => {
          reopened = true
          return { ok: true, value: sessionRecord({ status: { ...sessionRecord().status, phase: 'idle' } }) }
        },
      },
      sessions: {
        findRuntimeRow: async () => sessionRow({ state: 'idle' }),
      },
    })
    const result = await updateSession(deps, auth, sessionRow({ state: 'closed' }), { state: 'idle' }, 'req_1')
    expect(result.ok).toBe(true)
    expect(reopened).toBe(true)
  })
})

describe('[spec: sessions/archive] updateSession — archive without close', () => {
  it('archives a live session when archived:true is the only patch', async () => {
    let archived = false
    const deps = fakeDeps({
      sessionRuntime: {
        archiveSession: async () => {
          archived = true
          return {
            ok: true,
            value: sessionRecord({
              metadata: { ...sessionRecord().metadata, archivedAt: '2026-01-02T00:00:00.000Z' },
            }),
          }
        },
      },
    })
    const result = await updateSession(deps, auth, sessionRow(), { archived: true }, null)
    expect(result.ok).toBe(true)
    expect(archived).toBe(true)
  })
})

describe('[spec: sessions/archive] updateSession — no-op patch', () => {
  it('returns the current record when the patch carries no fields', async () => {
    let findCalled = false
    const deps = fakeDeps({
      sessions: {
        find: async () => {
          findCalled = true
          return sessionRecord()
        },
      },
    })
    const result = await updateSession(deps, auth, sessionRow(), {}, null)
    expect(result.ok).toBe(true)
    expect(findCalled).toBe(true)
  })

  it('throws when the final find returns null', async () => {
    const deps = fakeDeps({
      sessions: {
        find: async () => null,
      },
    })
    await expect(updateSession(deps, auth, sessionRow(), {}, null)).rejects.toThrow('Updated session row is required')
  })
})

// ── sendSessionMessage ───────────────────────────────────────────────────────

describe('[spec: sessions/prompt] sendSessionMessage', () => {
  it('returns archived rejection for archived sessions', async () => {
    const result = await sendSessionMessage(
      fakeDeps(),
      auth,
      sessionRow({ archivedAt: '2026-01-02T00:00:00.000Z' }),
      'hello',
    )
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.status).toBe(409)
      if ('archived' in result) {
        expect(result.archived).toBe(true)
      }
    }
  })

  it('dispatches prompt and persists message record on success', async () => {
    let inserted: string | null = null
    const deps = fakeDeps({
      sessions: {
        insertMessage: async (record): Promise<SessionMessage> => {
          inserted = record.content
          return messageRecord({ content: record.content })
        },
      },
    })
    const result = await sendSessionMessage(deps, auth, sessionRow(), 'hi there')
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.message.content).toBe('hi there')
    }
    expect(inserted).toBe('hi there')
  })

  it('returns the runtime error without persisting a message when dispatch fails with 409', async () => {
    let inserted = false
    const deps = fakeDeps({
      sessionRuntime: {
        dispatchPrompt: async () => ({ ok: false, status: 409, message: 'Session is not accepting prompts' }),
      },
      sessions: {
        insertMessage: async () => {
          inserted = true
          return messageRecord()
        },
      },
    })
    const result = await sendSessionMessage(deps, auth, sessionRow(), 'hello')
    expect(result.ok).toBe(false)
    expect(inserted).toBe(false)
  })

  it('returns the runtime error without persisting when dispatch fails with 500', async () => {
    const deps = fakeDeps({
      sessionRuntime: {
        dispatchPrompt: async () => ({ ok: false, status: 500, message: 'Internal error' }),
      },
    })
    const result = await sendSessionMessage(deps, auth, sessionRow(), 'hello')
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.status).toBe(500)
    }
  })

  it('forwards the runtimeError payload when dispatch fails with runtimeError', async () => {
    const deps = fakeDeps({
      sessionRuntime: {
        dispatchPrompt: async () => ({
          ok: false,
          status: 500,
          message: 'Boom',
          runtimeError: { detail: 'crash' },
        }),
      },
    })
    const result = await sendSessionMessage(deps, auth, sessionRow(), 'hello')
    expect(result.ok).toBe(false)
    if (!result.ok && 'runtimeError' in result) {
      expect(result.runtimeError).toEqual({ detail: 'crash' })
    }
  })

  it('stamps dispatch delivery and state onto the inserted message', async () => {
    let capturedDelivery: string | null = null
    let capturedState: string | null = null
    const deps = fakeDeps({
      sessionRuntime: {
        dispatchPrompt: async () => ({ ok: true, delivery: 'queued', state: 'accepted' }),
      },
      sessions: {
        insertMessage: async (record): Promise<SessionMessage> => {
          capturedDelivery = record.delivery
          capturedState = record.state
          return messageRecord({ delivery: record.delivery, state: record.state })
        },
      },
    })
    await sendSessionMessage(deps, auth, sessionRow(), 'task')
    expect(capturedDelivery).toBe('queued')
    expect(capturedState).toBe('accepted')
  })
})
