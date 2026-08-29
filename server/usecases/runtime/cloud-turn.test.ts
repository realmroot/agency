import type { AmaEvent } from '@shared/session-events'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { EnvironmentPackageInstallationError } from '../../runtime-error'
import {
  type CloudTurnDeps,
  consumeCloudTurnQueueMessage,
  markCloudTurnDeadLettered,
  startSessionRuntimeForRow,
} from './cloud-turn'
import { RuntimePolicyDeniedError } from './engine/errors'

// Characterization (golden-master) tests for the cloud-command / queue turn
// path: consumeCloudTurnQueueMessage → executeCloudSessionTurn. The integration
// suite runs turns INLINE (AMA_RUNTIME_MODE=test ⇒ cloudTurnsRunInline), so the
// paused→enqueue continuation branch is unreachable there. These pin it (and
// the provider/model selection the Phase 1 TurnEngine unification must
// preserve) before that refactor moves the code.
//
// The usecase is deps-first: the orchestration store, sandbox runtime host,
// queue, and audit all arrive on `deps`, so the test wires fakes at those seams
// instead of mocking the env-bound shim modules. enqueue is bridged so the
// assertions still see the (env, message, opts) call shape the queue gateway
// preserves.
const {
  runSessionTurnMock,
  enqueueCloudTurnMock,
  cloudTurnsRunInlineMock,
  recordAuditMock,
  appendEventMock,
  findSessionMock,
  sessionEventStreamMock,
  updateSessionWhenStateMock,
  acquireTurnLeaseMock,
  renewTurnLeaseMock,
  releaseTurnLeaseMock,
  incrementContinuationDepthMock,
} = vi.hoisted(() => ({
  runSessionTurnMock:
    vi.fn<
      (input: {
        provider: string
        model: string | null
        onEvent: (event: AmaEvent) => Promise<void>
      }) => Promise<{ status: string }>
    >(),
  enqueueCloudTurnMock: vi.fn(),
  cloudTurnsRunInlineMock: vi.fn(() => false),
  recordAuditMock: vi.fn(),
  appendEventMock: vi.fn<(scope: unknown, event: AmaEvent) => Promise<string>>(async () => 'event_test'),
  findSessionMock: vi.fn(),
  sessionEventStreamMock: vi.fn(() => [] as unknown[]),
  updateSessionWhenStateMock: vi.fn<
    (projectId: string, sessionId: string, expected: string | string[], fields: Record<string, unknown>) => boolean
  >(() => true),
  acquireTurnLeaseMock: vi.fn(async () => true),
  renewTurnLeaseMock: vi.fn(async () => true),
  releaseTurnLeaseMock: vi.fn(async () => true),
  incrementContinuationDepthMock: vi.fn(async () => 1),
}))

const env = { DB: {}, AMA_RUNTIME_MODE: 'production' } as never

// The queue gateway is env-bound (enqueue(env, message, opts)); the usecase
// drives it through deps.cloudTurnQueue.enqueue(message, opts). Bridge the two so
// the spy still records the env-first call shape the assertions filter on.
const cloudTurnQueue = {
  enqueue: (message: unknown, opts?: { delaySeconds?: number }) =>
    opts ? enqueueCloudTurnMock(env, message, opts) : enqueueCloudTurnMock(env, message),
  runsInline: () => cloudTurnsRunInlineMock(),
}

const store = {
  db: {},
  findSession: findSessionMock,
  sessionEventStream: sessionEventStreamMock,
  updateSessionWhenState: updateSessionWhenStateMock,
  acquireTurnLease: acquireTurnLeaseMock,
  renewTurnLease: renewTurnLeaseMock,
  releaseTurnLease: releaseTurnLeaseMock,
  incrementContinuationDepth: incrementContinuationDepthMock,
}

