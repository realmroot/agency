// The session event store router. "Storage follows the loop": cloud-loop (ama)
// sessions keep their event firehose in the per-session Session DO (SQLite hot +
// R2 cold). Self-hosted/external runtime sessions keep durable history on the
// runner only; the cloud relays live events and backfill reads but does not store
// those events.
//
// The DO append owns tool-result redaction, sequence threading, and browser
// fan-out; this router owns the routing + the D1 usage accounting that the DO
// path would otherwise skip (the D1 insert records it inline).

import type { EventStore } from '@server/usecases/ports'
import type { EnborEvent } from '@shared/session-events'
import { normalizeEnborEvent, SESSION_DO_EVENT_STORE } from '@shared/session-events'
import { eq } from 'drizzle-orm'
import type { drizzle } from 'drizzle-orm/d1'
import { sessions } from '../../db/schema'
import { createUsageWriteRepo } from '../repos/usage-write'
import type { SessionDoEventStore } from './session-do-events'

type Db = ReturnType<typeof drizzle>

export type CloudLoopChecker = (sessionId: string) => Promise<boolean>

// Whether a session's events live in the Session DO. Reads the stamp the cloud-
// start path writes; cached so the per-event firehose does not re-query D1.
export function createCloudLoopChecker(db: Db): CloudLoopChecker {
  const cache = new Map<string, boolean>()
  return async (sessionId: string) => {
    const cached = cache.get(sessionId)
    if (cached !== undefined) {
      return cached
    }
    const row = await db.select({ metadata: sessions.metadata }).from(sessions).where(eq(sessions.id, sessionId)).get()
    const metadata = row?.metadata ? (JSON.parse(row.metadata) as Record<string, unknown>) : {}
    const inDo = metadata.eventStore === SESSION_DO_EVENT_STORE
    cache.set(sessionId, inDo)
    return inDo
  }
}

async function sessionRunnerRoute(
  db: Db,
  sessionId: string,
): Promise<{ organizationId: string | null; projectId: string; environmentId: string } | null> {
  const row = await db
    .select({
      organizationId: sessions.organizationId,
      projectId: sessions.projectId,
      environmentId: sessions.environmentId,
    })
    .from(sessions)
    .where(eq(sessions.id, sessionId))
    .get()
  if (!row?.environmentId) {
    return null
  }
  return {
    organizationId: row.organizationId,
    projectId: row.projectId,
    environmentId: row.environmentId,
  }
}

export function createEventStore(db: Db, isCloudLoop: CloudLoopChecker, doStore: SessionDoEventStore): EventStore {
  const usage = createUsageWriteRepo(db)

  const appendStoredEvent = async (
    scope: { organizationId: string; projectId: string; sessionId: string },
    canonicalEvent: EnborEvent,
  ) => {
    if (await isCloudLoop(scope.sessionId)) {
      const { id } = await doStore.append(scope, canonicalEvent)
      // The D1 insert records usage inline; the DO path does not, so the router
      // keeps the "every ingest path records usage exactly once" invariant.
      await usage.recordProviderSignals(scope, id, canonicalEvent)
      return id
    }
    // Every other session runs its loop on a runner and is relay-only: the runner
    // store-and-serves the event; the cloud keeps no copy.
    return 'relay'
  }
  const appendEvent: EventStore['appendEvent'] = async (scope, event) => {
    return await appendStoredEvent(scope, normalizeEnborEvent(event))
  }

  return {
    appendEvent,
    async insertEvents(scope, events) {
      for (const event of events) {
        await appendEvent(scope, event)
      }
      return events.length
    },
    async queryEvents(sessionId, query) {
      if (await isCloudLoop(sessionId)) {
        return await doStore.query(sessionId, query)
      }
      return await doStore.relayQuery(sessionId, query, await sessionRunnerRoute(db, sessionId))
    },
    async eventStream(sessionId) {
      return (await isCloudLoop(sessionId)) ? await doStore.stream(sessionId) : []
    },
    async archive(scope) {
      if (await isCloudLoop(scope.sessionId)) {
        await doStore.archive(scope)
      }
    },
  }
}
