import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AuthScope } from '../ports'

// Robustness test for startup partial-failure (H5 FIX 2): when the launch
// dispatch throws after the pending row is persisted (e.g. the cloud-turn queue
// send fails), createSessionForAgent must reconcile the orphaned row to 'error'
// and report a session_launch_failed failure instead of stranding it 'pending'.
//
// The usecase is deps-first: the orchestration store, audit, policy, and queue
// all arrive on `deps`. Provider/runtime resolution + provider-config read live
// in the sibling provisioning usecase and the snapshot serializers in
// domain/runtime/session-snapshot; those module seams are stubbed so the test
// pins the reconcile flow directly.
const {
  enqueueCloudTurnMock,
  cloudTurnsRunInlineMock,
  startSessionRuntimeForRowMock,
  recordAuditMock,
  evaluateProviderPolicyForSessionMock,
  evaluateSandboxRuntimePolicyMock,
  resolveSessionProviderIdMock,
  validateRuntimeProviderModelMock,
  resolveSessionProviderConfigMock,
  createAgentSnapshotMock,
  createEnvironmentSnapshotMock,
  insertSessionMock,
  updateSessionWhenStateMock,
  findAgentMock,
  findAgentVersionMock,
  findEnvironmentMock,
  findEnvironmentVersionMock,
  resolveEnvironmentForRuntimeMock,
  assignWorkMock,
} = vi.hoisted(() => ({
  enqueueCloudTurnMock: vi.fn(),
  cloudTurnsRunInlineMock: vi.fn(() => false),
  startSessionRuntimeForRowMock: vi.fn(),
  recordAuditMock: vi.fn(),
  evaluateProviderPolicyForSessionMock: vi.fn<(auth: unknown, values: unknown) => Promise<unknown>>(async () => ({
    decision: { allowed: true },
    override: null,
  })),
  evaluateSandboxRuntimePolicyMock: vi.fn<(auth: unknown, values: unknown) => Promise<unknown>>(async () => ({
    allowed: true,
  })),
  resolveSessionProviderIdMock: vi.fn(async () => 'anthropic'),
  validateRuntimeProviderModelMock: vi.fn(async () => true),
  resolveSessionProviderConfigMock: vi.fn(async () => ({ ok: true, config: null })),
  createAgentSnapshotMock: vi.fn(() => ({ id: 'agentver_1', providerId: 'anthropic', model: '@cf/x' })),
  createEnvironmentSnapshotMock: vi.fn(() => ({ id: 'envver_1', hostingMode: 'cloud', runtimeConfig: {} })),
  insertSessionMock: vi.fn(async () => undefined),
  updateSessionWhenStateMock: vi.fn<
    (projectId: string, sessionId: string, expected: string | string[], fields: Record<string, unknown>) => boolean
  >(() => true),
  findAgentMock: vi.fn(),
  findAgentVersionMock: vi.fn(),
  findEnvironmentMock: vi.fn(),
  findEnvironmentVersionMock: vi.fn(),
  resolveEnvironmentForRuntimeMock: vi.fn(),
  assignWorkMock: vi.fn(async () => true),
}))

// Provider/runtime resolution + provider-config read live in the deps-first
// provisioning usecase. Stub those seams.
vi.mock('./provisioning', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./provisioning')>()),
  resolveSessionProviderId: resolveSessionProviderIdMock,
  validateRuntimeProviderModel: validateRuntimeProviderModelMock,
  resolveSessionProviderConfig: resolveSessionProviderConfigMock,
}))

vi.mock('@server/domain/runtime/session-snapshot', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@server/domain/runtime/session-snapshot')>()),
  createAgentSnapshot: createAgentSnapshotMock,
  createEnvironmentSnapshot: createEnvironmentSnapshotMock,
}))

// The inline cloud launch delegates to the cloud-turn usecase; the queued path
// (runsInline=false) never reaches it, but stub it so no real startup runs.
vi.mock('./cloud-turn', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./cloud-turn')>()),
  startSessionRuntimeForRow: startSessionRuntimeForRowMock,
}))

import { type CreateSessionDeps, createSessionForAgent } from './session-create'

const store = {
  db: {},
  findAgent: findAgentMock,
  findAgentVersion: findAgentVersionMock,
  findEnvironment: findEnvironmentMock,
  findEnvironmentVersion: findEnvironmentVersionMock,
  resolveEnvironmentForRuntime: resolveEnvironmentForRuntimeMock,
  insertSession: insertSessionMock,
  updateSessionWhenState: updateSessionWhenStateMock,
}

