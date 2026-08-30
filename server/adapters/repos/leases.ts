import { memoryStoreIdFromRef, normalizeMemoryPath } from '@server/domain/memory-store'
import { runnerHeartbeatStaleBefore } from '@server/domain/runner-queue'
import { newPrimaryKey } from '@server/id'
import type {
  ClaimLeaseInput,
  FinishLeaseInput,
  LeaseChannelConflict,
  LeaseChannelPrepared,
  LeaseListQuery,
  LeaseRecord,
  LeaseRepo,
  ListPageResult,
  WorkItemClaimCandidate,
} from '@server/usecases/ports'
import { RunnerConflictError } from '@server/usecases/ports'
import { and, desc, eq, gt, gte, inArray, isNull, lt, lte, max, or, sql } from 'drizzle-orm'
import type { drizzle } from 'drizzle-orm/d1'
import {
  leases,
  memoryStoreMemories,
  memoryStores,
  runners,
  sessionChannels,
  sessionEvents,
  sessions,
  workItems,
} from '../../db/schema'
import { persistedSessionState } from '../../db/session-state'

type Db = ReturnType<typeof drizzle>
type LeaseRow = typeof leases.$inferSelect
type WorkItemRow = typeof workItems.$inferSelect
type MemoryStoreSnapshot = { memoryRef: string; storeId: string; memories: Array<{ path: string; content: string }> }

const DEFAULT_LEASE_DURATION_SECONDS = 60

function now() {
  return new Date().toISOString()
}

function parseJson<T>(value: string | null) {
  return value ? (JSON.parse(value) as T) : null
}

function stringify(value: unknown) {
  return JSON.stringify(value)
}

function memoryStoreSnapshotsFromResult(result: Record<string, unknown> | undefined): MemoryStoreSnapshot[] {
  if (!result || !Array.isArray(result.memoryStores)) {
    return []
  }
  const snapshots: MemoryStoreSnapshot[] = []
  for (const value of result.memoryStores) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      continue
    }
    const raw = value as Record<string, unknown>
    if (typeof raw.memoryRef !== 'string' || !Array.isArray(raw.memories)) {
      continue
    }
    const storeId = memoryStoreIdFromRef(raw.memoryRef)
    if (!storeId) {
      continue
    }
    const memories = raw.memories
      .filter((memory): memory is Record<string, unknown> =>
        Boolean(memory && typeof memory === 'object' && !Array.isArray(memory)),
      )
      .map((memory) => ({
        path: normalizeMemoryPath(String(memory.path ?? '')),
        content: String(memory.content ?? ''),
      }))
    snapshots.push({ memoryRef: raw.memoryRef, storeId, memories })
  }
  return snapshots
}

async function replaceMemoryStoreSnapshots(
  db: Db,
  projectId: string,
  snapshots: MemoryStoreSnapshot[],
  updatedAt: string,
) {
  for (const snapshot of snapshots) {
    const store = await db
      .select({ id: memoryStores.id })
      .from(memoryStores)
      .where(
        and(
          eq(memoryStores.id, snapshot.storeId),
          eq(memoryStores.projectId, projectId),
          isNull(memoryStores.archivedAt),
        ),
      )
      .get()
    if (!store) {
      continue
    }
    await db.batch([
      db
        .delete(memoryStoreMemories)
        .where(and(eq(memoryStoreMemories.projectId, projectId), eq(memoryStoreMemories.storeId, snapshot.storeId))),
      ...snapshot.memories.map((memory) =>
        db.insert(memoryStoreMemories).values({
          id: newPrimaryKey(),
          projectId,
          storeId: snapshot.storeId,
          path: memory.path,
          content: memory.content,
          metadata: '{}',
          createdAt: updatedAt,
          updatedAt,
        }),
      ),
      db
        .update(memoryStores)
        .set({ updatedAt })
        .where(and(eq(memoryStores.id, snapshot.storeId), eq(memoryStores.projectId, projectId))),
    ])
  }
}

function recordFrom(lease: LeaseRow): LeaseRecord {
  return {
    id: lease.id,
    workItemId: lease.workItemId,
    runnerId: lease.runnerId,
    state: lease.state,
    expiresAt: lease.expiresAt,
    renewedAt: lease.renewedAt,
    resumeToken: lease.resumeToken,
    createdAt: lease.createdAt,
    updatedAt: lease.updatedAt,
  }
}

