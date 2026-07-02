import { RuntimeSchema } from '@server/contracts/environment-contracts'
import type { Trigger, TriggerSessionTemplate } from '@server/domain/trigger'
import type { ClaimedRun, DueTrigger, TriggerDispatchRepo } from '@server/usecases/ports'
import { and, asc, eq, isNull, lte } from 'drizzle-orm'
import type { drizzle } from 'drizzle-orm/d1'
import { projects, triggerRuns, triggers } from '../../db/schema'

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

    async projectName(projectId): Promise<string | null> {
      const project = await db.select().from(projects).where(eq(projects.id, projectId)).get()
      return project ? project.name : null
    },

    async markRunFailed(trigger, run, message): Promise<void> {
      const timestamp = new Date().toISOString()
      await db
        .update(triggerRuns)
        .set({ state: 'failed', errorMessage: message, updatedAt: timestamp })
        .where(eq(triggerRuns.id, run.id))
      await advanceRunTrigger(db, trigger, run, timestamp)
    },

    async markRunDispatched(trigger, run, sessionId, sessionMetadata): Promise<void> {
      const timestamp = new Date().toISOString()
      await db
        .update(triggerRuns)
        .set({
          state: 'dispatched',
          sessionId,
          metadata: JSON.stringify({ ...run.metadata, sessionMetadata }),
          updatedAt: timestamp,
        })
        .where(eq(triggerRuns.id, run.id))
      await advanceRunTrigger(db, trigger, run, timestamp)
    },
  }
}
