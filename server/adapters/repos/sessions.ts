import { newPrimaryKey } from '@server/id'
import { ENBOR_ANNOTATION_KEY_ROUTING_KEY_HASH } from '@server/metadata-keys'
import type {
  EventQuery,
  RuntimeSessionHandle,
  SessionListPage,
  SessionListQuery,
  SessionMessageListPage,
  SessionMessageListQuery,
  SessionRepo,
} from '@server/usecases/ports'
import {
  ENBOR_SESSION_EVENT_TYPES,
  type EnborEvent,
  type EnborSessionEventType,
  isEnborSessionEventType,
} from '@shared/session-events'
import { and, asc, desc, eq, gt, gte, inArray, isNull, like, lt, lte, or, sql } from 'drizzle-orm'
import type { drizzle } from 'drizzle-orm/d1'
import type { RuntimeName } from '../../contracts/environment-contracts'
import { leases, runners, sessionApprovals, sessionEvents, sessionMessages, sessions, workItems } from '../../db/schema'
import { insertCanonicalSessionEvent } from '../../db/session-event-store'
import { domainSessionState, persistedSessionState } from '../../db/session-state'
import { runtimePlacement } from '../../domain/runtime/driver'
import { declaredVolumes } from '../../domain/runtime/execution-inputs'
import {
  type ApprovalState,
  hostingModeFromSnapshot,
  type MessageDelivery,
  type MessageState,
  type Session,
  type SessionAgentSnapshot,
  type SessionApproval,
  type SessionCondition,
  type SessionEnvironmentSnapshot,
  type SessionEvent,
  type SessionMessage,
  type SessionState,
} from '../../domain/session'

type Db = ReturnType<typeof drizzle>
type SessionRow = typeof sessions.$inferSelect
type SessionEventRow = typeof sessionEvents.$inferSelect
type SessionMessageRow = typeof sessionMessages.$inferSelect

function sessionConditions(row: SessionRow, metadata: Record<string, unknown>): SessionCondition[] {
  const runtimeError = metadata.error
  if (
    row.state !== 'error' ||
    !runtimeError ||
    typeof runtimeError !== 'object' ||
    Array.isArray(runtimeError) ||
    (runtimeError as Record<string, unknown>).code !== 'environment_package_installation_failed'
  ) {
    return []
  }
  return [
    {
      type: 'RuntimeReady',
      status: 'False',
      reason: 'EnvironmentPackageInstallationFailed',
      message: row.stateReason,
      lastTransitionAt: row.updatedAt,
    },
  ]
}
type SessionApprovalRow = typeof sessionApprovals.$inferSelect
type EventOrder = 'asc' | 'desc'

function parseJson<T>(value: string | null) {
  return value ? (JSON.parse(value) as T) : null
}