async function findLeaseRow(db: Db, projectId: string, leaseId: string): Promise<LeaseRow | null> {
  return (
    (await db
      .select()
      .from(leases)
      .where(and(eq(leases.id, leaseId), eq(leases.projectId, projectId)))
      .get()) ?? null
  )
}

async function releaseRunnerLoad(db: Db, projectId: string, runnerId: string, timestamp: string) {
  await db
    .update(runners)
    .set({ currentLoad: sql`max(0, ${runners.currentLoad} - 1)`, updatedAt: timestamp })
    .where(and(eq(runners.id, runnerId), eq(runners.projectId, projectId)))
}

async function hasNewerActiveSessionWork(db: Db, projectId: string, workItem: WorkItemRow) {
  if (!workItem.sessionId) {
    return false
  }
  const newerWork = await db
    .select({ id: workItems.id })
    .from(workItems)
    .where(
      and(
        eq(workItems.projectId, projectId),
        eq(workItems.sessionId, workItem.sessionId),
        inArray(workItems.state, ['available', 'leased']),
        gt(workItems.createdAt, workItem.createdAt),
      ),
    )
    .get()
  return Boolean(newerWork)
}

async function sessionHasRunnerStarted(db: Db, projectId: string, sessionId: string): Promise<boolean> {
  const row = await db
    .select({ sequence: max(sessionEvents.sequence) })
    .from(sessionEvents)
    .where(and(eq(sessionEvents.projectId, projectId), eq(sessionEvents.sessionId, sessionId)))
    .get()
  return typeof row?.sequence === 'number'
}

// The runner reports the freshest runtime resume token on lease renewals and
// interrupts. Persisting it on the work item payload lets a recovery requeue
// (and any later queued resume) continue the runtime conversation instead of
// resuming from the last completed work item. Returns null when there is
// nothing new to write.
function payloadWithResumeToken(workItem: WorkItemRow, resumeToken: string | undefined): string | null {
  if (!resumeToken) {
    return null
  }
  const payload = parseJson<Record<string, unknown>>(workItem.payload)
  if (!payload) {
    return null
  }
  if (payload.resume === true && payload.resumeToken === resumeToken) {
    return null
  }
  return stringify({ ...payload, resume: true, resumeToken })
}

function runtimeFromPayload(workItem: WorkItemRow): string | null {
  const payload = parseJson<Record<string, unknown>>(workItem.payload)
  return typeof payload?.runtime === 'string' && payload.runtime ? payload.runtime : null
}

function resumeTokenFromFinishInput(input: FinishLeaseInput): string | undefined {
  if (input.resumeToken) {
    return input.resumeToken
  }
  const resumeToken = input.result?.resumeToken
  return typeof resumeToken === 'string' && resumeToken ? resumeToken : undefined
}

function runtimeUsesProviderAssignedSessionId(runtime: string): boolean {
  return runtime === 'codex'
}

async function bindSessionResumeToken(
  db: Db,
  input: FinishLeaseInput,
  workItem: WorkItemRow,
  resumeToken: string | undefined,
  timestamp: string,
) {
  if (!workItem.sessionId || !resumeToken) {
    return
  }
  const runtime = runtimeFromPayload(workItem)
  if (!runtime) {
    return
  }
  if (!runtimeUsesProviderAssignedSessionId(runtime)) {
    if (resumeToken !== workItem.sessionId) {
      throw new RunnerConflictError(
        `Runtime ${runtime} must use AMA session ${workItem.sessionId} as its resume token; got ${resumeToken}`,
      )
    }
    return
  }
  const bound = await db
    .update(sessions)
    .set({ resumeToken, updatedAt: timestamp })
    .where(
      and(eq(sessions.id, workItem.sessionId), eq(sessions.projectId, input.projectId), isNull(sessions.resumeToken)),
    )
    .returning({ resumeToken: sessions.resumeToken })
    .get()
  if (bound) {
    return
  }
  const existing = await db
    .select({ resumeToken: sessions.resumeToken })
    .from(sessions)
    .where(and(eq(sessions.id, workItem.sessionId), eq(sessions.projectId, input.projectId)))
    .get()
  if (existing?.resumeToken === resumeToken) {
    return
  }
  if (existing?.resumeToken) {
    throw new RunnerConflictError(
      `AMA session ${workItem.sessionId} is already bound to resume token ${runtime}:${existing.resumeToken}`,
    )
  }
  throw new RunnerConflictError(`Unable to bind AMA session ${workItem.sessionId} to resume token`)
}

