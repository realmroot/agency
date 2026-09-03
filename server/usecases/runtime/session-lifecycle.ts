// Session close / reopen / delete / expiry lifecycle — deps-first.
//
// This cluster owns runtime teardown: closing cloud sessions (tearing down the
// sandbox runtime) and self-hosted sessions (cancelling work items, leases, and
// runner load), reopening sessions, soft deletion, and expiring pending
// cloud sessions whose startup window elapsed.
//
// Deps-first: the store, audit, cloud runtime lifecycle, runtime workspace
// reader, and runner channel arrive as ports on `deps`; runtime events go
// through the events usecase. The module is infra-free.

import { memoryStoreIdFromRef } from '@server/domain/memory-store'
import {
  type EnvFromEntry,
  isMemoryVolume,
  type MemoryVolume,
  type Volume,
  type VolumeMount,
  volumeMountReadOnly,
} from '@server/domain/runtime/execution-inputs'
import {
  type createEnvironmentSnapshot,
  normalizeEnvironmentSnapshot,
  parseAgentSnapshot,
  parseJson,
} from '@server/domain/runtime/session-snapshot'
import { LIFECYCLE_LEASE_TTL_MS, lifecycleLeaseExpiry, newTurnId } from '@server/domain/runtime/turn'
import { now, requestIdFrom, stringify } from '@server/domain/runtime/util'
import { sessionRuntimeConfig, sessionRuntimeFromMetadata } from '@server/domain/runtime-session'
import { safeRuntimeError } from '@server/runtime-error'
import type { AuthScope, RunnerChannel, RuntimeWorkspaceReader, SessionRow } from '../ports'
import { type CloudTurnDeps, startSessionRuntimeForRow } from './cloud-turn'

type LifecycleDeps = CloudTurnDeps & {
  runtimeWorkspace: RuntimeWorkspaceReader
  runnerChannel: RunnerChannel
}

type SessionRuntimeError = {
  status: 400 | 403 | 404 | 409 | 500
  code: string
  message: string
  fields?: Record<string, string>
  detail?: Record<string, unknown>
}

export type CloseSessionResult = { ok: true; session: SessionRow } | { ok: false; error: SessionRuntimeError }

export async function closeSession(
  deps: LifecycleDeps,
  auth: AuthScope,
  sessionId: string,
  requestId: string | null,
  reason = 'user_requested',
): Promise<CloseSessionResult> {
  const session = await deps.sessionOrchestration.findSession(auth.project.id, sessionId)
  if (!session) {
    return { ok: false, error: { status: 404, code: 'not_found', message: 'Session not found' } }
  }
  return await closeSessionRow(deps, auth, session, requestId, reason)
}

async function closeSessionRow(
  deps: LifecycleDeps,
  auth: AuthScope,
  session: SessionRow,
  requestId: string | null,
  reason = 'user_requested',
): Promise<CloseSessionResult> {
  if (session.state === 'closed') {
    return session.closedAt
      ? { ok: true, session }
      : {
          ok: false,
          error: { status: 409, code: 'conflict', message: 'Session runtime cleanup is still in progress' },
        }
  }
  if (sessionSandboxBackend(session) === 'runner-sandbox' || !session.sandboxId) {
    return await closeSelfHostedSession(deps, auth, session, requestId, reason)
  }

  const store = deps.sessionOrchestration
  const closingAt = now()
  const cleanupId = newTurnId()
  const claimed = await store.claimSessionClose(
    auth.project.id,
    session.id,
    session.sandboxId,
    cleanupId,
    lifecycleLeaseExpiry(closingAt),
    closingAt,
  )
  if (!claimed) {
    return {
      ok: false,
      error: {
        status: 409,
        code: 'conflict',
        message: 'Session has an active turn or is no longer available to close',
      },
    }
  }

  try {
    await syncWritableMemoryStores(deps, auth, session)
    await deps.cloudRuntime.stopCloudSession(session.sandboxId)
  } catch (error) {
    const safeError = safeRuntimeError(error)
    const failedAt = now()
    await store.failSessionClose(auth.project.id, session.id, session.sandboxId, cleanupId, safeError.message, failedAt)
    await deps.audit.record(auth, {
      action: 'session.close',
      resourceType: 'session',
      resourceId: session.id,
      outcome: 'failure',
      requestId: requestIdFrom(requestId),
      sessionId: session.id,
      metadata: { runtime: safeError },
    })
    return {
      ok: false,
      error: {
        status: 409,
        code: 'conflict',
        message: 'Session runtime could not be closed',
        detail: { runtime: safeError },
      },
    }
  }

  const closedAt = now()
  const finalized = await store.completeSessionClose(
    auth.project.id,
    session.id,
    session.sandboxId,
    cleanupId,
    closedAt,
  )
  if (!finalized) throw new Error('Claimed Session close could not be finalized')
  await deps.audit.record(auth, {
    action: 'session.close',
    resourceType: 'session',
    resourceId: session.id,
    outcome: 'success',
    requestId: requestIdFrom(requestId),
    sessionId: session.id,
    metadata: { reason, sandboxId: session.sandboxId, resumeToken: session.resumeToken },
  })
  await archiveTerminalSession(deps, auth, session.id)
  const closed = await store.findSession(auth.project.id, session.id)
  if (!closed) {
    throw new Error('Closed session row is required')
  }
  return { ok: true, session: closed }
}

