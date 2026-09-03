import { eq, max } from 'drizzle-orm'
import type { drizzle } from 'drizzle-orm/d1'
import type { EnborEvent } from '../../shared/session-events'
import { createUsageWriteRepo } from '../adapters/repos/usage-write'
import { newPrimaryKey } from '../id'
import { redactToolResultsFromPayload } from '../redaction'
import { sessionEvents } from './schema'

type Db = ReturnType<typeof drizzle>

export interface EventWriteContext {
  organizationId: string
  projectId: string
  sessionId: string
}

// Single insert path for session events: allocates the next sequence (retrying
// on unique collisions) and redacts only tool-result output before storage.
export async function insertCanonicalSessionEvent(
  db: Db,
  scope: EventWriteContext,
  event: EnborEvent,
): Promise<string> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const eventId = newPrimaryKey()
    const latest = await db
      .select({ sequence: max(sessionEvents.sequence) })
      .from(sessionEvents)
      .where(eq(sessionEvents.sessionId, scope.sessionId))
      .get()
    try {
      await db.insert(sessionEvents).values({
        id: eventId,
        organizationId: scope.organizationId,
        projectId: scope.projectId,
        sessionId: scope.sessionId,
        sequence: (latest?.sequence ?? 0) + 1,
        type: event.type,
        payload: JSON.stringify(redactToolResultsFromPayload(event.payload)),
        metadata: '{}',
        createdAt: new Date().toISOString(),
      })
      // Provider-domain accounting (usage records, provider error health)
      // hangs off the same insert so every ingest path — cloud runtime,
      // runner leases, runner channels — records usage exactly once.
      await createUsageWriteRepo(db).recordProviderSignals(scope, eventId, event)
      return eventId
    } catch (error) {
      if (attempt === 4 || !String(error).includes('UNIQUE')) {
        throw error
      }
    }
  }
  throw new Error('Unable to append canonical session event')
}
