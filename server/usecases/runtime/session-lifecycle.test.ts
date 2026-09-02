import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SessionOrchestrationStore } from '../ports'

vi.mock('./cloud-turn', () => ({ startSessionRuntimeForRow: vi.fn() }))

import { startSessionRuntimeForRow } from './cloud-turn'
import { closeSession, reopenSession } from './session-lifecycle'
import { maintainCloudSessionLifecycle, markIdleTimedOutSessions as runIdleTimeoutCleanup } from './watchdog'

const auth = {
  organization: { id: 'org_1' },
  project: { id: 'proj_1' },
} as never

function session(state: string) {
  return {
    id: 'sess_1',
    organizationId: 'org_1',
    projectId: 'proj_1',
    state,
    stateReason: null,
    sandboxId: null,
    metadata: '{}',
  }
}

describe('session lifecycle maintenance', () => {
  beforeEach(() => vi.clearAllMocks())

  it('treats reopen on an active session as idempotent', async () => {
    const updateSession = vi.fn()
    const deps = {
      sessionOrchestration: {
        findSession: vi.fn().mockResolvedValue(session('running')),
        updateSession,
      },
      audit: { record: vi.fn() },
    } as never

    const result = await reopenSession(deps, auth, 'sess_1', 'req_1')

    expect(result).toEqual({ ok: true, session: session('running') })
    expect(updateSession).not.toHaveBeenCalled()
  })

  it('[spec: sessions/idle-timeout] reopens a destroyed cloud Session with a fresh sandbox generation', async () => {
    const closed = {
      ...session('closed'),
      sandboxId: 'sandbox_generation_1',
      agentSnapshot: JSON.stringify({ provider: 'workers-ai', model: '@cf/test' }),
      environmentSnapshot: null,
      env: '{}',
      envFrom: '[]',
      volumes: '[]',
      volumeMounts: '[]',
      metadata: JSON.stringify({
        runtime: 'ama',
        sandboxDestroyedAt: '2026-09-01T00:00:00.000Z',
        retained: 'value',
      }),
    }
    const findSession = vi
      .fn()
      .mockResolvedValueOnce(closed)
      .mockResolvedValueOnce({ ...closed, state: 'idle' })
    const updateSessionWhenState = vi.fn<SessionOrchestrationStore['updateSessionWhenState']>(async () => true)
    const deps = {
      sessionOrchestration: { findSession, updateSessionWhenState },
      audit: { record: vi.fn() },
    } as never

    await reopenSession(deps, auth, closed.id, 'req_1')

    const transition = updateSessionWhenState.mock.calls[0]?.[3]
    expect(transition?.sandboxId).toEqual(expect.any(String))
    expect(transition?.sandboxId).not.toBe('sandbox_generation_1')
    expect(JSON.parse(transition?.metadata ?? '{}')).toEqual({ runtime: 'ama', retained: 'value' })
    expect(startSessionRuntimeForRow).toHaveBeenCalledWith(
      deps,
      auth,
      expect.objectContaining({
        pending: expect.objectContaining({ sandboxId: transition?.sandboxId, metadata: transition?.metadata }),
      }),
    )
  })

  it('[spec: sessions/close] rejects direct reopen while the closed cloud sandbox still awaits destruction confirmation', async () => {
    const closed = {
      ...session('closed'),
      sandboxId: 'sandbox_cleanup_pending',
      agentSnapshot: JSON.stringify({ provider: 'workers-ai', model: '@cf/test' }),
      metadata: JSON.stringify({ runtime: 'ama' }),
    }
    const updateSessionWhenState = vi.fn<SessionOrchestrationStore['updateSessionWhenState']>(async () => true)
    const deps = {
      sessionOrchestration: {
        findSession: vi.fn(async () => closed),
        updateSessionWhenState,
      },
      audit: { record: vi.fn() },
    } as never

    const result = await reopenSession(deps, auth, closed.id, 'req_1')

    expect(result).toEqual({
      ok: false,
      error: {
        status: 409,
        code: 'conflict',
        message: 'Session sandbox cleanup must complete before reopening',
      },
    })
    expect(updateSessionWhenState).not.toHaveBeenCalled()
    expect(startSessionRuntimeForRow).not.toHaveBeenCalled()
  })

  it('[spec: sessions/close] records successful explicit cloud sandbox destruction against its exact generation', async () => {
    const active = {
      ...session('idle'),
      sandboxId: 'sandbox_generation_1',
      metadata: JSON.stringify({ runtime: 'ama', retained: 'value' }),
      volumes: '[]',
      volumeMounts: '[]',
    }
    const closed = { ...active, state: 'closed', closedAt: '2026-09-02T00:00:00.000Z' }
    const updateSessionWhenStateAndSandbox = vi.fn<SessionOrchestrationStore['updateSessionWhenStateAndSandbox']>(
      async () => true,
    )
    const finalizeCloudSessionClose = vi.fn<SessionOrchestrationStore['finalizeCloudSessionClose']>(async () => true)
    const deps = {
      sessionOrchestration: {
        findSession: vi.fn().mockResolvedValueOnce(active).mockResolvedValueOnce(closed),
        updateSessionWhenStateAndSandbox,
        finalizeCloudSessionClose,
      },
      cloudRuntime: { stopCloudSession: vi.fn(async () => undefined) },
      runtimeWorkspace: { readMemoryStoreMemories: vi.fn() },
      sessionEventStore: { archive: vi.fn(async () => undefined) },
      audit: { record: vi.fn(async () => undefined) },
    } as never

    await expect(closeSession(deps, auth, active.id, 'req_1')).resolves.toEqual({ ok: true, session: closed })

    expect(finalizeCloudSessionClose).toHaveBeenCalledWith(
      'proj_1',
      active.id,
      'sandbox_generation_1',
      expect.any(String),
    )
    expect(Date.parse(finalizeCloudSessionClose.mock.calls[0]?.[3] ?? '')).not.toBeNaN()
  })

  it('[spec: sessions/close] leaves generation two untouched when a stale explicit close cannot claim generation one', async () => {
    const active = {
      ...session('idle'),
      sandboxId: 'sandbox_generation_1',
      metadata: JSON.stringify({ runtime: 'ama', generation: 1 }),
      volumes: '[]',
      volumeMounts: '[]',
    }
    const stopCloudSession = vi.fn()
    const finalizeCloudSessionClose = vi.fn()
    const audit = { record: vi.fn() }
    const deps = {
      sessionOrchestration: {
        findSession: vi.fn(async () => active),
        updateSessionWhenStateAndSandbox: vi.fn(async () => false),
        finalizeCloudSessionClose,
      },
      cloudRuntime: { stopCloudSession },
      audit,
    } as never

    await expect(closeSession(deps, auth, active.id, 'req_1')).resolves.toEqual({
      ok: false,
      error: {
        status: 409,
        code: 'conflict',
        message: 'Session runtime is no longer on the requested sandbox generation',
      },
    })
    expect(stopCloudSession).not.toHaveBeenCalled()
    expect(finalizeCloudSessionClose).not.toHaveBeenCalled()
    expect(audit.record).not.toHaveBeenCalled()
  })

  it('[spec: sessions/close] suppresses stale failure audit when generation one stop fails after generation two wins', async () => {
    const active = {
      ...session('idle'),
      sandboxId: 'sandbox_generation_1',
      metadata: JSON.stringify({ runtime: 'ama', generation: 1 }),
      volumes: '[]',
      volumeMounts: '[]',
    }
    const updateSessionWhenStateAndSandbox = vi
      .fn<SessionOrchestrationStore['updateSessionWhenStateAndSandbox']>()
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false)
    const finalizeCloudSessionClose = vi.fn()
    const audit = { record: vi.fn() }
    const deps = {
      sessionOrchestration: {
        findSession: vi.fn(async () => active),
        updateSessionWhenStateAndSandbox,
        finalizeCloudSessionClose,
      },
      cloudRuntime: { stopCloudSession: vi.fn(async () => Promise.reject(new Error('late stop failure'))) },
      runtimeWorkspace: { readMemoryStoreMemories: vi.fn() },
      audit,
    } as never

    await expect(closeSession(deps, auth, active.id, 'req_1')).resolves.toEqual({
      ok: false,
      error: { status: 409, code: 'conflict', message: 'Session runtime close is stale' },
    })
    expect(updateSessionWhenStateAndSandbox).toHaveBeenNthCalledWith(
      2,
      'proj_1',
      active.id,
      'closed',
      'sandbox_generation_1',
      expect.objectContaining({ state: 'error' }),
    )
    expect(finalizeCloudSessionClose).not.toHaveBeenCalled()
    expect(audit.record).not.toHaveBeenCalled()
  })

  it('delegates idle timeout cleanup to the session store', async () => {
    const markIdleTimedOutSessions = vi.fn(async () => [])
    const deps = {
      sessionOrchestration: { markIdleTimedOutSessions },
    } as never

    await runIdleTimeoutCleanup(deps)

    expect(markIdleTimedOutSessions).toHaveBeenCalledWith(expect.any(String), 20)
  })

  it('[spec: sessions/idle-timeout] directly destroys the exact bounded idle-timeout batch before sweeping older leaks', async () => {
    const calls: string[] = []
    const stopCloudSession = vi.fn(async (sandboxId: string) => {
      calls.push(`destroy:${sandboxId}`)
    })
    const deps = {
      sessionOrchestration: {
        markIdleTimedOutSessions: vi.fn(async () => {
          calls.push('close-idle-session')
          return [{ id: 'sess_new', sandboxId: 'sandbox_new', metadata: '{}' }]
        }),
        markStalledCloudSessions: vi.fn(async () => {
          calls.push('close-stalled-session')
          return []
        }),
        leakedSandboxSessions: vi.fn(async () => {
          calls.push('select-ended-sandbox')
          return [{ id: 'sess_old', sandboxId: 'sandbox_old', metadata: '{}' }]
        }),
        stampSandboxDestroyed: vi.fn(async (sessionId: string) => {
          calls.push(`stamp:${sessionId}`)
        }),
      },
      cloudRuntime: { stopCloudSession },
    } as never

    await maintainCloudSessionLifecycle(deps)

    expect(calls).toEqual([
      'close-idle-session',
      'destroy:sandbox_new',
      'stamp:sess_new',
      'close-stalled-session',
      'select-ended-sandbox',
      'destroy:sandbox_old',
      'stamp:sess_old',
    ])
  })

  it('[spec: sessions/idle-timeout] leaves a failed sandbox destruction unstamped for retry while stamping successful destruction', async () => {
    const stampSandboxDestroyed = vi.fn()
    const deps = {
      sessionOrchestration: {
        markIdleTimedOutSessions: vi.fn(async () => [
          { id: 'sess_failed', sandboxId: 'sandbox_failed', metadata: '{}' },
          { id: 'sess_succeeded', sandboxId: 'sandbox_succeeded', metadata: '{}' },
        ]),
        markStalledCloudSessions: vi.fn(),
        leakedSandboxSessions: vi.fn(async () => []),
        stampSandboxDestroyed,
      },
      cloudRuntime: {
        stopCloudSession: vi.fn(async (sandboxId: string) => {
          if (sandboxId === 'sandbox_failed') throw new Error('temporary provider failure')
        }),
      },
    } as never

    await expect(maintainCloudSessionLifecycle(deps)).rejects.toBeInstanceOf(AggregateError)

    expect(stampSandboxDestroyed).toHaveBeenCalledOnce()
    expect(stampSandboxDestroyed).toHaveBeenCalledWith('sess_succeeded', 'sandbox_succeeded', expect.any(String))
  })
})