function objectValue(value: unknown) {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

function parseAgentSnapshot(value: string | null) {
  return parseJson<SessionAgentSnapshot>(value)
}

function snapshotRuntime(metadata: Record<string, unknown>): RuntimeName {
  const runtime = metadata.runtime
  if (typeof runtime !== 'string') {
    throw new Error('Session runtime metadata is required')
  }
  return runtime as RuntimeName
}

function sessionState(value: string): SessionState {
  const state = domainSessionState(value)
  if (state === 'pending' || state === 'running' || state === 'idle' || state === 'closed' || state === 'error') {
    return state
  }
  throw new Error(`Invalid session state: ${value}`)
}

function messageDelivery(value: string): MessageDelivery {
  if (value === 'live' || value === 'queued') {
    return value
  }
  throw new Error(`Invalid session message delivery: ${value}`)
}

function messageState(value: string): MessageState {
  if (value === 'accepted' || value === 'delivered' || value === 'failed') {
    return value
  }
  throw new Error(`Invalid session message state: ${value}`)
}

function approvalState(value: string): ApprovalState {
  if (value === 'pending' || value === 'approved' || value === 'denied') {
    return value
  }
  throw new Error(`Invalid session approval state: ${value}`)
}

function sessionModel(modelConfig: Record<string, unknown>, agentSnapshot: SessionAgentSnapshot) {
  return typeof modelConfig.model === 'string'
    ? modelConfig.model
    : typeof agentSnapshot.model === 'string'
      ? agentSnapshot.model
      : null
}

function normalizeEnvironmentSnapshot(snapshot: Record<string, unknown> | null): Record<string, unknown> | null {
  if (!snapshot) {
    return null
  }
  return {
    ...snapshot,
    type: snapshot.type === 'self_hosted' ? 'self_hosted' : 'cloud',
    networking: objectValue(snapshot.networking),
  }
}

function serializeSession(row: SessionRow): Session {
  const agentSnapshot = parseAgentSnapshot(row.agentSnapshot)
  if (!agentSnapshot) {
    throw new Error('Session agent snapshot is required')
  }
  const environmentSnapshot = normalizeEnvironmentSnapshot(parseJson<Record<string, unknown>>(row.environmentSnapshot))
  const metadata = parseJson<Record<string, unknown>>(row.metadata) ?? {}
  const modelConfig = parseJson<Record<string, unknown>>(row.modelConfig) ?? {}
  const hostingMode = hostingModeFromSnapshot(environmentSnapshot?.type)
  const runtime = snapshotRuntime(metadata)
  const provider = row.modelProvider ?? agentSnapshot.provider
  const model = sessionModel(modelConfig, agentSnapshot)
  const placement = runtimePlacement({
    hostingMode,
    runtime,
    runtimeConfig: objectValue(metadata.runtimeConfig),
    provider,
    model,
    metadata,
  })

  return {
    metadata: {
      uid: row.id,
      pid: row.projectId,
      name: row.title ?? row.id,
      labels: objectValue(metadata.labels) as Record<string, string>,
      annotations: objectValue(metadata.annotations) as Record<string, string>,
      createdBy: row.createdByUserId,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      deletedAt: row.deletedAt,
    },
    spec: {
      agentId: row.agentId,
      environmentId: row.environmentId,
      runtime,
      env: parseJson<Record<string, string>>(row.env) ?? {},
      envFrom: parseJson<Session['spec']['envFrom']>(row.envFrom) ?? [],
      volumes: declaredVolumes(parseJson<Session['spec']['volumes']>(row.volumes) ?? []),
      volumeMounts: parseJson<Session['spec']['volumeMounts']>(row.volumeMounts) ?? [],
    },
    status: {
      phase: sessionState(row.state),
      reason: row.stateReason,
      conditions: sessionConditions(row, metadata),
      bindings: {
        agent: {
          versionId: row.agentVersionId ?? '',
          snapshot: agentSnapshot,
        },
        environment: {
          id: row.environmentId,
          versionId: row.environmentVersionId,
          snapshot: environmentSnapshot as SessionEnvironmentSnapshot | null,
        },
        runtime,
      },
      placement: {
        hostingMode: placement.hostingMode,
        provider: placement.provider,
        model: placement.model,
        driver: placement.driver,
        backend: placement.backend,
        protocol: placement.protocol,
      },
      startedAt: row.startedAt,
      closedAt: row.closedAt,
    },
  }
}

function serializeMessage(row: SessionMessageRow): SessionMessage {
  return {
    id: row.id,
    sessionId: row.sessionId,
    type: row.type as 'prompt',
    content: row.content,
    delivery: messageDelivery(row.delivery),
    state: messageState(row.state),
    error: row.error,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

function serializeApproval(row: SessionApprovalRow): SessionApproval {
  return {
    id: row.id,
    sessionId: row.sessionId,
    toolCallId: row.toolCallId,
    toolName: row.toolName,
    input: parseJson<Record<string, unknown>>(row.input) ?? {},
    relatedEventIds: parseJson<string[]>(row.relatedEventIds) ?? [],
    state: approvalState(row.state),
    reason: row.reason,
    result: parseJson<Record<string, unknown>>(row.result),
    requestedAt: row.requestedAt,
    decidedAt: row.decidedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

function serializeEvent(row: SessionEventRow): SessionEvent {
  if (!isEnborSessionEventType(row.type)) {
    throw new Error(`Unsupported session event type: ${row.type}`)
  }
  const rawPayload = JSON.parse(row.payload) as Record<string, unknown>
  return {
    id: row.id,
    sessionId: row.sessionId,
    sequence: row.sequence,
    createdAt: row.createdAt,
    type: row.type,
    payload: rawPayload as EnborEvent['payload'],
  } as SessionEvent
}

function runtimeRow(row: SessionRow): RuntimeSessionHandle {
  return {
    id: row.id,
    projectId: row.projectId,
    organizationId: row.organizationId,
    state: sessionState(row.state),
    deletedAt: row.deletedAt,
    sandboxId: row.sandboxId,
    metadata: parseJson<Record<string, unknown>>(row.metadata) ?? {},
  }
}

function eventTypeFilter(type: string | undefined) {
  return type ? eq(sessionEvents.type, type) : undefined
}

function parseLabelSelector(selector: string | undefined) {
  if (!selector) return []
  return selector
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const separator = part.indexOf('=')
      if (separator === -1) return { key: part, value: null }
      return { key: part.slice(0, separator).trim(), value: part.slice(separator + 1).trim() }
    })
}

function labelSelectorFilters(selector: string | undefined) {
  return parseLabelSelector(selector).map(({ key, value }) => {
    const path = `$.labels."${key.replaceAll('"', '\\"')}"`
    const label = sql<string>`json_extract(${sessions.metadata}, ${path})`
    return value === null ? sql`${label} is not null` : eq(label, value)
  })
}

function eventSequenceFilter(cursor: number, order: EventOrder) {
  return order === 'asc' ? gt(sessionEvents.sequence, cursor) : lt(sessionEvents.sequence, cursor)
}

function eventCursorFilter(cursor: number | undefined, order: EventOrder) {
  if (cursor === undefined) {
    return order === 'asc' ? eventSequenceFilter(0, order) : undefined
  }
  return eventSequenceFilter(cursor, order)
}

function eventFilters(sessionId: string, query: EventQuery) {
  return [
    eq(sessionEvents.sessionId, sessionId),
    eventCursorFilter(query.cursor, query.order),
    eventTypeFilter(query.type),
    query.createdFrom ? gte(sessionEvents.createdAt, query.createdFrom) : undefined,
    query.createdTo ? lte(sessionEvents.createdAt, query.createdTo) : undefined,
  ].filter((filter) => filter !== undefined)
}

function eventOrderBy(order: EventOrder) {
  return order === 'asc' ? asc(sessionEvents.sequence) : desc(sessionEvents.sequence)
}

export function createSessionRepo(db: Db): SessionRepo {
  return {
    async list(query: SessionListQuery): Promise<SessionListPage> {
      const filters = [
        eq(sessions.projectId, query.projectId),
        isNull(sessions.deletedAt),
        query.state ? eq(sessions.state, persistedSessionState(query.state)) : undefined,
        query.search ? like(sessions.agentId, `%${query.search}%`) : undefined,
        ...labelSelectorFilters(query.labelSelector),
        query.createdFrom ? gte(sessions.createdAt, query.createdFrom) : undefined,
        query.createdTo ? lte(sessions.createdAt, query.createdTo) : undefined,
        query.cursor
          ? or(
              lt(sessions.createdAt, query.cursor.createdAt),
              and(eq(sessions.createdAt, query.cursor.createdAt), lt(sessions.id, query.cursor.id)),
            )
          : undefined,
      ].filter((filter) => filter !== undefined)
      const rows = await db
        .select()
        .from(sessions)
        .where(and(...filters))
        .orderBy(desc(sessions.createdAt), desc(sessions.id))
        .limit(query.limit + 1)
      const hasMore = rows.length > query.limit
      return { rows: rows.slice(0, query.limit).map(serializeSession), hasMore }
    },

    async find(projectId, sessionId) {
      const row = await db
        .select()
        .from(sessions)
        .where(and(eq(sessions.id, sessionId), eq(sessions.projectId, projectId), isNull(sessions.deletedAt)))
        .get()
      return row ? serializeSession(row) : null
    },

    async findReusableHttpTriggerSession(projectId, triggerId, keyHash) {
      const row = await db
        .select()
        .from(sessions)
        .where(
          and(
            eq(sessions.projectId, projectId),
            isNull(sessions.deletedAt),
            eq(sql<string>`json_extract(${sessions.metadata}, '$.annotations.source')`, 'http-trigger'),
            eq(sql<string>`json_extract(${sessions.metadata}, '$.annotations.httpTriggerId')`, triggerId),
            eq(
              sql<string>`json_extract(${sessions.metadata}, ${`$.annotations."${ENBOR_ANNOTATION_KEY_ROUTING_KEY_HASH}"`})`,
              keyHash,
            ),
          ),
        )
        .orderBy(desc(sessions.createdAt), desc(sessions.id))
        .get()
      return row ? runtimeRow(row) : null
    },

    async findRuntimeRow(projectId, sessionId) {
      const row = await db
        .select()
        .from(sessions)
        .where(and(eq(sessions.id, sessionId), eq(sessions.projectId, projectId), isNull(sessions.deletedAt)))
        .get()
      return row ? runtimeRow(row) : null
    },

    async resolveRunnerEnvironmentId(sessionId) {
      const row = await db
        .select({ environmentId: sessions.environmentId })
        .from(sessions)
        .where(eq(sessions.id, sessionId))
        .get()
      return row?.environmentId ?? null
    },

    async resolveSandboxBackend(sessionId) {
      const row = await db
        .select({ metadata: sessions.metadata })
        .from(sessions)
        .where(eq(sessions.id, sessionId))
        .get()
      const metadata = row?.metadata ? (JSON.parse(row.metadata) as Record<string, unknown>) : {}
      return typeof metadata.sandboxBackend === 'string' ? metadata.sandboxBackend : null
    },

    async updateFields(projectId, sessionId, fields, updatedAt) {
      await db
        .update(sessions)
        .set({
          ...(fields.title !== undefined ? { title: fields.title } : {}),
          ...(fields.metadata !== undefined ? { metadata: JSON.stringify(fields.metadata) } : {}),
          updatedAt,
        })
        .where(and(eq(sessions.id, sessionId), eq(sessions.projectId, projectId), isNull(sessions.deletedAt)))
      const row = await db
        .select()
        .from(sessions)
        .where(and(eq(sessions.id, sessionId), eq(sessions.projectId, projectId), isNull(sessions.deletedAt)))
        .get()
      return row ? serializeSession(row) : null
    },

    async setMetadataAnnotationIfMissing(projectId, sessionId, key, value, updatedAt) {
      const annotationPath = `$.annotations."${key}"`
      const missing = sql`json_type(${sessions.metadata}, ${annotationPath}) is null`
      const rows = await db
        .update(sessions)
        .set({
          metadata: sql`case when ${missing} then json_set(${sessions.metadata}, ${annotationPath}, ${value}) else ${sessions.metadata} end`,
          updatedAt: sql`case when ${missing} then ${updatedAt} else ${sessions.updatedAt} end`,
        })
        .where(and(eq(sessions.id, sessionId), eq(sessions.projectId, projectId), isNull(sessions.deletedAt)))
        .returning({ id: sessions.id })
      return rows.length > 0
    },

    async listMessages(query: SessionMessageListQuery): Promise<SessionMessageListPage> {
      const filters = [
        eq(sessionMessages.sessionId, query.sessionId),
        eq(sessionMessages.projectId, query.projectId),
        query.cursor
          ? or(
              lt(sessionMessages.createdAt, query.cursor.createdAt),
              and(eq(sessionMessages.createdAt, query.cursor.createdAt), lt(sessionMessages.id, query.cursor.id)),
            )
          : undefined,
      ].filter((filter) => filter !== undefined)
      const rows = await db
        .select()
        .from(sessionMessages)
        .where(and(...filters))
        .orderBy(desc(sessionMessages.createdAt), desc(sessionMessages.id))
        .limit(query.limit + 1)
      const hasMore = rows.length > query.limit
      return { rows: rows.slice(0, query.limit).map(serializeMessage), hasMore }
    },

    async findMessage(projectId, sessionId, messageId) {
      const row = await db
        .select()
        .from(sessionMessages)
        .where(
          and(
            eq(sessionMessages.id, messageId),
            eq(sessionMessages.sessionId, sessionId),
            eq(sessionMessages.projectId, projectId),
          ),
        )
        .get()
      return row ? serializeMessage(row) : null
    },

    async insertMessage(record) {
      const row = {
        id: newPrimaryKey(),
        organizationId: record.organizationId,
        projectId: record.projectId,
        sessionId: record.sessionId,
        type: 'prompt',
        content: record.content,
        delivery: record.delivery as SessionMessageRow['delivery'],
        state: record.state as SessionMessageRow['state'],
        error: null,
        createdAt: record.createdAt,
        updatedAt: record.createdAt,
      } satisfies typeof sessionMessages.$inferInsert
      await db.insert(sessionMessages).values(row)
      return serializeMessage(row)
    },

    async queryEvents(sessionId, query) {
      const rows = await db
        .select()
        .from(sessionEvents)
        .where(and(...eventFilters(sessionId, query)))
        .orderBy(eventOrderBy(query.order))
        .limit(query.limit + 1)
      const hasMore = rows.length > query.limit
      return { rows: rows.slice(0, query.limit).map(serializeEvent), hasMore }
    },

    async insertEvents(scope, events) {
      for (const event of events) {
        await insertCanonicalSessionEvent(db, scope, event)
      }
      return events.length
    },

    async listApprovals(projectId, sessionId) {
      const rows = await db
        .select()
        .from(sessionApprovals)
        .where(and(eq(sessionApprovals.sessionId, sessionId), eq(sessionApprovals.projectId, projectId)))
        .orderBy(desc(sessionApprovals.createdAt), desc(sessionApprovals.id))
      return rows.map(serializeApproval)
    },

    async findApproval(projectId, sessionId, approvalId) {
      const row = await db
        .select()
        .from(sessionApprovals)
        .where(
          and(
            eq(sessionApprovals.id, approvalId),
            eq(sessionApprovals.sessionId, sessionId),
            eq(sessionApprovals.projectId, projectId),
          ),
        )
        .get()
      return row ? serializeApproval(row) : null
    },

    async activeSessionLeaseForRunner(projectId, sessionId, runner) {
      const identityFilters = [
        runner.runnerId ? eq(runners.id, runner.runnerId) : undefined,
        eq(runners.oidcSubject, runner.subject),
      ].filter((filter) => filter !== undefined)
      const candidateRunners = await db
        .select({ id: runners.id })
        .from(runners)
        .where(and(eq(runners.projectId, projectId), or(...identityFilters)))
      const candidateIds = candidateRunners.map((row) => row.id)
      if (candidateIds.length === 0) {
        return null
      }
      const rows = await db
        .select({
          leaseId: leases.id,
          leaseRunnerId: leases.runnerId,
          expiresAt: leases.expiresAt,
          workItemId: workItems.id,
          workItemState: workItems.state,
          workItemLeaseId: workItems.leaseId,
          workItemRunnerId: workItems.runnerId,
          payload: workItems.payload,
        })
        .from(leases)
        .innerJoin(workItems, eq(leases.workItemId, workItems.id))
        .where(
          and(
            eq(leases.projectId, projectId),
            eq(leases.state, 'active'),
            inArray(leases.runnerId, candidateIds),
            eq(workItems.sessionId, sessionId),
          ),
        )
      const timestamp = new Date().toISOString()
      const owned = rows.find(
        (row) =>
          row.expiresAt > timestamp &&
          row.workItemState === 'leased' &&
          row.workItemLeaseId === row.leaseId &&
          row.workItemRunnerId === row.leaseRunnerId,
      )
      if (!owned) {
        return null
      }
      const payload = parseJson<Record<string, unknown>>(owned.payload) ?? {}
      return {
        runnerId: owned.leaseRunnerId,
        leaseId: owned.leaseId,
        workItemId: owned.workItemId,
        ...(typeof payload.runtime === 'string' ? { runtime: payload.runtime } : {}),
        ...(typeof payload.provider === 'string' ? { provider: payload.provider } : {}),
        ...(typeof payload.model === 'string' ? { model: payload.model } : {}),
      }
    },
  }
}

// Re-exported for the http layer's SSE/CSV event filter cap parity.
export const SESSION_EVENT_TYPES = ENBOR_SESSION_EVENT_TYPES
export type { EnborSessionEventType }