const deps: CloudTurnDeps = {
  sessionOrchestration: store as never,
  sessionEventStore: {
    eventStream: sessionEventStreamMock,
    appendEvent: appendEventMock,
    queryEvents: vi.fn(),
    archive: vi.fn(),
  } as never,
  providers: {
    findModel: async () => ({ id: 'm', providerId: 'workers-ai', modelId: '@cf/x' }),
    findBySlug: async () => ({ id: 'workers-ai', slug: 'workers-ai' }),
  } as never,
  // The cloud-turn usecase records audit through the AuditPort (deps.audit);
  // record(auth, entry) routes to the same spy the legacy recordAudit path used
  // (the entry lands in call[1], matching the recordAudit(db, { auth, ...entry })
  // shape the assertions filter on).
  audit: { record: (auth: unknown, entry: unknown) => recordAuditMock(auth, entry) } as never,
  policy: {} as never,
  cloudRuntime: {} as never,
  amaTurnExecutor: { runTurn: (input: unknown) => runSessionTurnMock(input as never) } as never,
  cloudTurnQueue: cloudTurnQueue as never,
  runtimeSecrets: {
    resolveEnv: async () => ({}),
    resolveWorkspaceManifest: async () => ({ root: '/workspace', mounts: [] }),
  } as never,
  // runTurn is mocked, so the built callbacks are never exercised; a minimal gate
  // factory keeps buildSessionTurnCallbacks happy.
  createApprovalGate: () =>
    ({
      shouldSuppressEvent: () => false,
      resolveToolResult: async () => null,
      gate: async () => null,
      requiresAction: () => false,
    }) as never,
}

function fakeSession(overrides: Record<string, unknown> = {}) {
  return {
    id: 'session_1',
    state: 'running',
    sandboxId: 'sandbox_1',
    modelProvider: 'workers-ai',
    modelConfig: JSON.stringify({}),
    agentSnapshot: JSON.stringify({ providerId: 'anthropic', model: '@cf/x' }),
    environmentSnapshot: null,
    metadata: null,
    ...overrides,
  }
}

const stepMessage = {
  type: 'session.step',
  sessionId: 'session_1',
  organizationId: 'org_1',
  projectId: 'proj_1',
  auditAction: 'session.command',
} as const