async function syncWritableMemoryStores(deps: LifecycleDeps, auth: AuthScope, session: SessionRow) {
  if (!session.sandboxId) {
    return
  }
  const volumes = JSON.parse(session.volumes) as Volume[]
  const volumeMounts = JSON.parse(session.volumeMounts) as VolumeMount[]
  const writableVolumes = volumes.filter(
    (volume): volume is MemoryVolume => isMemoryVolume(volume) && !volumeMountReadOnly(volume.name, volumeMounts),
  )
  if (writableVolumes.length === 0) {
    return
  }
  const snapshots = await deps.runtimeWorkspace.readMemoryStoreMemories({
    sessionId: session.id,
    sandboxId: session.sandboxId,
    volumes: writableVolumes,
    volumeMounts,
  })
  const updatedAt = now()
  for (const snapshot of snapshots) {
    const storeId = memoryStoreIdFromRef(snapshot.memoryRef)
    if (!storeId) {
      continue
    }
    await deps.sessionOrchestration.replaceMemoryStoreMemories(auth.project.id, storeId, snapshot.memories, updatedAt)
  }
}

function sessionSandboxBackend(session: SessionRow): string | null {
  const metadata = session.metadata ? (JSON.parse(session.metadata) as Record<string, unknown>) : {}
  return typeof metadata.sandboxBackend === 'string' ? metadata.sandboxBackend : null
}

// On close, snapshot a cloud (enbor) session's Session DO event log to its
// R2 archive object. Best-effort: the DO keeps the hot rows, so a transient R2
// failure must not strand the close. No-op for D1-backed sessions (the router
// only archives DO-stored ones).
async function archiveTerminalSession(deps: LifecycleDeps, auth: AuthScope, sessionId: string) {
  try {
    await deps.sessionEventStore.archive({
      organizationId: auth.organization.id,
      projectId: auth.project.id,
      sessionId,
    })
  } catch {
    // Best-effort archive: the hot Session DO event stream remains readable.
  }
}

async function closeSelfHostedSession(
  deps: LifecycleDeps,
  auth: AuthScope,
  session: SessionRow,
  requestId: string | null,
  reason: string,
): Promise<CloseSessionResult> {
  const store = deps.sessionOrchestration
  const closedAt = now()
  const claimed = await store.updateSessionWhenState(auth.project.id, session.id, session.state, {
    state: 'closed',
    stateReason: 'closing',
    closedAt: null,
    updatedAt: closedAt,
  })
  if (!claimed) {
    return {
      ok: false,
      error: {
        status: 409,
        code: 'conflict',
        message: 'Session changed while close was being claimed',
      },
    }
  }
  if (sessionSandboxBackend(session) === 'runner-sandbox') {
    await deps.runnerChannel.stopSandbox(session.id).catch(() => undefined)
  } else {
    await deps.runnerChannel.dispatch(session.id, { type: 'abort', reason })
  }
  const activeWorkItems = await store.activeSessionWorkItems(auth.project.id, session.id)

  if (activeWorkItems.length) {
    const workItemIds = activeWorkItems.map((item) => item.id)
    const leaseIds = activeWorkItems.map((item) => item.leaseId).filter((id): id is string => Boolean(id))
    const runnerIds = [
      ...new Set(activeWorkItems.map((item) => item.runnerId).filter((id): id is string => Boolean(id))),
    ]

    await store.cancelWorkItems(
      auth.project.id,
      workItemIds,
      stringify({ message: `Session closed: ${reason}` }),
      closedAt,
    )

    if (leaseIds.length) {
      await store.cancelLeases(auth.project.id, leaseIds, closedAt)
    }

    for (const runnerId of runnerIds) {
      await store.decrementRunnerLoad(auth.project.id, runnerId, closedAt)
    }
  }

  await store.updateSession(auth.project.id, session.id, {
    state: 'closed',
    stateReason: 'runner-cancelled',
    closedAt,
    updatedAt: closedAt,
  })

  await deps.audit.record(auth, {
    action: 'session.close',
    resourceType: 'session',
    resourceId: session.id,
    outcome: 'success',
    requestId: requestIdFrom(requestId),
    sessionId: session.id,
    metadata: { reason, hostingMode: 'self_hosted', cancelledWorkItems: activeWorkItems.length },
  })
  await archiveTerminalSession(deps, auth, session.id)

  const closed = await store.findSession(auth.project.id, session.id)
  if (!closed) {
    throw new Error('Closed self-hosted session row is required')
  }
  return { ok: true, session: closed }
}

