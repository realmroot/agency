import type { RuntimeName } from '@server/contracts/environment-contracts'
import { resourceMetadata, resourcePhase } from '@server/domain/resource'
import type { EnvFromEntry, Volume, VolumeMount } from '@server/domain/runtime/execution-inputs'
import type { Trigger, TriggerRun, TriggerSessionTemplate } from '@server/domain/trigger'
import type {
  CreateTriggerInput,
  ListPageResult,
  TriggerListQuery,
  TriggerRepo,
  TriggerRunListQuery,
  UpdateTriggerFields,
} from '@server/usecases/ports'
import { ResourceDeletedDuringMutationError } from '@server/usecases/ports'
import { and, desc, eq, gte, isNull, like, lt, lte, or } from 'drizzle-orm'
import type { drizzle } from 'drizzle-orm/d1'
import { agents, environments, triggerRuns, triggers } from '../../db/schema'
import { throwIfDeletedParentConstraint } from './soft-delete-constraints'

type Db = ReturnType<typeof drizzle>
type TriggerRow = typeof triggers.$inferSelect
type RunRow = typeof triggerRuns.$inferSelect

function stringify(value: unknown) {
  return JSON.stringify(value)
}

function parseJson<T>(value: string | null, fallback: T) {
  return value ? (JSON.parse(value) as T) : fallback
}

function recordFrom(row: TriggerRow): Trigger {
  const type = row.triggerType ?? 'scheduled'
  const template: TriggerSessionTemplate = {
    metadata: parseJson<TriggerSessionTemplate['metadata']>(row.metadata, { labels: {}, annotations: {} }),
    spec: {
      agentId: row.agentId,
      environmentId: row.environmentId,
      runtime: row.runtime as RuntimeName,
      promptTemplate: row.promptTemplate,
      env: parseJson<Record<string, string>>(row.env, {}),
      envFrom: parseJson<EnvFromEntry[]>(row.envFrom, []),
      volumes: parseJson<Volume[]>(row.volumes, []),
      volumeMounts: parseJson<VolumeMount[]>(row.volumeMounts, []),
    },
  }
  return {
    metadata: resourceMetadata({
      uid: row.id,
      pid: row.projectId,
      name: row.name,
      createdBy: row.createdByUserId,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      deletedAt: row.deletedAt,
    }),
    spec: {
      source:
        type === 'scheduled'
          ? {
              type: 'schedule',
              schedule: {
                type: 'interval',
                intervalSeconds: row.intervalSeconds ?? 0,
                windowSeconds: row.windowSeconds ?? 0,
              },
            }
          : type === 'http'
            ? {
                type: 'http',
                concurrency: { mode: row.httpConcurrencyMode ?? 'parallel' },
              }
            : { type: 'inbox' },
      suspend: !row.enabled,
      template,
    },
    status: {
      phase: resourcePhase(row.deletedAt),
      nextDueAt: row.nextDueAt,
      lastDispatchedAt: row.lastDispatchedAt,
      lastRunId: row.lastRunId,
      subscription:
        type === 'inbox' && row.inboxSubscriptionId && row.inboxProvisioningState
          ? {
              id: row.inboxSubscriptionId,
              phase: row.inboxProvisioningState,
              errorMessage: row.inboxProvisioningError,
            }
          : null,
    },
  }
}

function runRecordFrom(row: RunRow): TriggerRun {
  return {
    metadata: resourceMetadata({
      uid: row.id,
      pid: row.projectId,
      name: row.correlationId,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    }),
    spec: {
      triggerId: row.triggerId,
      scheduledFor: row.scheduledFor,
      idempotencyKey: row.idempotencyKey,
      correlationId: row.correlationId,
      metadata: parseJson<Record<string, unknown>>(row.metadata, {}),
    },
    status: {
      phase: row.state as TriggerRun['status']['phase'],
      heartbeatAt: row.heartbeatAt,
      triggeredAt: row.triggeredAt,
      sessionId: row.sessionId,
      errorMessage: row.errorMessage,
    },
  }
}