describe('consumeCloudTurnQueueMessage — cloud-command turn path [spec: runtime/cloud-turn]', () => {
  beforeEach(() => {
    runSessionTurnMock.mockReset()
    enqueueCloudTurnMock.mockReset()
    recordAuditMock.mockReset()
    appendEventMock.mockClear()
    updateSessionWhenStateMock.mockClear()
    updateSessionWhenStateMock.mockReturnValue(true)
    sessionEventStreamMock.mockReturnValue([])
    findSessionMock.mockReset()
    findSessionMock.mockResolvedValue(fakeSession())
    cloudTurnsRunInlineMock.mockReturnValue(false)
    acquireTurnLeaseMock.mockReset()
    acquireTurnLeaseMock.mockResolvedValue(true)
    renewTurnLeaseMock.mockReset()
    renewTurnLeaseMock.mockResolvedValue(true)
    releaseTurnLeaseMock.mockReset()
    releaseTurnLeaseMock.mockResolvedValue(true)
    incrementContinuationDepthMock.mockReset()
    incrementContinuationDepthMock.mockResolvedValue(1)
  })

  it('re-enqueues a session.step continuation when the turn pauses, without parking idle', async () => {
    runSessionTurnMock.mockResolvedValue({ status: 'paused' })

    await consumeCloudTurnQueueMessage(deps, { ...stepMessage, requestId: 'req_turn_1' })

    expect(enqueueCloudTurnMock).toHaveBeenCalledTimes(1)
    expect(enqueueCloudTurnMock).toHaveBeenCalledWith(
      env,
      expect.objectContaining({
        type: 'session.step',
        sessionId: 'session_1',
        organizationId: 'org_1',
        projectId: 'proj_1',
        requestId: 'req_turn_1',
        auditAction: 'session.command',
      }),
    )
    // A paused turn never transitions the session to idle.
    for (const call of updateSessionWhenStateMock.mock.calls) {
      expect(call[3].state).not.toBe('idle')
    }
  })

  it('parks the session idle and does not enqueue when the turn completes', async () => {
    runSessionTurnMock.mockResolvedValue({ status: 'idle' })

    await consumeCloudTurnQueueMessage(deps, stepMessage)

    expect(enqueueCloudTurnMock).not.toHaveBeenCalled()
    expect(updateSessionWhenStateMock).toHaveBeenCalledWith(
      'proj_1',
      'session_1',
      'running',
      expect.objectContaining({ state: 'idle' }),
    )
  })

  it('passes session.modelProvider (over the agent snapshot provider) and the resolved model into the turn', async () => {
    runSessionTurnMock.mockResolvedValue({ status: 'idle' })

    await consumeCloudTurnQueueMessage(deps, stepMessage)

    expect(runSessionTurnMock).toHaveBeenCalledTimes(1)
    const input = runSessionTurnMock.mock.calls[0]?.[0]
    expect(input?.provider).toBe('workers-ai')
    expect(input?.model).toBe('@cf/x')
  })

  it('prefers modelConfig.model over the agent snapshot model', async () => {
    findSessionMock.mockResolvedValue(fakeSession({ modelConfig: JSON.stringify({ model: '@cf/override' }) }))
    runSessionTurnMock.mockResolvedValue({ status: 'idle' })

    await consumeCloudTurnQueueMessage(deps, stepMessage)

    const input = runSessionTurnMock.mock.calls[0]?.[0]
    expect(input?.model).toBe('@cf/override')
  })

  it('records the user prompt as a canonical transcript event before running a prompt turn', async () => {
    runSessionTurnMock.mockImplementation(async (input) => {
      await input.onEvent({
        type: 'message.completed',
        payload: {
          message: { id: 'runtime-user-message', role: 'user', content: [{ type: 'text', text: 'continue the task' }] },
        },
      })
      return { status: 'idle' }
    })
    findSessionMock.mockResolvedValue(fakeSession({ state: 'idle' }))

    await consumeCloudTurnQueueMessage(deps, {
      type: 'session.turn',
      sessionId: 'session_1',
      organizationId: 'org_1',
      projectId: 'proj_1',
      prompt: 'continue the task',
      auditAction: 'session.command',
    })

    expect(appendEventMock).toHaveBeenCalledWith(
      { organizationId: 'org_1', projectId: 'proj_1', sessionId: 'session_1' },
      expect.objectContaining({
        type: 'message.completed',
        payload: expect.objectContaining({
          message: expect.objectContaining({
            role: 'user',
            content: [expect.objectContaining({ type: 'text', text: 'continue the task' })],
          }),
        }),
      }),
    )
    expect(runSessionTurnMock).toHaveBeenCalledWith(expect.objectContaining({ prompt: 'continue the task' }))
    const userMessages = appendEventMock.mock.calls.filter(
      ([, event]) =>
        event.type === 'message.completed' &&
        (event.payload as { message?: { role?: string } }).message?.role === 'user',
    )
    expect(userMessages).toHaveLength(1)
  })

  it('parks the session idle with a policy-denied reason when the turn is policy-denied', async () => {
    runSessionTurnMock.mockRejectedValue(new RuntimePolicyDeniedError('blocked by sandbox policy'))

    await consumeCloudTurnQueueMessage(deps, stepMessage)

    expect(updateSessionWhenStateMock).toHaveBeenCalledWith(
      'proj_1',
      'session_1',
      'running',
      expect.objectContaining({ state: 'idle', stateReason: 'policy-denied' }),
    )
  })

  it('defers the turn (without running it) when another turn holds the session lease [spec: runtime/cloud-turn]', async () => {
    acquireTurnLeaseMock.mockResolvedValue(false)

    await consumeCloudTurnQueueMessage(deps, stepMessage)

    // The lease CAS failed → the message is re-enqueued with a delay and the turn
    // never runs against the session another turn is already driving.
    expect(runSessionTurnMock).not.toHaveBeenCalled()
    expect(enqueueCloudTurnMock).toHaveBeenCalledWith(
      env,
      expect.objectContaining({ type: 'session.step' }),
      expect.objectContaining({ delaySeconds: expect.any(Number) }),
    )
  })

  it('caps a runaway continuation chain at the limit and parks idle (recoverable)', async () => {
    runSessionTurnMock.mockResolvedValue({ status: 'paused' })
    incrementContinuationDepthMock.mockResolvedValue(25)

    await consumeCloudTurnQueueMessage(deps, stepMessage)

    // At the cap the lease is released with a recoverable reason and no further
    // step is enqueued.
    expect(releaseTurnLeaseMock).toHaveBeenCalledWith(
      'proj_1',
      'session_1',
      expect.any(String),
      expect.objectContaining({ state: 'idle', stateReason: 'continuation-limit' }),
    )
    expect(enqueueCloudTurnMock).not.toHaveBeenCalled()
  })

  it('stops a budget-continuation step whose held lease was lost (renew fails)', async () => {
    renewTurnLeaseMock.mockResolvedValue(false)

    await consumeCloudTurnQueueMessage(deps, { ...stepMessage, turnId: 'turn_held' })

    // renew failed → another worker owns the chain; this step must not run.
    expect(renewTurnLeaseMock).toHaveBeenCalledWith('proj_1', 'session_1', 'turn_held', expect.any(String))
    expect(runSessionTurnMock).not.toHaveBeenCalled()
  })

  it('marks the session errored without reaching the runtime driver on an unknown runtime name [spec: runtime/cloud-turn]', async () => {
    findSessionMock.mockResolvedValue(fakeSession({ state: 'pending' }))

    await consumeCloudTurnQueueMessage(deps, {
      type: 'session.start',
      sessionId: 'session_1',
      organizationId: 'org_1',
      projectId: 'proj_1',
      runtime: 'totally-not-a-runtime',
      runtimeConfig: {},
      auditAction: 'session.prompt',
    } as unknown as Parameters<typeof consumeCloudTurnQueueMessage>[1])

    // An unknown runtime is dead-lettered up front: the turn engine never runs.
    expect(runSessionTurnMock).not.toHaveBeenCalled()
    expect(updateSessionWhenStateMock).toHaveBeenCalledWith(
      'proj_1',
      'session_1',
      ['pending', 'running'],
      expect.objectContaining({ state: 'error', stateReason: 'cloud-turn-failed' }),
    )
  })

  it('marks a dead-lettered cloud turn errored and clears its lease [spec: runtime/cloud-turn]', async () => {
    await markCloudTurnDeadLettered(deps, stepMessage)

    expect(updateSessionWhenStateMock).toHaveBeenCalledWith(
      'proj_1',
      'session_1',
      ['pending', 'running'],
      expect.objectContaining({ state: 'error', stateReason: 'cloud-turn-failed', activeTurnId: null }),
    )
    expect(recordAuditMock).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ outcome: 'failure' }))
  })
})