// Re-queues a work item whose runner stopped mid-flight so the session can be
// picked up again. For a started self-hosted runtime session the payload is
// rewritten to resume so the agent continues where it left off rather than
// restarting from scratch; once retries are exhausted the work fails terminally.
async function requeueWorkItemForRecovery(
  db: Db,
  projectId: string,
  workItem: WorkItemRow,
  timestamp: string,
): Promise<'requeued' | 'failed' | 'superseded'> {
  if (await hasNewerActiveSessionWork(db, projectId, workItem)) {
    // Newer work for the session is already queued (e.g. a queued session
    // command). Requeueing this item too would hand the same session to two
    // runtimes, so cancel it and let the newer work item drive recovery. The
    // state guard keeps a concurrent completion from being overwritten.
    await db
      .update(workItems)
      .set({
        state: 'cancelled',
        runnerId: null,
        leaseId: null,
        error: stringify({ message: 'Superseded by newer queued work for the session' }),
        updatedAt: timestamp,
      })
      .where(and(eq(workItems.id, workItem.id), eq(workItems.state, 'leased')))
    return 'superseded'
  }
  const shouldRetry = workItem.attempts < workItem.maxAttempts
  if (!shouldRetry) {
    await db
      .update(workItems)
      .set({
        state: 'failed',
        runnerId: null,
        leaseId: null,
        error: stringify({ message: 'Runner stopped and retries are exhausted' }),
        updatedAt: timestamp,
      })
      .where(eq(workItems.id, workItem.id))
    if (workItem.sessionId) {
      await db
        .update(sessions)
        .set({ state: 'error', stateReason: 'runner-lease-expired', updatedAt: timestamp })
        .where(and(eq(sessions.id, workItem.sessionId), eq(sessions.projectId, projectId)))
    }
    return 'failed'
  }

  let payloadJson = workItem.payload
  let runnerStarted = false
  if (workItem.sessionId) {
    const payload = parseJson<Record<string, unknown>>(workItem.payload)
    runnerStarted =
      payload?.resume === true ||
      (typeof payload?.resumeToken === 'string' && payload.resumeToken.length > 0) ||
      (await sessionHasRunnerStarted(db, projectId, workItem.sessionId))
    if (payload?.type === 'session.start' && !payload.resume && runnerStarted) {
      // Resume the runtime in place. claude-code resumes from its own session id
      // (the AMA session id), so a null token still continues the conversation;
      // other runtimes fall back to a fresh start when no token was captured.
      payload.resume = true
      payloadJson = stringify(payload)
    }
  }
  await db
    .update(workItems)
    .set({
      state: 'available',
      runnerId: null,
      leaseId: null,
      payload: payloadJson,
      error: null,
      availableAt: timestamp,
      updatedAt: timestamp,
    })
    .where(eq(workItems.id, workItem.id))
  if (workItem.sessionId) {
    // A runner that never started the session leaves nothing to recover: the
    // session simply goes back to waiting for a runner.
    await db
      .update(sessions)
      .set({
        state: 'pending',
        stateReason: runnerStarted ? 'waiting-for-runner-recovery' : 'waiting-for-runner',
        updatedAt: timestamp,
      })
      .where(and(eq(sessions.id, workItem.sessionId), eq(sessions.projectId, projectId)))
  }
  return 'requeued'
}

// Official-runtime auth/authz failures surface as stable, displayable state
// reasons derived from the canonical runtime.error code the runner streamed —
// never from raw provider error text.
const RUNTIME_AUTH_STATE_REASONS: Record<string, string> = {
  runtime_auth_missing_login: 'runtime-auth-missing-login',
  runtime_auth_unauthorized: 'runtime-auth-unauthorized',
  runtime_auth_product_disabled: 'runtime-auth-product-disabled',
  runtime_auth_expired: 'runtime-auth-expired',
}

