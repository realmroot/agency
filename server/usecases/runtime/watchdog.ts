// Stalled-session + leaked-sandbox watchdog — deps-first.
//
// A queue-consumer invocation owns at most ~15 minutes of wall clock; a cloud
// session still "running" (turn) or "pending" (startup) past this window lost
// its consumer and would otherwise stay stuck forever. Marking it as error lets
// clients and reconciliation sweeps recover the work.
//
// Deps-first: the store and cloud runtime lifecycle arrive as ports on `deps`;
// the module is infra-free.

import { lifecycleLeaseExpiry, newTurnId } from '@server/domain/runtime/turn'
import type { CloudRuntimeLifecycle, SessionOrchestrationStore } from '../ports'

const STALLED_THRESHOLD_MS = 20 * 60_000
const ENDED_RUNTIME_STATES = ['closed', 'error']

type WatchdogDeps = {
  sessionOrchestration: SessionOrchestrationStore
  cloudRuntime: CloudRuntimeLifecycle
}

export async function markStalledCloudSessions(deps: WatchdogDeps): Promise<void> {
  const threshold = new Date(Date.now() - STALLED_THRESHOLD_MS).toISOString()
  // a cloud turn lost its consumer mid-run, or a cloud startup died before
  // assigning a sandbox; self-hosted sessions waiting for a runner carry a
  // stateReason and may wait indefinitely, so they are excluded
  await deps.sessionOrchestration.markStalledCloudSessions(threshold, new Date().toISOString())
  await destroyLeakedSandboxes(deps, threshold)
}

// Sandboxes of ended sessions occupy container instances (max_instances is a
// hard cap) when teardown was skipped — e.g. a close while an exec was hung.
// Destroy them and stamp the session so each sandbox is cleaned exactly once.
async function destroyLeakedSandboxes(deps: WatchdogDeps, closingBefore: string): Promise<void> {
  // deletedAt is a tombstone, not a state value
  const rows = await deps.sessionOrchestration.leakedSandboxSessions(ENDED_RUNTIME_STATES, 20, closingBefore)
  const failures: Error[] = []
  for (const row of rows) {
    if (!row.sandboxId) continue
    const cleanupId = newTurnId()
    const claimedAt = new Date().toISOString()
    const claimed = await deps.sessionOrchestration.claimSandboxCleanup(
      row.id,
      row.sandboxId,
      cleanupId,
      lifecycleLeaseExpiry(claimedAt),
      claimedAt,
    )
    if (!claimed) continue
    try {
      await deps.cloudRuntime.stopCloudSession(row.sandboxId)
    } catch (error) {
      await deps.sessionOrchestration.releaseSandboxCleanup(row.id, row.sandboxId, cleanupId)
      failures.push(
        new Error(`failed to destroy leaked sandbox ${row.sandboxId} for session ${row.id}`, { cause: error }),
      )
      continue
    }
    const destroyedAt = new Date().toISOString()
    const stamped = await deps.sessionOrchestration.stampSandboxDestroyed(row.id, row.sandboxId, cleanupId, destroyedAt)
    if (!stamped) {
      failures.push(new Error(`failed to stamp destroyed sandbox ${row.sandboxId} for session ${row.id}`))
    }
  }
  if (failures.length > 0) {
    throw new AggregateError(failures, 'Failed to destroy leaked sandboxes')
  }
}
