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
  await destroyLeakedSandboxes(deps)
}

export async function markIdleTimedOutSessions(deps: Pick<WatchdogDeps, 'sessionOrchestration'>): Promise<void> {
  await deps.sessionOrchestration.markIdleTimedOutSessions(new Date().toISOString())
}

// Sandboxes of ended sessions occupy container instances (max_instances is a
// hard cap) when teardown was skipped — e.g. a close while an exec was hung.
// Destroy them and stamp the session so each sandbox is cleaned exactly once.
async function destroyLeakedSandboxes(deps: WatchdogDeps): Promise<void> {
  // archived is lifecycle (archivedAt), not a state value
  const rows = await deps.sessionOrchestration.leakedSandboxSessions(ENDED_RUNTIME_STATES, 20)
  const failures: Error[] = []
  for (const row of rows) {
    if (!row.sandboxId) continue
    try {
      await deps.cloudRuntime.stopCloudSession(row.sandboxId)
    } catch (error) {
      failures.push(
        new Error(`failed to destroy leaked sandbox ${row.sandboxId} for session ${row.id}`, { cause: error }),
      )
    }
    const metadata = parseMetadata(row.metadata)
    metadata.sandboxDestroyedAt = new Date().toISOString()
    await deps.sessionOrchestration.stampSandboxDestroyed(row.id, JSON.stringify(metadata))
  }
  if (failures.length > 0) {
    throw new AggregateError(failures, 'Failed to destroy leaked sandboxes')
  }
}

function parseMetadata(raw: string | null): Record<string, unknown> {
  if (!raw) return {}
  try {
    const parsed: unknown = JSON.parse(raw)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}
