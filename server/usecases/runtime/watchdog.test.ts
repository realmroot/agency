import { describe, expect, it, vi } from 'vitest'
import { LIFECYCLE_LEASE_TTL_MS } from '../../domain/runtime/turn'
import type { SessionOrchestrationStore } from '../ports'
import { markStalledCloudSessions } from './watchdog'

describe('cloud sandbox watchdog', () => {
  it('[spec: sessions/close] leaves a failed destroy unstamped so a later maintenance pass can retry it', async () => {
    const stopCloudSession = vi
      .fn<(sandboxId: string) => Promise<void>>()
      .mockRejectedValueOnce(new Error('provider unavailable'))
      .mockResolvedValueOnce(undefined)
    const stampSandboxDestroyed = vi.fn(async () => true)
    const claimSandboxCleanup = vi.fn<SessionOrchestrationStore['claimSandboxCleanup']>(async () => true)
    const releaseSandboxCleanup = vi.fn(async () => true)
    const deps = {
      sessionOrchestration: {
        markStalledCloudSessions: vi.fn(async () => undefined),
        leakedSandboxSessions: vi.fn(async () => [
          { id: 'session_1', sandboxId: 'sandbox_1', metadata: JSON.stringify({ retained: true }) },
        ]),
        claimSandboxCleanup,
        releaseSandboxCleanup,
        stampSandboxDestroyed,
      },
      cloudRuntime: { stopCloudSession },
    } as never

    await expect(markStalledCloudSessions(deps)).rejects.toBeInstanceOf(AggregateError)
    expect(stampSandboxDestroyed).not.toHaveBeenCalled()
    const firstCleanupId = claimSandboxCleanup.mock.calls[0]?.[2]
    const [, , , firstLeaseExpiresAt, firstClaimedAt] = claimSandboxCleanup.mock.calls[0]!
    expect(Date.parse(firstLeaseExpiresAt) - Date.parse(firstClaimedAt)).toBe(LIFECYCLE_LEASE_TTL_MS)
    expect(releaseSandboxCleanup).toHaveBeenCalledWith('session_1', 'sandbox_1', firstCleanupId)

    await expect(markStalledCloudSessions(deps)).resolves.toBeUndefined()
    expect(stopCloudSession).toHaveBeenCalledTimes(2)
    expect(stampSandboxDestroyed).toHaveBeenCalledOnce()
    const secondCleanupId = claimSandboxCleanup.mock.calls[1]?.[2]
    expect(stampSandboxDestroyed).toHaveBeenCalledWith('session_1', 'sandbox_1', secondCleanupId, expect.any(String))
  })

  it('[spec: sessions/close] skips destroy when another cleanup owner wins the sandbox claim', async () => {
    const stopCloudSession = vi.fn()
    const stampSandboxDestroyed = vi.fn()
    const deps = {
      sessionOrchestration: {
        markStalledCloudSessions: vi.fn(async () => undefined),
        leakedSandboxSessions: vi.fn(async () => [{ id: 'session_1', sandboxId: 'sandbox_1', metadata: '{}' }]),
        claimSandboxCleanup: vi.fn(async () => false),
        releaseSandboxCleanup: vi.fn(),
        stampSandboxDestroyed,
      },
      cloudRuntime: { stopCloudSession },
    } as never

    await expect(markStalledCloudSessions(deps)).resolves.toBeUndefined()

    expect(stopCloudSession).not.toHaveBeenCalled()
    expect(stampSandboxDestroyed).not.toHaveBeenCalled()
  })
})
