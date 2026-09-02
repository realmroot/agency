import type { ListPageResult, WorkItemListQuery, WorkItemRecord, WorkItemRepo } from '@server/usecases/ports'
import { and, desc, eq, gte, inArray, like, lt, lte, or } from 'drizzle-orm'
import type { drizzle } from 'drizzle-orm/d1'
import { leases, workItems } from '../../db/schema'

type Db = ReturnType<typeof drizzle>
type WorkItemRow = typeof workItems.$inferSelect

function parseJson<T>(value: string | null) {
  return value ? (JSON.parse(value) as T) : null
}

function recordFrom(row: WorkItemRow): WorkItemRecord {
  return {
    id: row.id,
    organizationId: row.organizationId,
    projectId: row.projectId,
    sessionId: row.sessionId,
    environmentId: row.environmentId,
    runnerId: row.runnerId,
    leaseId: row.leaseId,
    type: row.type,
    state: row.state,
    priority: row.priority,
    attempts: row.attempts,
    maxAttempts: row.maxAttempts,
    payload: parseJson<Record<string, unknown>>(row.payload) ?? {},
    result: parseJson<Record<string, unknown>>(row.result),
    error: parseJson<Record<string, unknown>>(row.error),
    availableAt: row.availableAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

export function createWorkItemRepo(db: Db): WorkItemRepo {
  return {
    async list(query: WorkItemListQuery): Promise<ListPageResult<WorkItemRecord>> {
      const filters = [
        eq(workItems.projectId, query.projectId),
        query.state ? eq(workItems.state, query.state as WorkItemRow['state']) : undefined,
        query.sessionId ? eq(workItems.sessionId, query.sessionId) : undefined,
        query.runnerId ? eq(workItems.runnerId, query.runnerId) : undefined,
        query.search ? like(workItems.type, `%${query.search}%`) : undefined,
        query.createdFrom ? gte(workItems.createdAt, query.createdFrom) : undefined,
        query.createdTo ? lte(workItems.createdAt, query.createdTo) : undefined,
        query.cursor
          ? or(
              lt(workItems.createdAt, query.cursor.createdAt),
              and(eq(workItems.createdAt, query.cursor.createdAt), lt(workItems.id, query.cursor.id)),
            )
          : undefined,
      ].filter((filter) => filter !== undefined)
      const rows = await db
        .select()
        .from(workItems)
        .where(and(...filters))
        .orderBy(desc(workItems.createdAt), desc(workItems.id))
        .limit(query.limit + 1)
      const hasMore = rows.length > query.limit
      return { rows: rows.slice(0, query.limit).map(recordFrom), hasMore }
    },

    async findLatestBySessions(projectId, sessionIds) {
      if (sessionIds.length === 0) return []
      const rows: WorkItemRow[] = []
      for (let offset = 0; offset < sessionIds.length; offset += 90) {
        rows.push(
          ...(await db
            .select()
            .from(workItems)
            .where(
              and(
                eq(workItems.projectId, projectId),
                inArray(workItems.sessionId, sessionIds.slice(offset, offset + 90)),
              ),
            )
            .orderBy(desc(workItems.createdAt), desc(workItems.id))),
        )
      }
      const latestBySession = new Map<string, WorkItemRow>()
      for (const row of rows) {
        if (row.sessionId && !latestBySession.has(row.sessionId)) {
          latestBySession.set(row.sessionId, row)
        }
      }
      return [...latestBySession.values()].map(recordFrom)
    },

    async find(projectId, workItemId) {
      const row = await db
        .select()
        .from(workItems)
        .where(and(eq(workItems.id, workItemId), eq(workItems.projectId, projectId)))
        .get()
      return row ? recordFrom(row) : null
    },

    async rawPayload(projectId, workItemId) {
      const row = await db
        .select({ payload: workItems.payload })
        .from(workItems)
        .where(and(eq(workItems.id, workItemId), eq(workItems.projectId, projectId)))
        .get()
      return row ? (JSON.parse(row.payload) as Record<string, unknown>) : null
    },

    async activeLeaseRunnerId(projectId, workItemId) {
      const row = await db
        .select({ state: workItems.state, runnerId: workItems.runnerId, leaseId: workItems.leaseId })
        .from(workItems)
        .where(and(eq(workItems.id, workItemId), eq(workItems.projectId, projectId)))
        .get()
      if (row?.state !== 'leased' || !row.runnerId || !row.leaseId) {
        return null
      }
      const lease = await db
        .select({ state: leases.state, expiresAt: leases.expiresAt })
        .from(leases)
        .where(and(eq(leases.id, row.leaseId), eq(leases.projectId, projectId)))
        .get()
      if (lease?.state !== 'active' || lease.expiresAt <= new Date().toISOString()) {
        return null
      }
      return row.runnerId
    },
  }
}
