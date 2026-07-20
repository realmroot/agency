import { RuntimeSchema } from '@server/contracts/environment-contracts'
import type { ResourceMetadata } from '@server/domain/resource'
import type { Trigger, TriggerSessionTemplate } from '@server/domain/trigger'
import { AMA_ANNOTATION_KEY_ROUTING_KEY_HASH } from '@server/metadata-keys'
import type {
  ClaimedRun,
  DueTrigger,
  PendingHttpRun,
  StalePendingHttpRun,
  TriggerDispatchRepo,
} from '@server/usecases/ports'
import { and, asc, desc, eq, inArray, isNull, lte, sql } from 'drizzle-orm'
import type { drizzle } from 'drizzle-orm/d1'
import { httpTriggerPendingRuns, projects, sessions, triggerRuns, triggers } from '../../db/schema'

type Db = ReturnType<typeof drizzle>
type TriggerRow = typeof triggers.$inferSelect

function newId(prefix: string) {
  return `${prefix}_${crypto.randomUUID().replaceAll('-', '')}`
}

function parseJson<T>(value: string | null, fallback: T) {
  return value ? (JSON.parse(value) as T) : fallback
}

function uniqueConstraintError(error: unknown): boolean {
  if (String(error).toUpperCase().includes('UNIQUE')) {
    return true
  }
  if (error && typeof error === 'object' && 'cause' in error) {
    return uniqueConstraintError((error as { cause?: unknown }).cause)
  }
  return false
}

function dueTriggerFrom(row: TriggerRow): DueTrigger {
  if (row.nextDueAt === null || row.intervalSeconds === null) {
    throw new Error('Scheduled trigger is missing schedule timing')
  }
  return {
    id: row.id,
    organizationId: row.organizationId,
    projectId: row.projectId,
    name: row.name,
    template: {
      metadata: parseJson<TriggerSessionTemplate['metadata']>(row.metadata, { labels: {}, annotations: {} }),
      spec: {
        agentId: row.agentId,
        environmentId: row.environmentId,
        runtime: RuntimeSchema.parse(row.runtime),
        promptTemplate: row.promptTemplate,
        env: parseJson<Record<string, string>>(row.env, {}),
        envFrom: parseJson(row.envFrom, [] as TriggerSessionTemplate['spec']['envFrom']),
        volumes: parseJson(row.volumes, [] as TriggerSessionTemplate['spec']['volumes']),
        volumeMounts: parseJson(row.volumeMounts, [] as TriggerSessionTemplate['spec']['volumeMounts']),
      },
    },
    nextDueAt: row.nextDueAt,
    intervalSeconds: row.intervalSeconds,
  }
}

function nextDueAt(trigger: DueTrigger) {
  return new Date(new Date(trigger.nextDueAt).getTime() + trigger.intervalSeconds * 1000).toISOString()
}

function triggerId(trigger: DueTrigger | Trigger) {
  return 'intervalSeconds' in trigger ? trigger.id : trigger.metadata.uid
}

function claimedHttpRun(row: typeof triggerRuns.$inferSelect): ClaimedRun {
  return {
    id: row.id,
    scheduledFor: row.triggeredAt,
    correlationId: row.correlationId,
    metadata: parseJson<Record<string, unknown>>(row.metadata, {}),
  }
}

async function pendingHttpRun(db: Db, runId: string): Promise<PendingHttpRun | null> {
  const row = await db
    .select({ pending: httpTriggerPendingRuns, run: triggerRuns })
    .from(httpTriggerPendingRuns)
    .innerJoin(triggerRuns, eq(triggerRuns.id, httpTriggerPendingRuns.runId))
    .where(eq(httpTriggerPendingRuns.runId, runId))
    .get()
  if (!row) return null
  return {
    run: claimedHttpRun(row.run),
    triggerId: row.pending.triggerId,
    organizationId: row.pending.organizationId,
    organizationName: row.pending.organizationName,
    projectId: row.pending.projectId,
    projectName: row.pending.projectName,
    requestedByUserId: row.pending.requestedByUserId,
    routingKeyHash: row.pending.routingKeyHash,
    renderedPrompt: row.pending.renderedPrompt,
  }
}

async function advanceTrigger(db: Db, trigger: DueTrigger, run: ClaimedRun, timestamp: string) {
  await db
    .update(triggers)
    .set({
      nextDueAt: nextDueAt(trigger),
      lastDispatchedAt: timestamp,
      lastRunId: run.id,
      updatedAt: timestamp,
    })
    .where(eq(triggers.id, triggerId(trigger)))
}

