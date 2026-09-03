import { describe, expect, it, vi } from 'vitest'
import { LIFECYCLE_LEASE_TTL_MS } from '../../domain/runtime/turn'
import type { SessionOrchestrationStore } from '../ports'

vi.mock('./cloud-turn', () => ({ startSessionRuntimeForRow: vi.fn(async () => undefined) }))

import { startSessionRuntimeForRow } from './cloud-turn'
import { closeSession, markExpiredPendingSessions, reopenSession } from './session-lifecycle'

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
  it('[spec: runtime/idle-retention] sweeps pending generations only after the lifecycle lease window', async () => {
    const sweep = vi.fn<SessionOrchestrationStore['markExpiredPendingSessions']>(async () => undefined)

    await markExpiredPendingSessions({ sessionOrchestration: { markExpiredPendingSessions: sweep } } as never, auth)

    const [projectId, expiredBefore, sweptAt] = sweep.mock.calls[0]!
    expect(projectId).toBe('proj_1')
    expect(Date.parse(sweptAt) - Date.parse(expiredBefore)).toBe(LIFECYCLE_LEASE_TTL_MS)
  })

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

  it('[spec: sessions/close] rejects close when the atomic claim sees an active turn lease', async () => {
    const active = {
      ...session('running'),
      sandboxId: 'sandbox_1',
      activeTurnId: 'turn_1',
      turnLeaseExpiresAt: new Date(Date.now() + 60_000).toISOString(),
      volumes: '[]',
      volumeMounts: '[]',
    }
    const updateSession = vi.fn()
    const claimSessionClose = vi.fn(async () => false)
    const stopCloudSession = vi.fn()
    const audit = { record: vi.fn() }
    const deps = {
      sessionOrchestration: { findSession: vi.fn(async () => active), updateSession, claimSessionClose },
      cloudRuntime: { stopCloudSession },
      audit,
    } as never

    await expect(closeSession(deps, auth, active.id, 'req_1')).resolves.toEqual({
      ok: false,
      error: {
        status: 409,
        code: 'conflict',
        message: 'Session has an active turn or is no longer available to close',
      },
    })
    expect(updateSession).not.toHaveBeenCalled()
    expect(claimSessionClose).toHaveBeenCalledWith(
      'proj_1',
      active.id,
      'sandbox_1',
      expect.any(String),
      expect.any(String),
      expect.any(String),
    )
    expect(stopCloudSession).not.toHaveBeenCalled()
    expect(audit.record).not.toHaveBeenCalled()
  })

  it('[spec: sessions/close] permits close after the turn lease expires', async () => {
    const active = {
      ...session('running'),
      sandboxId: 'sandbox_1',
      activeTurnId: 'turn_1',
      turnLeaseExpiresAt: new Date(Date.now() - 60_000).toISOString(),
      volumes: '[]',
      volumeMounts: '[]',
      resumeToken: null,
    }
    const closed = { ...active, state: 'closed', closedAt: new Date().toISOString() }
    const updateSession = vi.fn(async () => closed)
    const claimSessionClose = vi.fn<SessionOrchestrationStore['claimSessionClose']>(async () => true)
    const completeSessionClose = vi.fn(async () => true)
    const stopCloudSession = vi.fn(async () => undefined)
    const deps = {
      sessionOrchestration: {
        findSession: vi.fn().mockResolvedValueOnce(active).mockResolvedValueOnce(closed),
        updateSession,
        claimSessionClose,
        completeSessionClose,
      },
      cloudRuntime: { stopCloudSession },
      runtimeWorkspace: { readMemoryStoreMemories: vi.fn() },
      sessionEventStore: { archive: vi.fn(async () => undefined) },
      audit: { record: vi.fn(async () => undefined) },
    } as never

    await expect(closeSession(deps, auth, active.id, 'req_1')).resolves.toEqual({ ok: true, session: closed })
    expect(stopCloudSession).toHaveBeenCalledWith('sandbox_1')
    const cleanupId = claimSessionClose.mock.calls[0]?.[3]
    expect(cleanupId).toEqual(expect.any(String))
    const [, , , , leaseExpiresAt, claimedAt] = claimSessionClose.mock.calls[0]!
    expect(Date.parse(leaseExpiresAt) - Date.parse(claimedAt)).toBe(LIFECYCLE_LEASE_TTL_MS)
    expect(completeSessionClose).toHaveBeenCalledWith('proj_1', active.id, 'sandbox_1', cleanupId, expect.any(String))
  })

  it('[spec: sessions/close] reports a repeated close as successful only after cleanup is finalized', async () => {
    const closing = {
      ...session('closed'),
      sandboxId: 'sandbox_1',
      stateReason: 'closing',
      closedAt: null,
    }
    const finalized = {
      ...closing,
      stateReason: null,
      closedAt: '2026-09-03T00:01:00.000Z',
    }
    const claimSessionClose = vi.fn()
    const stopCloudSession = vi.fn()

    await expect(
      closeSession(
        {
          sessionOrchestration: { findSession: vi.fn(async () => closing), claimSessionClose },
          cloudRuntime: { stopCloudSession },
        } as never,
        auth,
        closing.id,
        'req_closing',
      ),
    ).resolves.toEqual({
      ok: false,
      error: { status: 409, code: 'conflict', message: 'Session runtime cleanup is still in progress' },
    })

    await expect(
      closeSession(
        {
          sessionOrchestration: { findSession: vi.fn(async () => finalized), claimSessionClose },
          cloudRuntime: { stopCloudSession },
        } as never,
        auth,
        finalized.id,
        'req_finalized',
      ),
    ).resolves.toEqual({ ok: true, session: finalized })
    expect(claimSessionClose).not.toHaveBeenCalled()
    expect(stopCloudSession).not.toHaveBeenCalled()
  })

  it('[spec: sessions/close] blocks reopen while a claimed cloud close is still tearing down', async () => {
    const closing = {
      ...session('closed'),
      sandboxId: 'sandbox_1',
      stateReason: 'closing',
      closedAt: null,
      metadata: JSON.stringify({ runtime: 'enbor' }),
    }
    const updateSessionWhenState = vi.fn()
    const deps = {
      sessionOrchestration: { findSession: vi.fn(async () => closing), updateSessionWhenState },
      audit: { record: vi.fn() },
    } as never

    await expect(reopenSession(deps, auth, closing.id, 'req_1')).resolves.toEqual({
      ok: false,
      error: { status: 409, code: 'conflict', message: 'Session runtime cleanup is not complete' },
    })
    expect(updateSessionWhenState).not.toHaveBeenCalled()
    expect(startSessionRuntimeForRow).not.toHaveBeenCalled()
  })

  it('[spec: sessions/close] permits reopen after close finalization confirms sandbox destruction', async () => {
    const closed = {
      ...session('closed'),
      sandboxId: 'sandbox_1',
      closedAt: '2026-09-03T00:01:00.000Z',
      agentSnapshot: JSON.stringify({ provider: 'workers-ai', model: '@cf/test', mcpConnectors: [] }),
      environmentSnapshot: null,
      env: '{}',
      envFrom: '[]',
      volumes: '[]',
      volumeMounts: '[]',
      metadata: JSON.stringify({ runtime: 'enbor', sandboxDestroyedAt: '2026-09-03T00:01:00.000Z' }),
    }
    const reopened = {
      ...closed,
      state: 'pending',
      startedAt: '2026-09-03T00:02:00.000Z',
      closedAt: null,
      metadata: JSON.stringify({ runtime: 'enbor' }),
    }
    const claimSessionReopen = vi.fn<SessionOrchestrationStore['claimSessionReopen']>(async () => true)
    const deps = {
      sessionOrchestration: {
        findSession: vi.fn().mockResolvedValueOnce(closed).mockResolvedValueOnce(reopened),
        claimSessionReopen,
      },
      audit: { record: vi.fn(async () => undefined) },
    } as never

    await expect(reopenSession(deps, auth, closed.id, 'req_1')).resolves.toEqual({ ok: true, session: reopened })
    expect(claimSessionReopen).toHaveBeenCalledWith('proj_1', closed.id, 'sandbox_1', expect.any(String))
    const startedAt = claimSessionReopen.mock.calls[0]?.[3]
    expect(startSessionRuntimeForRow).toHaveBeenCalledWith(
      deps,
      auth,
      expect.objectContaining({
        pending: expect.objectContaining({
          id: closed.id,
          state: 'pending',
          sandboxId: 'sandbox_1',
          startedAt,
          metadata: JSON.stringify({ runtime: 'enbor' }),
        }),
      }),
    )
  })
})