export async function reopenSession(
  deps: LifecycleDeps,
  auth: AuthScope,
  sessionId: string,
  requestId: string | null,
): Promise<CloseSessionResult> {
  const store = deps.sessionOrchestration
  const session = await store.findSession(auth.project.id, sessionId)
  if (!session) {
    return { ok: false, error: { status: 404, code: 'not_found', message: 'Session not found' } }
  }
  if (session.state === 'idle' || session.state === 'pending' || session.state === 'running') {
    return { ok: true, session }
  }
  if (session.state !== 'closed') {
    return { ok: false, error: { status: 409, code: 'conflict', message: 'Only closed sessions can be reopened' } }
  }
  const reopenedAt = now()
  if (sessionSandboxBackend(session) === 'runner-sandbox' || !session.sandboxId) {
    await store.updateSession(auth.project.id, session.id, {
      state: 'idle',
      stateReason: null,
      startedAt: reopenedAt,
      closedAt: null,
      updatedAt: reopenedAt,
    })
  } else {
    const metadata = parseJson<Record<string, unknown>>(session.metadata) ?? {}
    if (!session.closedAt || typeof metadata.sandboxDestroyedAt !== 'string') {
      return {
        ok: false,
        error: { status: 409, code: 'conflict', message: 'Session runtime cleanup is not complete' },
      }
    }
    const { sandboxDestroyedAt: _destroyedAt, ...reopenedMetadata } = metadata
    const agentSnapshot = parseAgentSnapshot(session.agentSnapshot)
    if (!agentSnapshot) {
      return {
        ok: false,
        error: { status: 409, code: 'conflict', message: 'Session agent snapshot is required' },
      }
    }
    const pending = await store.claimSessionReopen(auth.project.id, session.id, session.sandboxId, reopenedAt)
    if (!pending) {
      return {
        ok: false,
        error: { status: 409, code: 'conflict', message: 'Session runtime is no longer closed' },
      }
    }
    await startSessionRuntimeForRow(deps, auth, {
      pending: {
        ...session,
        state: 'pending',
        stateReason: null,
        startedAt: reopenedAt,
        closedAt: null,
        metadata: JSON.stringify(reopenedMetadata),
        updatedAt: reopenedAt,
      },
      agentSnapshot,
      environmentSnapshot: normalizeEnvironmentSnapshot(
        parseJson<ReturnType<typeof createEnvironmentSnapshot>>(session.environmentSnapshot),
      ),
      runtime: sessionRuntimeFromMetadata(metadata),
      runtimeConfig: sessionRuntimeConfig(metadata),
      env: parseJson<Record<string, string>>(session.env) ?? {},
      envFrom: parseJson<EnvFromEntry[]>(session.envFrom) ?? [],
      volumes: parseJson<Volume[]>(session.volumes) ?? [],
      volumeMounts: parseJson<VolumeMount[]>(session.volumeMounts) ?? [],
      requestId: requestIdFrom(requestId),
    })
  }
  await deps.audit.record(auth, {
    action: 'session.reopen',
    resourceType: 'session',
    resourceId: session.id,
    outcome: 'success',
    requestId: requestIdFrom(requestId),
    sessionId: session.id,
    metadata: {},
  })
  const reopened = await store.findSession(auth.project.id, session.id)
  if (!reopened) {
    throw new Error('Reopened session row is required')
  }
  return { ok: true, session: reopened }
}

export async function deleteSession(
  deps: LifecycleDeps,
  auth: AuthScope,
  sessionId: string,
  requestId: string | null,
): Promise<CloseSessionResult> {
  const store = deps.sessionOrchestration
  const session = await store.findSession(auth.project.id, sessionId)
  if (!session) {
    return { ok: false, error: { status: 404, code: 'not_found', message: 'Session not found' } }
  }
  if ((session.sandboxId || sessionSandboxBackend(session) === 'runner-sandbox') && session.state !== 'closed') {
    const closed = await closeSessionRow(deps, auth, session, requestId)
    if (!closed.ok) {
      return closed
    }
  }

  const deletedAt = now()
  await store.updateSession(auth.project.id, session.id, {
    deletedAt,
    updatedAt: deletedAt,
  })
  await deps.audit.record(auth, {
    action: 'session.delete',
    resourceType: 'session',
    resourceId: session.id,
    outcome: 'success',
    requestId: requestIdFrom(requestId),
    sessionId: session.id,
    metadata: { deletedAt },
  })
  return { ok: true, session: { ...session, deletedAt, updatedAt: deletedAt } }
}

// Mark pending sessions whose cloud runtime startup window elapsed as errored.
export async function markExpiredPendingSessions(deps: Pick<LifecycleDeps, 'sessionOrchestration'>, auth: AuthScope) {
  const sweptAt = now()
  const expiredBefore = new Date(Date.parse(sweptAt) - LIFECYCLE_LEASE_TTL_MS).toISOString()
  await deps.sessionOrchestration.markExpiredPendingSessions(auth.project.id, expiredBefore, sweptAt)
}