function configColumns(config: CreateTriggerInput['config']) {
  const schedule = config.source.type === 'schedule' ? config.source.schedule : null
  return {
    triggerType: schedule
      ? ('scheduled' as const)
      : config.source.type === 'http'
        ? ('http' as const)
        : ('inbox' as const),
    httpConcurrencyMode: config.source.type === 'http' ? (config.source.concurrency?.mode ?? 'parallel') : 'parallel',
    agentId: config.template.spec.agentId,
    environmentId: config.template.spec.environmentId,
    runtime: config.template.spec.runtime,
    name: config.name,
    promptTemplate: config.template.spec.promptTemplate,
    env: stringify(config.template.spec.env),
    envFrom: stringify(config.template.spec.envFrom),
    volumes: stringify(config.template.spec.volumes),
    volumeMounts: stringify(config.template.spec.volumeMounts),
    intervalSeconds: schedule?.intervalSeconds ?? null,
    windowSeconds: schedule?.windowSeconds ?? null,
    enabled: !config.suspend,
    nextDueAt: config.nextDueAt,
    metadata: stringify(config.template.metadata),
  }
}

export function createTriggerRepo(db: Db): TriggerRepo {
  return {
    async list(query: TriggerListQuery): Promise<ListPageResult<Trigger>> {
      const filters = [
        eq(triggers.projectId, query.projectId),
        isNull(triggers.deletedAt),
        query.enabled !== undefined ? eq(triggers.enabled, query.enabled) : undefined,
        query.search ? like(triggers.name, `%${query.search}%`) : undefined,
        query.createdFrom ? gte(triggers.createdAt, query.createdFrom) : undefined,
        query.createdTo ? lte(triggers.createdAt, query.createdTo) : undefined,
        query.cursor
          ? or(
              lt(triggers.createdAt, query.cursor.createdAt),
              and(eq(triggers.createdAt, query.cursor.createdAt), lt(triggers.id, query.cursor.id)),
            )
          : undefined,
      ].filter((filter) => filter !== undefined)
      const rows = await db
        .select()
        .from(triggers)
        .where(and(...filters))
        .orderBy(desc(triggers.createdAt), desc(triggers.id))
        .limit(query.limit + 1)
      const hasMore = rows.length > query.limit
      return { rows: rows.slice(0, query.limit).map(recordFrom), hasMore }
    },

    async find(projectId, triggerId) {
      const row = await db
        .select()
        .from(triggers)
        .where(and(eq(triggers.id, triggerId), eq(triggers.projectId, projectId), isNull(triggers.deletedAt)))
        .get()
      return row ? recordFrom(row) : null
    },

    async insert(input: CreateTriggerInput, timestamp) {
      const row = {
        id: input.id,
        organizationId: input.organizationId,
        projectId: input.projectId,
        lastDispatchedAt: null,
        lastRunId: null,
        createdByUserId: input.createdByUserId,
        deletedAt: null,
        inboxSubscriptionId: input.inboxProvisioning?.subscriptionId ?? null,
        inboxCallbackTokenHash: input.inboxProvisioning?.callbackTokenHash ?? null,
        inboxCallbackTokenCiphertext: input.inboxProvisioning?.callbackTokenCiphertext ?? null,
        inboxSubscriptionEtag: input.inboxProvisioning?.etag ?? null,
        inboxRegisteredAgentSubject: input.inboxProvisioning?.registeredAgentSubject ?? null,
        inboxTransitionTargetSubject: input.inboxProvisioning?.transitionTargetSubject ?? null,
        inboxProvisioningState: input.inboxProvisioning?.phase ?? null,
        inboxProvisioningError: input.inboxProvisioning?.errorMessage ?? null,
        createdAt: timestamp,
        updatedAt: timestamp,
        ...configColumns(input.config),
      }
      try {
        await db.insert(triggers).values(row)
      } catch (error) {
        throwIfDeletedParentConstraint(error, 'Trigger')
        throw error
      }
      return recordFrom(row)
    },

    async update(projectId, triggerId, fields: UpdateTriggerFields, updatedAt) {
      const row = await db
        .update(triggers)
        .set({
          updatedAt,
          ...(fields.inboxProvisioning !== undefined
            ? {
                inboxSubscriptionId: fields.inboxProvisioning?.subscriptionId ?? null,
                inboxCallbackTokenHash: fields.inboxProvisioning?.callbackTokenHash ?? null,
                inboxCallbackTokenCiphertext: fields.inboxProvisioning?.callbackTokenCiphertext ?? null,
                inboxSubscriptionEtag: fields.inboxProvisioning?.etag ?? null,
                inboxRegisteredAgentSubject: fields.inboxProvisioning?.registeredAgentSubject ?? null,
                inboxTransitionTargetSubject: fields.inboxProvisioning?.transitionTargetSubject ?? null,
                inboxProvisioningState: fields.inboxProvisioning?.phase ?? null,
                inboxProvisioningError: fields.inboxProvisioning?.errorMessage ?? null,
              }
            : {}),
          ...configColumns(fields.config),
        })
        .where(and(eq(triggers.id, triggerId), eq(triggers.projectId, projectId), isNull(triggers.deletedAt)))
        .returning()
        .get()
      if (!row) throw new ResourceDeletedDuringMutationError('Trigger')
      return recordFrom(row)
    },

    async delete(projectId, triggerId) {
      const deletedAt = new Date().toISOString()
      const rows = await db
        .update(triggers)
        .set({ deletedAt, updatedAt: deletedAt, enabled: false })
        .where(and(eq(triggers.id, triggerId), eq(triggers.projectId, projectId), isNull(triggers.deletedAt)))
        .returning({ id: triggers.id })
      return rows.length > 0
    },

    async listRuns(query: TriggerRunListQuery): Promise<ListPageResult<TriggerRun>> {
      const filters = [
        eq(triggerRuns.triggerId, query.triggerId),
        eq(triggerRuns.projectId, query.projectId),
        query.state ? eq(triggerRuns.state, query.state) : undefined,
        query.search ? like(triggerRuns.correlationId, `%${query.search}%`) : undefined,
        query.createdFrom ? gte(triggerRuns.createdAt, query.createdFrom) : undefined,
        query.createdTo ? lte(triggerRuns.createdAt, query.createdTo) : undefined,
        query.cursor
          ? or(
              lt(triggerRuns.createdAt, query.cursor.createdAt),
              and(eq(triggerRuns.createdAt, query.cursor.createdAt), lt(triggerRuns.id, query.cursor.id)),
            )
          : undefined,
      ].filter((filter) => filter !== undefined)
      const rows = await db
        .select()
        .from(triggerRuns)
        .where(and(...filters))
        .orderBy(desc(triggerRuns.createdAt), desc(triggerRuns.id))
        .limit(query.limit + 1)
      const hasMore = rows.length > query.limit
      return { rows: rows.slice(0, query.limit).map(runRecordFrom), hasMore }
    },

    async findRun(projectId, triggerId, runId) {
      const row = await db
        .select()
        .from(triggerRuns)
        .where(
          and(eq(triggerRuns.id, runId), eq(triggerRuns.triggerId, triggerId), eq(triggerRuns.projectId, projectId)),
        )
        .get()
      return row ? runRecordFrom(row) : null
    },

    async agentUsable(projectId, agentId) {
      const agent = await db
        .select({ deletedAt: agents.deletedAt })
        .from(agents)
        .where(and(eq(agents.id, agentId), eq(agents.projectId, projectId)))
        .get()
      if (!agent) {
        return { status: 404, message: 'Agent not found' }
      }
      if (agent.deletedAt !== null) {
        return { status: 409, message: 'Deleted agents cannot be scheduled' }
      }
      return null
    },

    async environmentUsable(projectId, environmentId) {
      const environment = await db
        .select({ deletedAt: environments.deletedAt, currentVersionId: environments.currentVersionId })
        .from(environments)
        .where(and(eq(environments.id, environmentId), eq(environments.projectId, projectId)))
        .get()
      if (!environment || environment.deletedAt !== null || !environment.currentVersionId) {
        return { status: 409, message: 'Selected environment is deleted or unavailable' }
      }
      return null
    },
  }
}