// Robustness tests for startup partial-failure (H5 FIX 1): startSessionRuntimeForRow
// must not leak a provisioned sandbox when the pending→idle CAS no-ops (lost-row
// race). Deps-first: the sandbox runtime host (start/stop), the MCP snapshot, and
// the runtime env resolve all arrive on `deps`, so the test wires fakes at those
// seams.
describe('startSessionRuntimeForRow — startup partial-failure (H5 FIX 1)', () => {
  const startSessionRuntimeMock = vi.fn<(env: unknown, input: unknown) => Promise<unknown>>()
  const stopSessionRuntimeMock = vi.fn<(env: unknown, sandboxId: unknown) => Promise<undefined>>(async () => undefined)
  const resolveEnvFromMock = vi.fn(async () => ({}))

  const startupDeps: CloudTurnDeps = {
    sessionOrchestration: store as never,
    sessionEventStore: {
      eventStream: sessionEventStreamMock,
      appendEvent: appendEventMock,
      queryEvents: vi.fn(),
      archive: vi.fn(),
    } as never,
    providers: {
      findModel: async () => ({ id: 'm', providerId: 'workers-ai', modelId: '@cf/x' }),
      findBySlug: async () => ({ id: 'workers-ai', slug: 'workers-ai' }),
    } as never,
    audit: { record: (auth: unknown, entry: unknown) => recordAuditMock(auth, entry) } as never,
    policy: { evaluateMcpTool: async () => ({ allowed: true }) } as never,
    cloudRuntime: {
      startCloudSession: (input: unknown) => startSessionRuntimeMock(env, input),
      stopCloudSession: (sandboxId: unknown) => stopSessionRuntimeMock(env, sandboxId),
    } as never,
    amaTurnExecutor: { runTurn: (input: unknown) => runSessionTurnMock(input as never) } as never,
    cloudTurnQueue: cloudTurnQueue as never,
    runtimeSecrets: {
      resolveEnv: () => resolveEnvFromMock(),
      resolveWorkspaceManifest: async () => ({ root: '/workspace', mounts: [] }),
    } as never,
    createApprovalGate: () =>
      ({
        shouldSuppressEvent: () => false,
        resolveToolResult: async () => null,
        gate: async () => null,
        requiresAction: () => false,
      }) as never,
  }

  const auth = {
    user: { id: 'user_1' },
    organization: { id: 'org_1', name: 'org_1' },
    project: { id: 'proj_1', name: 'proj_1' },
    roles: ['system'],
    permissions: ['*'],
  } as never

  function pendingRow(overrides: Record<string, unknown> = {}) {
    return {
      id: 'session_1',
      state: 'pending',
      sandboxId: 'sandbox_1',
      metadata: null,
      ...overrides,
    }
  }

  const agentSnapshot = { providerId: 'anthropic', model: '@cf/x', mcpConnectors: [] } as never

  beforeEach(() => {
    startSessionRuntimeMock.mockReset()
    startSessionRuntimeMock.mockResolvedValue({
      sandboxId: 'sandbox_1',
      metadata: { runtimeMode: 'test' },
    })
    stopSessionRuntimeMock.mockReset()
    stopSessionRuntimeMock.mockResolvedValue(undefined)
    resolveEnvFromMock.mockReset()
    resolveEnvFromMock.mockResolvedValue({})
    recordAuditMock.mockReset()
    appendEventMock.mockClear()
    findSessionMock.mockReset()
    findSessionMock.mockResolvedValue(pendingRow())
    updateSessionWhenStateMock.mockReset()
    updateSessionWhenStateMock.mockReturnValue(true)
    ;(store as { mcpCatalogEntries?: unknown }).mcpCatalogEntries = vi.fn(async () => [])
  })

  it('tears down the provisioned sandbox and skips audit/initial-prompt when the pending→idle CAS no-ops', async () => {
    // Sandbox provisioned, row still reads 'pending' on the re-read, but the CAS
    // loses the row (concurrent stop / duplicate session.start redelivery).
    updateSessionWhenStateMock.mockReturnValueOnce(false)

    await startSessionRuntimeForRow(startupDeps, auth, {
      pending: pendingRow() as never,
      agentSnapshot,
      environmentSnapshot: null,
      runtime: 'ama',
      runtimeConfig: {},
      env: {},
      envFrom: [],
      prompt: 'hello',
    })

    // The just-provisioned sandbox is torn down exactly once.
    expect(startSessionRuntimeMock).toHaveBeenCalledTimes(1)
    expect(stopSessionRuntimeMock).toHaveBeenCalledTimes(1)
    expect(stopSessionRuntimeMock).toHaveBeenCalledWith(env, 'sandbox_1')
    // No success audit and no initial-prompt dispatch (no second CAS) ran.
    const successAudits = recordAuditMock.mock.calls.filter(
      (call) => (call[1] as { outcome?: string }).outcome === 'success',
    )
    expect(successAudits).toHaveLength(0)
    expect(updateSessionWhenStateMock).toHaveBeenCalledTimes(1)
  })

  it('records the success audit and dispatches the initial prompt when the CAS succeeds', async () => {
    updateSessionWhenStateMock.mockReturnValue(true)

    await startSessionRuntimeForRow(startupDeps, auth, {
      pending: pendingRow() as never,
      agentSnapshot,
      environmentSnapshot: null,
      runtime: 'ama',
      runtimeConfig: {},
      env: {},
      envFrom: [],
      prompt: 'hello',
    })

    // No teardown on the happy path.
    expect(stopSessionRuntimeMock).not.toHaveBeenCalled()
    const successAudits = recordAuditMock.mock.calls.filter(
      (call) => (call[1] as { outcome?: string }).outcome === 'success',
    )
    expect(successAudits.length).toBeGreaterThanOrEqual(1)
    // The initial-prompt dispatch performs a second updateSessionWhenState CAS.
    expect(updateSessionWhenStateMock.mock.calls.length).toBeGreaterThanOrEqual(2)
  })

  it('[spec: environments/cloud-packages] persists a safe runtime error event when package setup fails', async () => {
    startSessionRuntimeMock.mockRejectedValue(
      new EnvironmentPackageInstallationError(
        'webi-install:realmroot@0.4.2',
        'Webi did not return an installer for the requested package',
      ),
    )

    await startSessionRuntimeForRow(startupDeps, auth, {
      pending: pendingRow() as never,
      agentSnapshot,
      environmentSnapshot: null,
      runtime: 'ama',
      runtimeConfig: {},
    })

    expect(appendEventMock).toHaveBeenCalledWith(
      { organizationId: 'org_1', projectId: 'proj_1', sessionId: 'session_1' },
      {
        type: 'runtime.error',
        payload: {
          message: 'Environment package installation failed at webi-install:realmroot@0.4.2',
          code: 'environment_package_installation_failed',
          details: {
            step: 'webi-install:realmroot@0.4.2',
            stderr: 'Webi did not return an installer for the requested package',
          },
        },
      },
    )
    expect(updateSessionWhenStateMock).toHaveBeenCalledWith(
      'proj_1',
      'session_1',
      'pending',
      expect.objectContaining({
        state: 'error',
        stateReason: 'Environment package installation failed at webi-install:realmroot@0.4.2',
      }),
    )
    expect(stopSessionRuntimeMock).toHaveBeenCalledWith(env, 'sandbox_1')
  })
})
