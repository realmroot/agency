// The Session DO's in-object canonical event store, over the DO's embedded
// SQLite (ctx.storage.sql). It is the cloud-loop (enbor runtime) home for the
// event firehose: the same event row and query contract as the D1 store
// (server/db/session-event-store.ts +
// server/adapters/repos/sessions.ts), one contract / two implementations. The
// DO single-thread serialises appends, so sequence allocation is race-free
// without the D1 store's UNIQUE-collision retry loop.
//
// Pure over SqlStorage: no Env, no D1, no sockets. The DO shell owns the side
// effects (usage accounting, browser fan-out, R2 archive); this module owns the
// rows.

import type { SessionEvent } from '@server/domain/session'
import { newPrimaryKey } from '@server/id'
import { redactToolResultsFromPayload } from '@server/redaction'
import type { EventPage, EventQuery } from '@server/usecases/ports'
import { type EnborEvent, isEnborSessionEventType, normalizeEnborEvent } from '@shared/session-events'

export interface EventWriteContext {
  organizationId: string
  projectId: string
  sessionId: string
}

type EventRow = {
  id: string
  organization_id: string
  project_id: string
  session_id: string
  sequence: number
  type: string
  payload: string
  metadata: string
  created_at: string
}

const CREATE_TABLE = `CREATE TABLE IF NOT EXISTS session_events (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  sequence INTEGER NOT NULL,
  type TEXT NOT NULL,
  payload TEXT NOT NULL,
  metadata TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
)`

const CREATE_INDEX = 'CREATE UNIQUE INDEX IF NOT EXISTS idx_session_events_seq ON session_events (session_id, sequence)'

export function ensureSessionEventSchema(sql: SqlStorage): void {
  sql.exec(CREATE_TABLE)
  dropLegacySessionEventColumns(sql)
  sql.exec(CREATE_INDEX)
}

function dropLegacySessionEventColumns(sql: SqlStorage): void {
  const columns = new Set(
    sql
      .exec<{ name: string }>('PRAGMA table_info(session_events)')
      .toArray()
      .map((row) => row.name),
  )
  for (const column of ['visibility', 'role', 'parent_event_id', 'correlation_id']) {
    if (columns.has(column)) {
      sql.exec(`ALTER TABLE session_events DROP COLUMN ${column}`)
    }
  }
}

// Single insert path: allocates the next sequence (monotonic, no retry — the DO
// thread serialises us), redacts only tool-result output, and returns the
// serialized record so the DO shell can fan it out to sockets.
export function appendCanonicalEventToSql(
  sql: SqlStorage,
  scope: EventWriteContext,
  event: EnborEvent,
): { id: string; sequence: number; record: SessionEvent } {
  const normalized = normalizeEnborEvent(event)
  const eventId = newPrimaryKey()
  const maxSequence =
    sql
      .exec<{ m: number | null }>('SELECT max(sequence) AS m FROM session_events WHERE session_id = ?', scope.sessionId)
      .one().m ?? 0
  const sequence = maxSequence + 1
  const createdAt = new Date().toISOString()
  const payload = JSON.stringify(redactToolResultsFromPayload(normalized.payload))
  const metadata = '{}'
  sql.exec(
    'INSERT INTO session_events (id, organization_id, project_id, session_id, sequence, type, payload, metadata, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    eventId,
    scope.organizationId,
    scope.projectId,
    scope.sessionId,
    sequence,
    normalized.type,
    payload,
    metadata,
    createdAt,
  )
  const record = serializeRow({
    id: eventId,
    organization_id: scope.organizationId,
    project_id: scope.projectId,
    session_id: scope.sessionId,
    sequence,
    type: normalized.type,
    payload,
    metadata,
    created_at: createdAt,
  })
  return { id: eventId, sequence, record }
}