async function runtimeFailureStateReason(db: Db, sessionId: string | null): Promise<string | null> {
  if (!sessionId) {
    return null
  }
  const errorEvents = await db
    .select({ payload: sessionEvents.payload })
    .from(sessionEvents)
    .where(and(eq(sessionEvents.sessionId, sessionId), eq(sessionEvents.type, 'runtime.error')))
    .orderBy(desc(sessionEvents.sequence))
    .limit(20)
    .all()
  for (const row of errorEvents) {
    const payload = parseJson<Record<string, unknown>>(row.payload)
    const code = typeof payload?.code === 'string' ? payload.code : null
    const reason = code ? RUNTIME_AUTH_STATE_REASONS[code] : undefined
    if (reason) {
      return reason
    }
  }
  return null
}

async function findWorkItemRow(db: Db, projectId: string, workItemId: string): Promise<WorkItemRow | null> {
  return (
    (await db
      .select()
      .from(workItems)
      .where(and(eq(workItems.id, workItemId), eq(workItems.projectId, projectId)))
      .get()) ?? null
  )
}

export function createLeaseRepo(db: Db): LeaseRepo {
  return {
    async list(query: LeaseListQuery): Promise<ListPageResult<LeaseRecord>> {
      const filters = [
        eq(leases.projectId, query.projectId),
        query.runnerId ? eq(leases.runnerId, query.runnerId) : undefined,
        query.state ? eq(leases.state, query.state as LeaseRow['state']) : undefined,
        query.cursor
          ? or(
              lt(leases.createdAt, query.cursor.createdAt),
              and(eq(leases.createdAt, query.cursor.createdAt), lt(leases.id, query.cursor.id)),
            )
          : undefined,
      ].filter((filter) => filter !== undefined)
      const rows = await db
        .select()
        .from(leases)
        .where(and(...filters))
        .orderBy(desc(leases.createdAt), desc(leases.id))
        .limit(query.limit + 1)
      const hasMore = rows.length > query.limit
      return { rows: rows.slice(0, query.limit).map(recordFrom), hasMore }
    },

    async find(projectId, leaseId) {
      const row = await findLeaseRow(db, projectId, leaseId)
      return row ? recordFrom(row) : null
    },

    async claimCandidate(projectId, workItemId): Promise<WorkItemClaimCandidate | null> {
      const row = await findWorkItemRow(db, projectId, workItemId)
      if (!row) {
        return null
      }
      return {
        state: row.state,
        availableAt: row.availableAt,
        environmentId: row.environmentId,
        sessionId: row.sessionId,
        rawPayload: JSON.parse(row.payload) as Record<string, unknown>,
      }
    },

    async expireStale(projectId) {
      const timestamp = now()
      const staleLeases = await db
        .select()
        .from(leases)
        .where(and(eq(leases.projectId, projectId), eq(leases.state, 'active'), lt(leases.expiresAt, timestamp)))
        .limit(100)
      for (const lease of staleLeases) {
        const workItem = await findWorkItemRow(db, projectId, lease.workItemId)
        const expired = await db
          .update(leases)
          .set({ state: 'expired', updatedAt: timestamp })
          .where(and(eq(leases.id, lease.id), eq(leases.state, 'active')))
          .returning({ id: leases.id })
          .get()
        if (!expired) {
          continue
        }
        await releaseRunnerLoad(db, projectId, lease.runnerId, timestamp)
        if (workItem?.state === 'leased' && workItem.leaseId === lease.id) {
          await requeueWorkItemForRecovery(db, projectId, workItem, timestamp)
        }
      }
    },

    async claim(input: ClaimLeaseInput, timestamp) {
      const reserved = await db
        .update(runners)
        .set({ currentLoad: sql`${runners.currentLoad} + 1`, updatedAt: timestamp })
        .where(
          and(
            eq(runners.id, input.runnerId),
            eq(runners.projectId, input.projectId),
            eq(runners.state, 'active'),
            gte(runners.lastHeartbeatAt, runnerHeartbeatStaleBefore()),
            lt(runners.currentLoad, runners.maxConcurrent),
          ),
        )
        .returning({ id: runners.id })
        .get()
      if (!reserved) {
        return 'at_capacity'
      }
      const lease = {
        id: newPrimaryKey(),
        workItemId: input.workItemId,
        runnerId: input.runnerId,
        organizationId: input.organizationId,
        projectId: input.projectId,
        state: 'active',
        expiresAt: new Date(Date.now() + input.leaseDurationSeconds * 1000).toISOString(),
        renewedAt: null,
        resumeToken: null,
        createdAt: timestamp,
        updatedAt: timestamp,
      } satisfies typeof leases.$inferInsert
      const claimed = await db
        .update(workItems)
        .set({
          state: 'leased',
          runnerId: input.runnerId,
          leaseId: lease.id,
          attempts: sql`${workItems.attempts} + 1`,
          updatedAt: timestamp,
        })
        .where(
          and(
            eq(workItems.id, input.workItemId),
            eq(workItems.projectId, input.projectId),
            eq(workItems.state, 'available'),
            lte(workItems.availableAt, timestamp),
          ),
        )
        .returning({ id: workItems.id, sessionId: workItems.sessionId })
        .get()
      if (!claimed) {
        await releaseRunnerLoad(db, input.projectId, input.runnerId, timestamp)
        return 'work_item_lost'
      }
      await db.insert(leases).values(lease)
      if (claimed.sessionId) {
        await db
          .update(sessions)
          .set({ state: 'running', stateReason: null, startedAt: timestamp, updatedAt: timestamp })
          .where(
            and(
              eq(sessions.id, claimed.sessionId),
              eq(sessions.projectId, input.projectId),
              eq(sessions.state, 'pending'),
              or(
                eq(sessions.stateReason, 'waiting-for-runner'),
                eq(sessions.stateReason, 'waiting-for-runner-recovery'),
              ),
            ),
          )
      }
      return { lease: recordFrom(lease as LeaseRow), sessionId: claimed.sessionId }
    },

    async failClaim(input) {
      const failedAt = now()
      await db.update(leases).set({ state: 'failed', updatedAt: failedAt }).where(eq(leases.id, input.leaseId))
      await db
        .update(workItems)
        .set({
          state: 'failed',
          runnerId: null,
          leaseId: null,
          error: stringify({ message: input.reason }),
          updatedAt: failedAt,
        })
        .where(eq(workItems.id, input.workItemId))
      if (input.sessionId) {
        await db
          .update(sessions)
          .set({ state: 'error', stateReason: input.reason, updatedAt: failedAt })
          .where(and(eq(sessions.id, input.sessionId), eq(sessions.projectId, input.projectId)))
      }
      await releaseRunnerLoad(db, input.projectId, input.runnerId, failedAt)
    },

    async finish(input: FinishLeaseInput, timestamp) {
      const lease = await findLeaseRow(db, input.projectId, input.leaseId)
      if (!lease) {
        return null
      }
      const workItem = await findWorkItemRow(db, input.projectId, lease.workItemId)
      if (!workItem) {
        return null
      }
      if (
        lease.state !== 'active' ||
        lease.expiresAt <= now() ||
        workItem.state !== 'leased' ||
        workItem.leaseId !== lease.id ||
        workItem.runnerId !== lease.runnerId
      ) {
        return null
      }
      const resumeToken = resumeTokenFromFinishInput(input)
      await bindSessionResumeToken(db, input, workItem, resumeToken, timestamp)
      if (input.state === 'active') {
        const expiresAt =
          input.expiresAt ??
          new Date(Date.now() + (input.leaseDurationSeconds ?? DEFAULT_LEASE_DURATION_SECONDS) * 1000).toISOString()
        const renewedPayload = payloadWithResumeToken(workItem, input.resumeToken)
        const renewedWorkItem = await db
          .update(workItems)
          .set({
            updatedAt: timestamp,
            ...(renewedPayload !== null ? { payload: renewedPayload } : {}),
          })
          .where(
            and(
              eq(workItems.id, workItem.id),
              eq(workItems.state, 'leased'),
              eq(workItems.leaseId, lease.id),
              eq(workItems.runnerId, lease.runnerId),
            ),
          )
          .returning({ id: workItems.id })
          .get()
        if (!renewedWorkItem) {
          return null
        }
        await db
          .update(leases)
          .set({
            expiresAt,
            renewedAt: timestamp,
            updatedAt: timestamp,
            ...(resumeToken ? { resumeToken } : {}),
          })
          .where(and(eq(leases.id, input.leaseId), eq(leases.state, 'active')))
      } else if (input.state === 'interrupted') {
        // The runner stopped mid-flight (e.g. graceful shutdown). End the lease but
        // keep the work recoverable so a restarted runner resumes the session.
        const released = await db
          .update(leases)
          .set({
            state: 'expired',
            updatedAt: timestamp,
            ...(resumeToken ? { resumeToken } : {}),
          })
          .where(and(eq(leases.id, input.leaseId), eq(leases.state, 'active')))
          .returning({ id: leases.id })
          .get()
        if (!released) {
          return null
        }
        await releaseRunnerLoad(db, input.projectId, lease.runnerId, timestamp)
        const interruptedPayload = payloadWithResumeToken(workItem, input.resumeToken)
        await requeueWorkItemForRecovery(
          db,
          input.projectId,
          interruptedPayload !== null ? { ...workItem, payload: interruptedPayload } : workItem,
          timestamp,
        )
      } else {
        // Completion: the lease ends and its outcome lands on the work item —
        // the leases table carries no result/error columns.
        if (input.state === 'completed') {
          await replaceMemoryStoreSnapshots(
            db,
            input.projectId,
            memoryStoreSnapshotsFromResult(input.result),
            timestamp,
          )
        }
        const result = input.result ? stringify(input.result) : null
        const error = input.error ? stringify(input.error) : null
        const completedWorkItem = await db
          .update(workItems)
          .set({
            state: input.state === 'completed' ? 'succeeded' : input.state,
            result,
            error,
            updatedAt: timestamp,
          })
          .where(
            and(
              eq(workItems.id, workItem.id),
              eq(workItems.state, 'leased'),
              eq(workItems.leaseId, lease.id),
              eq(workItems.runnerId, lease.runnerId),
            ),
          )
          .returning({ id: workItems.id })
          .get()
        if (!completedWorkItem) {
          return null
        }
        await db
          .update(leases)
          .set({
            state: input.state,
            updatedAt: timestamp,
            ...(resumeToken ? { resumeToken } : {}),
          })
          .where(and(eq(leases.id, input.leaseId), eq(leases.state, 'active')))
        await releaseRunnerLoad(db, input.projectId, lease.runnerId, timestamp)
        if (workItem.sessionId && !(await hasNewerActiveSessionWork(db, input.projectId, workItem))) {
          const activeChannel = await db
            .select({ id: sessionChannels.id })
            .from(sessionChannels)
            .where(
              and(
                eq(sessionChannels.projectId, input.projectId),
                eq(sessionChannels.sessionId, workItem.sessionId),
                eq(sessionChannels.leaseId, lease.id),
                eq(sessionChannels.state, 'active'),
              ),
            )
            .get()
          const failureReason =
            input.state === 'failed' ? await runtimeFailureStateReason(db, workItem.sessionId) : null
          const sessionUpdate = (
            input.state === 'cancelled'
              ? {
                  state: persistedSessionState('closed'),
                  stateReason: 'runner-cancelled',
                  closedAt: timestamp,
                  updatedAt: timestamp,
                }
              : {
                  state: input.state === 'completed' ? 'idle' : 'error',
                  stateReason: input.state === 'completed' ? null : (failureReason ?? 'runner-failed'),
                  updatedAt: timestamp,
                }
          ) satisfies Partial<typeof sessions.$inferInsert>
          const pendingWithoutAcceptedChannel = and(
            eq(sessions.state, 'pending'),
            or(eq(sessions.stateReason, 'waiting-for-runner'), eq(sessions.stateReason, 'waiting-for-runner-recovery')),
          )
          const pendingRecoveryForAcceptedChannel = and(
            eq(sessions.state, 'pending'),
            eq(sessions.stateReason, 'waiting-for-runner-recovery'),
          )
          await db
            .update(sessions)
            .set(sessionUpdate)
            .where(
              and(
                eq(sessions.id, workItem.sessionId),
                eq(sessions.projectId, input.projectId),
                activeChannel
                  ? or(eq(sessions.state, 'running'), pendingRecoveryForAcceptedChannel)
                  : or(eq(sessions.state, 'running'), pendingWithoutAcceptedChannel),
              ),
            )
        }
      }
      return this.find(input.projectId, input.leaseId)
    },

    async prepareSessionChannel(scope, leaseId, timestamp): Promise<LeaseChannelPrepared | LeaseChannelConflict> {
      await this.expireStale(scope.projectId)
      const lease = await findLeaseRow(db, scope.projectId, leaseId)
      const workItem = lease ? await activeLeaseWorkItem(db, scope.projectId, lease) : null
      if (!workItem) {
        return { ok: false, status: 409, message: 'Runner lease no longer owns a self-hosted session' }
      }
      if (!workItem.sessionId) {
        return { ok: false, status: 409, message: 'Runner work item is not attached to a session' }
      }
      const runnerId = workItem.runnerId
      if (!runnerId) {
        return { ok: false, status: 409, message: 'Runner work item is not attached to a session' }
      }
      const waitingSession = await db
        .select({ id: sessions.id, state: sessions.state, stateReason: sessions.stateReason })
        .from(sessions)
        .where(and(eq(sessions.id, workItem.sessionId), eq(sessions.projectId, scope.projectId)))
        .get()
      if (
        !(
          (waitingSession?.state === 'pending' &&
            (waitingSession.stateReason === 'waiting-for-runner' ||
              waitingSession.stateReason === 'waiting-for-runner-recovery')) ||
          (waitingSession?.state === 'running' && waitingSession.stateReason === null)
        )
      ) {
        return { ok: false, status: 409, message: 'Session is not waiting for a runner channel' }
      }
      await db
        .update(sessionChannels)
        .set({ state: 'stale', closedAt: timestamp, closeReason: 'superseded', updatedAt: timestamp })
        .where(
          and(
            eq(sessionChannels.projectId, scope.projectId),
            eq(sessionChannels.state, 'active'),
            or(eq(sessionChannels.sessionId, workItem.sessionId), eq(sessionChannels.leaseId, leaseId)),
          ),
        )
      const channel = {
        id: newPrimaryKey(),
        sessionId: workItem.sessionId,
        workItemId: workItem.id,
        leaseId,
        runnerId,
        organizationId: scope.organizationId,
        projectId: scope.projectId,
        state: 'active',
        acceptedAt: timestamp,
        lastSeenAt: timestamp,
        closedAt: null,
        closeReason: null,
        createdAt: timestamp,
        updatedAt: timestamp,
      }
      const acceptedSession = await db
        .update(sessions)
        .set({
          state: 'running',
          stateReason: null,
          runtimeEndpointPath: null,
          startedAt: timestamp,
          updatedAt: timestamp,
        })
        .where(
          and(
            eq(sessions.id, workItem.sessionId),
            eq(sessions.projectId, scope.projectId),
            or(
              and(
                eq(sessions.state, 'pending'),
                or(
                  eq(sessions.stateReason, 'waiting-for-runner'),
                  eq(sessions.stateReason, 'waiting-for-runner-recovery'),
                ),
              ),
              and(eq(sessions.state, 'running'), isNull(sessions.stateReason)),
            ),
          ),
        )
        .returning({ id: sessions.id })
        .get()
      if (!acceptedSession) {
        return { ok: false, status: 409, message: 'Session is not waiting for a runner channel' }
      }
      await db.insert(sessionChannels).values(channel)
      return { ok: true, channelId: channel.id, sessionId: workItem.sessionId, workItemId: workItem.id, runnerId }
    },

    async rollbackSessionChannel(projectId, channelId, sessionId, timestamp) {
      await db
        .update(sessionChannels)
        .set({ state: 'closed', closedAt: timestamp, closeReason: 'channel-upgrade-failed', updatedAt: timestamp })
        .where(eq(sessionChannels.id, channelId))
      await db
        .update(sessions)
        .set({ state: 'pending', stateReason: 'waiting-for-runner-recovery', updatedAt: timestamp })
        .where(and(eq(sessions.id, sessionId), eq(sessions.projectId, projectId), eq(sessions.state, 'running')))
    },
  }
}

// The work item a still-active lease currently owns, or null when the lease is
// no longer the live owner.
async function activeLeaseWorkItem(db: Db, projectId: string, lease: LeaseRow): Promise<WorkItemRow | null> {
  if (lease.state !== 'active' || lease.expiresAt <= now()) {
    return null
  }
  const workItem = await findWorkItemRow(db, projectId, lease.workItemId)
  if (workItem?.state !== 'leased' || workItem.leaseId !== lease.id || workItem.runnerId !== lease.runnerId) {
    return null
  }
  return workItem
}
