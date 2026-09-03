// Worker-side transport for session event IO. Cloud-loop events live in the
// Session DO; self-hosted runner events are relayed through the RunnerPool and
// remain durable only in the runner's local JSONL log.

import type { SessionEvent } from '@server/domain/session'
import type { EventPage, EventQuery } from '@server/usecases/ports'
import type { EnborEvent } from '@shared/session-events'
import type { Env } from '../../env'

export interface EventWriteContext {
  organizationId: string
  projectId: string
  sessionId: string
}

async function callSessionObject<T>(env: Env, doName: string, path: string, body: unknown): Promise<T> {
  const stub = env.SESSION.get(env.SESSION.idFromName(doName))
  const response = await stub.fetch(`https://session-object${path}`, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  })
  if (!response.ok) {
    throw new Error(`Session DO ${path} failed with HTTP ${response.status}`)
  }
  return (await response.json()) as T
}

async function callRunnerPool<T>(env: Env, environmentId: string, path: string, body: unknown): Promise<T> {
  const stub = env.RUNNER_POOL.get(env.RUNNER_POOL.idFromName(environmentId))
  const response = await stub.fetch(`https://runner-pool${path}`, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  })
  if (!response.ok) {
    throw new Error(`RunnerPool ${path} failed with HTTP ${response.status}`)
  }
  return (await response.json()) as T
}

export interface SessionDoEventStore {
  append(
    scope: EventWriteContext,
    canonicalEvent: EnborEvent,
  ): Promise<{ id: string; sequence: number; record: SessionEvent }>
  query(sessionId: string, query: EventQuery): Promise<EventPage>
  relayQuery(
    sessionId: string,
    query: EventQuery,
    route: { organizationId: string | null; projectId: string; environmentId: string } | null,
  ): Promise<EventPage & { runnerUnavailable?: boolean }>
  stream(sessionId: string): Promise<{ type: string; payload: string }[]>
  count(sessionId: string): Promise<number>
  archive(scope: EventWriteContext): Promise<void>
}

export function createSessionDoEventStore(env: Env): SessionDoEventStore {
  return {
    async append(scope, canonicalEvent) {
      return await callSessionObject(env, scope.sessionId, '/events/append', { scope, canonicalEvent })
    },
    async query(sessionId, query) {
      return await callSessionObject<EventPage>(env, sessionId, '/events/query', { sessionId, query })
    },
    async relayQuery(sessionId, query, route) {
      if (!route) {
        return { rows: [], hasMore: false, runnerUnavailable: true }
      }
      return await callRunnerPool<EventPage & { runnerUnavailable?: boolean }>(env, route.environmentId, '/backfill', {
        organizationId: route.organizationId,
        projectId: route.projectId,
        sessionId,
        query,
      })
    },
    async stream(sessionId) {
      const { events } = await callSessionObject<{ events: { type: string; payload: string }[] }>(
        env,
        sessionId,
        '/events/stream',
        { sessionId },
      )
      return events
    },
    async count(sessionId) {
      const { count } = await callSessionObject<{ count: number }>(env, sessionId, '/events/count', { sessionId })
      return count
    },
    async archive(scope) {
      await callSessionObject(env, scope.sessionId, '/events/archive', { scope })
    },
  }
}