async function advanceRunTrigger(db: Db, trigger: DueTrigger | Trigger, run: ClaimedRun, timestamp: string) {
  if ('intervalSeconds' in trigger) {
    await advanceTrigger(db, trigger, run, timestamp)
    return
  }
  await db
    .update(triggers)
    .set({
      lastDispatchedAt: timestamp,
      lastRunId: run.id,
      updatedAt: timestamp,
    })
    .where(eq(triggers.id, triggerId(trigger)))
}

export function createTriggerDispatchRepo(db: Db): TriggerDispatchRepo {
  return {
    async dueTriggers(options): Promise<DueTrigger[]> {
      const filters = [
        // active = enabled and not archived (status enum replaced per api-v1)
        eq(triggers.triggerType, 'scheduled'),
        eq(triggers.enabled, true),
        isNull(triggers.archivedAt),
        lte(triggers.nextDueAt, options.heartbeatAt),
        options.projectId ? eq(triggers.projectId, options.projectId) : undefined,
      ].filter((filter) => filter !== undefined)
      const rows = await db
        .select()
        .from(triggers)
        .where(and(...filters))
        .orderBy(asc(triggers.nextDueAt), asc(triggers.id))
        .limit(options.limit)
      return rows.map(dueTriggerFrom)
    },

    async claimRun(trigger, heartbeatAt): Promise<ClaimedRun | null> {
      const runId = newId('schedrun')
      const scheduledFor = trigger.nextDueAt
      const idempotencyKey = `${trigger.id}:${scheduledFor}`
      const correlationId = `schedule:${idempotencyKey}`
      const timestamp = new Date().toISOString()
      try {
        await db.insert(triggerRuns).values({
          id: runId,
          organizationId: trigger.organizationId,
          projectId: trigger.projectId,
          triggerId: trigger.id,
          scheduledFor,
          heartbeatAt,
          triggeredAt: heartbeatAt,
          state: 'claimed',
          idempotencyKey,
          sessionId: null,
          correlationId,
          errorMessage: null,
          metadata: '{}',
          createdAt: timestamp,
          updatedAt: timestamp,
        })
      } catch (error) {
        if (uniqueConstraintError(error)) {
          return null
        }
        throw error
      }
      return { id: runId, scheduledFor, correlationId, metadata: {} }
    },

    async claimHttpRun(auth, trigger, triggeredAt, rawIdempotencyKey, metadata): Promise<ClaimedRun | null> {
      const runId = newId('httprun')
      const idempotencyKey = rawIdempotencyKey
        ? `http:${trigger.metadata.uid}:${rawIdempotencyKey}`
        : `http:${trigger.metadata.uid}:${runId}`
      const correlationId = `http:${idempotencyKey}`
      try {
        await db.insert(triggerRuns).values({
          id: runId,
          organizationId: auth.organization.id,
          projectId: auth.project.id,
          triggerId: trigger.metadata.uid,
          scheduledFor: null,
          heartbeatAt: null,
          triggeredAt,
          state: 'claimed',
          idempotencyKey,
          sessionId: null,
          correlationId,
          errorMessage: null,
          metadata: JSON.stringify(metadata),
          createdAt: triggeredAt,
          updatedAt: triggeredAt,
        })
      } catch (error) {
        if (uniqueConstraintError(error)) {
          return null
        }
        throw error
      }
      return { id: runId, scheduledFor: triggeredAt, correlationId, metadata }
    },

    async enqueueHttpRun(auth, trigger, triggeredAt, rawIdempotencyKey, metadata, input) {
      const runId = newId('httprun')
      const idempotencyKey = rawIdempotencyKey
        ? `http:${trigger.metadata.uid}:${rawIdempotencyKey}`
        : `http:${trigger.metadata.uid}:${runId}`
      const correlationId = `http:${idempotencyKey}`
      const run = {
        id: runId,
        organizationId: auth.organization.id,
        projectId: auth.project.id,
        triggerId: trigger.metadata.uid,
        scheduledFor: null,
        heartbeatAt: null,
        triggeredAt,
        state: 'queued' as const,
        idempotencyKey,
        sessionId: null,
        correlationId,
        errorMessage: null,
        metadata: JSON.stringify(metadata),
        createdAt: triggeredAt,
        updatedAt: triggeredAt,
      }
      try {
        await db.batch([
          db.insert(triggerRuns).values(run),
          db.insert(httpTriggerPendingRuns).values({
            runId,
            triggerId: trigger.metadata.uid,
            organizationId: auth.organization.id,
            organizationName: auth.organization.name,
            projectId: auth.project.id,
            projectName: auth.project.name,
            requestedByUserId: auth.user.id,
            routingKeyHash: input.routingKeyHash,
            renderedPrompt: input.renderedPrompt,
            createdAt: triggeredAt,
          }),
        ])
      } catch (error) {
        if (!uniqueConstraintError(error)) throw error
        const existing = await db
          .select({ id: triggerRuns.id })
          .from(triggerRuns)
          .where(eq(triggerRuns.idempotencyKey, idempotencyKey))
          .get()
        if (!existing) throw error
        return { replayed: true as const, runId: existing.id, wake: true as const }
      }
      const oldest = await db
        .select({ runId: httpTriggerPendingRuns.runId })
        .from(httpTriggerPendingRuns)
        .innerJoin(triggerRuns, eq(triggerRuns.id, httpTriggerPendingRuns.runId))
        .where(and(eq(httpTriggerPendingRuns.triggerId, trigger.metadata.uid), eq(triggerRuns.state, 'queued')))
        .orderBy(asc(httpTriggerPendingRuns.sequence))
        .limit(1)
        .get()
      return {
        replayed: false as const,
        run: { id: runId, scheduledFor: triggeredAt, correlationId, metadata },
        wake: oldest?.runId === runId,
      }
    },

    async claimNextHttpRun(triggerId) {
      const routingKeyPath = `$.annotations."${AMA_ANNOTATION_KEY_ROUTING_KEY_HASH}"`
      const active = await db
        .select({
          sessionId: sessions.id,
          routingKeyHash: sql<string | null>`json_extract(${sessions.metadata}, ${routingKeyPath})`,
        })
        .from(triggerRuns)
        .innerJoin(sessions, eq(sessions.id, triggerRuns.sessionId))
        .where(
          and(
            eq(triggerRuns.triggerId, triggerId),
            eq(triggerRuns.state, 'dispatched'),
            inArray(sessions.state, ['pending', 'running']),
          ),
        )
        .orderBy(desc(triggerRuns.updatedAt))
        .limit(1)
        .get()
      if (active && !active.routingKeyHash) return null

      const candidate = await db
        .select({ runId: httpTriggerPendingRuns.runId })
        .from(httpTriggerPendingRuns)
        .innerJoin(triggerRuns, eq(triggerRuns.id, httpTriggerPendingRuns.runId))
        .where(
          and(
            eq(httpTriggerPendingRuns.triggerId, triggerId),
            eq(triggerRuns.state, 'queued'),
            active?.routingKeyHash ? eq(httpTriggerPendingRuns.routingKeyHash, active.routingKeyHash) : undefined,
          ),
        )
        .orderBy(asc(httpTriggerPendingRuns.sequence))
        .limit(1)
        .get()
      if (!candidate) return null

      const claimAllowed = active
        ? sql`not exists (
            select 1
            from ${triggerRuns} serializing_run
            where serializing_run.trigger_id = ${triggerId}
              and serializing_run.state = 'dispatching'
          ) and exists (
            select 1
            from ${sessions} active_session
            where active_session.id = ${active.sessionId}
              and active_session.state in ('pending', 'running')
          ) and not exists (
            select 1
            from ${triggerRuns} other_run
            inner join ${sessions} other_session on other_session.id = other_run.session_id
            where other_run.trigger_id = ${triggerId}
              and other_run.state = 'dispatched'
              and other_session.state in ('pending', 'running')
              and other_session.id <> ${active.sessionId}
          )`
        : sql`not exists (
        select 1
        from ${triggerRuns} active_run
        left join ${sessions} active_session on active_session.id = active_run.session_id
        where active_run.trigger_id = ${triggerId}
          and (
            active_run.state = 'dispatching'
            or (active_run.state = 'dispatched' and active_session.state in ('pending', 'running'))
          )
      )`
      const claimed = await db
        .update(triggerRuns)
        .set({ state: 'dispatching', updatedAt: new Date().toISOString() })
        .where(and(eq(triggerRuns.id, candidate.runId), eq(triggerRuns.state, 'queued'), claimAllowed))
        .returning({ id: triggerRuns.id })
        .get()
      return claimed ? pendingHttpRun(db, claimed.id) : null
    },

    async requeueHttpRun(runId) {
      await db
        .update(triggerRuns)
        .set({ state: 'queued', updatedAt: new Date().toISOString() })
        .where(and(eq(triggerRuns.id, runId), eq(triggerRuns.state, 'dispatching')))
    },

    async staleHttpRuns(staleBefore, limit): Promise<StalePendingHttpRun[]> {
      const rows = await db
        .select({ runId: httpTriggerPendingRuns.runId })
        .from(httpTriggerPendingRuns)
        .innerJoin(triggerRuns, eq(triggerRuns.id, httpTriggerPendingRuns.runId))
        .where(and(eq(triggerRuns.state, 'dispatching'), lte(triggerRuns.updatedAt, staleBefore)))
        .orderBy(asc(triggerRuns.updatedAt), asc(httpTriggerPendingRuns.sequence))
        .limit(limit)
      return Promise.all(
        rows.map(async ({ runId }) => {
          const pending = await pendingHttpRun(db, runId)
          if (!pending) throw new Error(`Pending HTTP run ${runId} is unavailable during recovery`)
          const session = await db
            .select({ id: sessions.id, metadata: sessions.metadata })
            .from(sessions)
            .where(
              and(
                eq(sessions.projectId, pending.projectId),
                eq(sql<string>`json_extract(${sessions.metadata}, '$.annotations.source')`, 'http-trigger'),
                eq(sql<string>`json_extract(${sessions.metadata}, '$.annotations.httpTriggerId')`, pending.triggerId),
                eq(sql<string>`json_extract(${sessions.metadata}, '$.annotations.httpRunId')`, runId),
              ),
            )
            .orderBy(desc(sessions.createdAt))
            .limit(1)
            .get()
          return {
            ...pending,
            existingSession: session
              ? {
                  id: session.id,
                  metadata: parseJson<Pick<ResourceMetadata, 'labels' | 'annotations'>>(session.metadata, {
                    labels: {},
                    annotations: {},
                  }),
                }
              : null,
          }
        }),
      )
    },

    async hasPendingHttpRuns(triggerId) {
      const row = await db
        .select({ runId: httpTriggerPendingRuns.runId })
        .from(httpTriggerPendingRuns)
        .innerJoin(triggerRuns, eq(triggerRuns.id, httpTriggerPendingRuns.runId))
        .where(and(eq(httpTriggerPendingRuns.triggerId, triggerId), eq(triggerRuns.state, 'queued')))
        .limit(1)
        .get()
      return Boolean(row)
    },

    async pendingHttpTriggers(limit) {
      return db
        .selectDistinct({ triggerId: httpTriggerPendingRuns.triggerId, projectId: httpTriggerPendingRuns.projectId })
        .from(httpTriggerPendingRuns)
        .innerJoin(triggerRuns, eq(triggerRuns.id, httpTriggerPendingRuns.runId))
        .where(eq(triggerRuns.state, 'queued'))
        .orderBy(asc(httpTriggerPendingRuns.sequence))
        .limit(limit)
    },

    async projectName(projectId): Promise<string | null> {
      const project = await db.select().from(projects).where(eq(projects.id, projectId)).get()
      return project ? project.name : null
    },

    async markRunFailed(trigger, run, message): Promise<void> {
      const timestamp = new Date().toISOString()
      await db.batch([
        db
          .update(triggerRuns)
          .set({ state: 'failed', errorMessage: message, updatedAt: timestamp })
          .where(eq(triggerRuns.id, run.id)),
        db.delete(httpTriggerPendingRuns).where(eq(httpTriggerPendingRuns.runId, run.id)),
      ])
      await advanceRunTrigger(db, trigger, run, timestamp)
    },

    async markRunDispatched(trigger, run, sessionId, sessionMetadata): Promise<void> {
      const timestamp = new Date().toISOString()
      await db.batch([
        db
          .update(triggerRuns)
          .set({
            state: 'dispatched',
            sessionId,
            metadata: JSON.stringify({ ...run.metadata, sessionMetadata }),
            updatedAt: timestamp,
          })
          .where(eq(triggerRuns.id, run.id)),
        db.delete(httpTriggerPendingRuns).where(eq(httpTriggerPendingRuns.runId, run.id)),
      ])
      await advanceRunTrigger(db, trigger, run, timestamp)
    },
  }
}
