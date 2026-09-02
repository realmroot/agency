// Stalled-session + leaked-sandbox watchdog — deps-first.
//
// A queue-consumer invocation owns at most ~15 minutes of wall clock; a cloud
// session still "running" (turn) or "pending" (startup) past this window lost
// its consumer and would otherwise stay stuck forever. Marking it as error lets
// clients and reconciliation sweeps recover the work.
//
// Deps-first: the store and cloud runtime lifecycle arrive as ports on `deps`;
// the module is infra-free.

import type { CloudRuntimeLifecycle, SessionOrchestrationStore } from '../ports'

const STALLED_THRESHOLD_MS = 20 * 60_000
const MAINTENANCE_BATCH_SIZE = 20

const ENDED_RUNTIME_STATES = ['closed', 'error']

type WatchdogDeps = {
  sessionOrchestration: SessionOrchestrationStore
  cloudRuntime: CloudRuntimeLifecycle
}

export async function markStalledCloudSessions(deps: WatchdogDeps): Promise<void> {
  const timestamp = new Date().toISOString()
  const threshold = new Date(Date.parse(timestamp) - STALLED_THRESHOLD_MS).toISOString()
  // a cloud turn lost its consumer mid-run, or a cloud startup died before
  // assigning a sandbox; self-hosted sessions waiting for a runner carry a
  // stateReason and may wait indefinitely, so they are excluded
  const stalled = await deps.sessionOrchestration.markStalledCloudSessions(threshold, timestamp, MAINTENANCE_BATCH_SIZE)
  await destroySandboxes(deps, stalled)
  await destroyLeakedSandboxes(deps)
}

export async function markIdleTimedOutSessions(deps: Pick<WatchdogDeps, 'sessionOrchestration'>): Promise<void> {
  await deps.sessionOrchestration.markIdleTimedOutSessions(new Date().toISOString(), MAINTENANCE_BATCH_SIZE)
}

export async function maintainCloudSessionLifecycle(deps: WatchdogDeps): Promise<void> {
  const timedOut = await deps.sessionOrchestration.markIdleTimedOutSessions(
    new Date().toISOString(),
    MAINTENANCE_BATCH_SIZE,
  )
  await destroySandboxes(deps, timedOut)
  await markStalledCloudSessions(deps)
}

// Sandboxes of ended sessions occupy container instances (max_instances is a
// hard cap) when teardown was skipped — e.g. a close while an exec was hung.
// Destroy them and stamp the session so each sandbox is cleaned exactly once.
async function destroyLeakedSandboxes(deps: WatchdogDeps): Promise<void> {
  // archived is lifecycle (archivedAt), not a state value
  const rows = await deps.sessionOrchestration.leakedSandboxSessions(ENDED_RUNTIME_STATES, MAINTENANCE_BATCH_SIZE)
  await destroySandboxes(deps, rows)
}

async function destroySandboxes(
  deps: WatchdogDeps,
  rows: { id: string; sandboxId: string | null; metadata: string | null }[],
): Promise<void> {
  const failures: Error[] = []
  for (const row of rows) {
    if (!row.sandboxId) continue
    try {
      await deps.cloudRuntime.stopCloudSession(row.sandboxId)
    } catch (error) {
      failures.push(
        new Error(`failed to destroy cloud sandbox ${row.sandboxId} for session ${row.id}`, { cause: error }),
      )
      continue
    }
    await deps.sessionOrchestration.stampSandboxDestroyed(row.id, row.sandboxId, new Date().toISOString())
  }
  if (failures.length > 0) {
    throw new AggregateError(failures, 'Failed to destroy cloud sandboxes')
  }
}