// enqueue is env-bound at the gateway; the usecase drives it through
// deps.cloudTurnQueue.enqueue(message). Route it to the spy so the throw lands on
// the launch dispatch the reconcile flow catches.
const deps: CreateSessionDeps = {
  sessionOrchestration: store as never,
  sessionEventStore: {
    eventStream: async () => [],
    appendCanonicalEvent: async () => 'event_test',
    queryEvents: async () => ({ rows: [], hasMore: false }),
    archive: async () => {},
  } as never,
  providers: {
    findModel: async () => ({ id: 'm', providerId: 'workers-ai', modelId: '@cf/x' }),
    findBySlug: async () => ({ id: 'workers-ai', slug: 'workers-ai' }),
  } as never,
  audit: { record: (auth: unknown, entry: unknown) => recordAuditMock(auth, entry) } as never,
  policy: {
    evaluateProviderForSession: (auth: unknown, values: unknown) =>
      evaluateProviderPolicyForSessionMock(auth as never, values as never),
    evaluateSandboxRuntime: (auth: unknown, values: unknown) =>
      evaluateSandboxRuntimePolicyMock(auth as never, values as never),
  } as never,
  cloudRuntime: {} as never,
  amaTurnExecutor: {} as never,
  cloudTurnQueue: {
    enqueue: (message: unknown) => enqueueCloudTurnMock(message),
    runsInline: () => cloudTurnsRunInlineMock(),
  } as never,
  runtimeSecrets: {
    resolveEnv: async () => ({}),
    resolveWorkspaceManifest: async () => ({ root: '/workspace', mounts: [] }),
  } as never,
  runnerChannel: {
    assignWork: assignWorkMock,
  } as never,
  createApprovalGate: () => ({}) as never,
  rereadStartedSession: false,
}

const auth: AuthScope = {
  user: { id: 'user_1' },
  organization: { id: 'org_1', name: 'org_1' },
  project: { id: 'proj_1', name: 'proj_1' },
  roles: ['system'],
  permissions: ['*'],
}

describe('createSessionForAgent — launch dispatch failure (H5 FIX 2)', () => {
  beforeEach(() => {
    enqueueCloudTurnMock.mockReset()
    cloudTurnsRunInlineMock.mockReturnValue(false)
    recordAuditMock.mockReset()
    insertSessionMock.mockReset()
    insertSessionMock.mockResolvedValue(undefined)
    updateSessionWhenStateMock.mockReset()
    updateSessionWhenStateMock.mockReturnValue(true)
    findAgentMock.mockResolvedValue({
      id: 'agent_1',
      currentVersionId: 'agentver_1',
      archivedAt: null,
    })
    findAgentVersionMock.mockResolvedValue({ id: 'agentver_1', model: '@cf/x', providerId: 'anthropic' })
    findEnvironmentMock.mockResolvedValue({ id: 'env_1', currentVersionId: 'envver_1' })
    findEnvironmentVersionMock.mockResolvedValue({ id: 'envver_1', hostingMode: 'cloud' })
    resolveEnvironmentForRuntimeMock.mockReset()
    assignWorkMock.mockClear()
  })

  it('reconciles the orphaned pending row to error and returns session_launch_failed when the cloud-turn enqueue throws', async () => {
    enqueueCloudTurnMock.mockRejectedValue(new Error('queue send failed'))

    const result = await createSessionForAgent(
      deps,
      auth,
      'agent_1',
      'env_1',
      { runtime: 'ama', prompt: 'Start cloud session' },
      null,
    )

    expect(result).toEqual({
      ok: false,
      error: { status: 500, code: 'session_launch_failed', message: 'queue send failed' },
    })
    // The pending row was inserted, then reconciled to 'error' under the
    // pending CAS.
    expect(insertSessionMock).toHaveBeenCalledTimes(1)
    const reconcile = updateSessionWhenStateMock.mock.calls.find(
      (call) => call[2] === 'pending' && (call[3] as { state?: string }).state === 'error',
    )
    expect(reconcile).toBeTruthy()
    expect((reconcile?.[3] as { stateReason?: string }).stateReason).toBe('queue send failed')
    // A create-failure audit was recorded.
    const failureAudit = recordAuditMock.mock.calls.find(
      (call) =>
        (call[1] as { action?: string; outcome?: string }).action === 'session.create' &&
        (call[1] as { outcome?: string }).outcome === 'failure',
    )
    expect(failureAudit).toBeTruthy()
  })

  it('keeps the happy path: returns ok and does not reconcile when the enqueue succeeds', async () => {
    enqueueCloudTurnMock.mockResolvedValue(undefined)

    const result = await createSessionForAgent(
      deps,
      auth,
      'agent_1',
      'env_1',
      { runtime: 'ama', prompt: 'Start cloud session' },
      'req_create_1',
    )

    expect(result.ok).toBe(true)
    expect(insertSessionMock).toHaveBeenCalledWith(expect.objectContaining({ title: 'Start cloud session' }))
    expect(enqueueCloudTurnMock).toHaveBeenCalledTimes(1)
    expect(enqueueCloudTurnMock).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'session.start', requestId: 'req_create_1' }),
    )
    const reconcile = updateSessionWhenStateMock.mock.calls.find(
      (call) => (call[3] as { state?: string }).state === 'error',
    )
    expect(reconcile).toBeUndefined()
  })

  it('rejects sessions without a prompt before creating any rows', async () => {
    const result = await createSessionForAgent(
      deps,
      auth,
      'agent_1',
      'env_1',
      {
        runtime: 'codex',
        prompt: '',
      },
      null,
    )

    expect(result).toEqual({
      ok: false,
      error: {
        status: 400,
        code: 'validation_error',
        message: 'Prompt is required',
        fields: { prompt: 'Prompt is required.' },
      },
    })
    expect(insertSessionMock).not.toHaveBeenCalled()
    expect(assignWorkMock).not.toHaveBeenCalled()
  })
})