// Mirrors server/adapters/repos/sessions.ts eventFilters + cursor pagination:
// session implied by the shard, optional type, createdFrom/To window, sequence
// cursor, order, limit + 1 hasMore probe.
export function queryEventsFromSql(sql: SqlStorage, sessionId: string, query: EventQuery): EventPage {
  const filters = ['session_id = ?']
  const binds: (string | number)[] = [sessionId]
  if (query.cursor !== undefined) {
    filters.push(query.order === 'asc' ? 'sequence > ?' : 'sequence < ?')
    binds.push(query.cursor)
  } else if (query.order === 'asc') {
    filters.push('sequence > ?')
    binds.push(0)
  }
  if (query.type) {
    filters.push('type = ?')
    binds.push(query.type)
  }
  if (query.createdFrom) {
    filters.push('created_at >= ?')
    binds.push(query.createdFrom)
  }
  if (query.createdTo) {
    filters.push('created_at <= ?')
    binds.push(query.createdTo)
  }
  const direction = query.order === 'asc' ? 'ASC' : 'DESC'
  const rows = sql
    .exec<EventRow>(
      `SELECT * FROM session_events WHERE ${filters.join(' AND ')} ORDER BY sequence ${direction} LIMIT ?`,
      ...binds,
      query.limit + 1,
    )
    .toArray()
  const hasMore = rows.length > query.limit
  return { rows: rows.slice(0, query.limit).map(serializeRow), hasMore }
}

// One event in a runner's local log, relayed over the channel for live fan-out
// or runner-backed history reads. The cloud does not persist these rows.
export interface RelayedRunnerEvent {
  id: string
  sessionId: string
  sequence: number
  createdAt: string
  type: EnborEvent['type']
  payload: EnborEvent['payload']
}

export function stepRelayEvent(raw: RelayedRunnerEvent, scope: EventWriteContext): EventRow {
  const event = normalizeEnborEvent({ type: raw.type, payload: raw.payload } as EnborEvent)
  return {
    id: raw.id,
    organization_id: scope.organizationId,
    project_id: scope.projectId,
    session_id: scope.sessionId,
    sequence: raw.sequence,
    type: event.type,
    payload: JSON.stringify(redactToolResultsFromPayload(event.payload)),
    metadata: '{}',
    created_at: raw.createdAt,
  }
}

export function pageRelayedEvents(
  rawEvents: RelayedRunnerEvent[],
  scope: EventWriteContext,
  query: EventQuery,
): EventPage {
  const direction = query.order === 'desc' ? -1 : 1
  const records = [...rawEvents]
    .sort((left, right) => left.sequence - right.sequence)
    .map((event) => serializeRow(stepRelayEvent(event, scope)))
    .filter((record) => {
      if (query.cursor !== undefined) {
        if (query.order === 'asc' && record.sequence <= query.cursor) return false
        if (query.order === 'desc' && record.sequence >= query.cursor) return false
      }
      if (query.type && record.type !== query.type) return false
      if (query.createdFrom && record.createdAt < query.createdFrom) return false
      if (query.createdTo && record.createdAt > query.createdTo) return false
      return true
    })
    .sort((left, right) => (left.sequence - right.sequence) * direction)
  return { rows: records.slice(0, query.limit), hasMore: records.length > query.limit }
}

export function countSessionEvents(sql: SqlStorage, sessionId: string): number {
  return sql.exec<{ c: number }>('SELECT count(*) AS c FROM session_events WHERE session_id = ?', sessionId).one().c
}

// The full {type, payload} stream in sequence order — exact mirror of the D1
// sessionEventStream used to rebuild the continuation transcript.
export function streamSessionEvents(sql: SqlStorage, sessionId: string): { type: string; payload: string }[] {
  return sql
    .exec<{ type: string; payload: string }>(
      'SELECT type, payload FROM session_events WHERE session_id = ? ORDER BY sequence ASC',
      sessionId,
    )
    .toArray()
}

// All rows as newline-delimited canonical JSON, sequence-ascending — the R2
// archive object (sessions/{sessionId}/events.jsonl).
export function exportSessionEventsJsonl(sql: SqlStorage, sessionId: string): string {
  const rows = sql
    .exec<EventRow>('SELECT * FROM session_events WHERE session_id = ? ORDER BY sequence ASC', sessionId)
    .toArray()
  return rows.map((row) => JSON.stringify(serializeRow(row))).join('\n')
}

// Row -> SessionEvent. The store only accepts canonical Enbor event rows.
export function serializeRow(row: EventRow): SessionEvent {
  if (!isEnborSessionEventType(row.type)) {
    throw new Error(`Unsupported session event type: ${row.type}`)
  }
  const rawPayload = JSON.parse(row.payload) as Record<string, unknown>
  return {
    id: row.id,
    sessionId: row.session_id,
    sequence: row.sequence,
    createdAt: row.created_at,
    type: row.type,
    payload: rawPayload as EnborEvent['payload'],
  } as SessionEvent
}