describe('createSessionForAgent — environment resolution', () => {
  beforeEach(() => {
    enqueueCloudTurnMock.mockReset()
    enqueueCloudTurnMock.mockResolvedValue(undefined)
    cloudTurnsRunInlineMock.mockReturnValue(false)
    recordAuditMock.mockReset()
    insertSessionMock.mockReset()
    insertSessionMock.mockResolvedValue(undefined)
    updateSessionWhenStateMock.mockReset()
    updateSessionWhenStateMock.mockReturnValue(true)
    findAgentMock.mockResolvedValue({
      id: 'agent_1',
      currentVersionId: 'agentver_1',
      archivedAt: null,
    })
    findAgentVersionMock.mockResolvedValue({ id: 'agentver_1', model: '@cf/x', providerId: 'anthropic' })
    findEnvironmentMock.mockReset()
    findEnvironmentMock.mockResolvedValue({ id: 'env_resolved', currentVersionId: 'envver_1' })
    findEnvironmentVersionMock.mockResolvedValue({ id: 'envver_1', hostingMode: 'cloud' })
    resolveEnvironmentForRuntimeMock.mockReset()
  })

  it('resolves an environment for the runtime/provider/model when none is pinned', async () => {
    resolveEnvironmentForRuntimeMock.mockResolvedValue('env_resolved')

    const result = await createSessionForAgent(
      deps,
      auth,
      'agent_1',
      null,
      { runtime: 'codex', prompt: 'Run Codex' },
      null,
    )

    expect(result.ok).toBe(true)
    expect(resolveEnvironmentForRuntimeMock).toHaveBeenCalledWith('proj_1', 'codex', 'anthropic', '@cf/x')
    // The resolved id is what gets looked up and used.
    expect(findEnvironmentMock).toHaveBeenCalledWith('proj_1', 'env_resolved')
  })

  it('does not resolve when an environment is pinned', async () => {
    const result = await createSessionForAgent(
      deps,
      auth,
      'agent_1',
      'env_pinned',
      { runtime: 'codex', prompt: 'Run Codex' },
      null,
    )

    expect(result.ok).toBe(true)
    expect(resolveEnvironmentForRuntimeMock).not.toHaveBeenCalled()
    expect(findEnvironmentMock).toHaveBeenCalledWith('proj_1', 'env_pinned')
  })

  it('returns a 409 and creates no session when no environment can be resolved', async () => {
    resolveEnvironmentForRuntimeMock.mockResolvedValue(null)

    const result = await createSessionForAgent(
      deps,
      auth,
      'agent_1',
      null,
      { runtime: 'codex', prompt: 'Run Codex' },
      null,
    )

    expect(result).toEqual({
      ok: false,
      error: {
        status: 409,
        code: 'conflict',
        message: 'No environment has an active runner for runtime "codex"; specify environmentId',
      },
    })
    expect(findEnvironmentMock).not.toHaveBeenCalled()
    expect(insertSessionMock).not.toHaveBeenCalled()
  })
})
