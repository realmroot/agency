import type { AuditListQuery, AuditReadRepo, AuditRecord } from '@server/usecases/ports'
import { and, desc, eq, gte, like, lt, lte, or } from 'drizzle-orm'
import type { drizzle } from 'drizzle-orm/d1'
import { auditRecords } from '../../db/schema'

type Db = ReturnType<typeof drizzle>
type AuditRow = typeof auditRecords.$inferSelect

function parseJson<T>(value: string, fallback: T) {
  return value ? (JSON.parse(value) as T) : fallback
}

function recordFrom(row: AuditRow): AuditRecord {
  return {
    id: row.id,
    projectId: row.projectId,
    actorUserId: row.actorUserId,
    controllerUserId: row.controllerUserId,
    // DB text columns constrained to these enums by the audit write path.
    actorType: row.actorType as 'user' | 'agent' | 'system',
    action: row.action,
    resourceType: row.resourceType,
    resourceId: row.resourceId,
    outcome: row.outcome as 'success' | 'failure' | 'denied',
    requestId: row.requestId,
    correlationId: row.correlationId,
    sessionId: row.sessionId,
    policyCategory: row.policyCategory,
    metadata: parseJson<Record<string, unknown>>(row.metadata, {}),
    before: parseJson<Record<string, unknown>>(row.before, {}),
    after: parseJson<Record<string, unknown>>(row.after, {}),
    createdAt: row.createdAt,
  }
}

export function createAuditReadRepo(db: Db): AuditReadRepo {
  return {
    async list(query: AuditListQuery): Promise<AuditRecord[]> {
      const filters = [
        eq(auditRecords.organizationId, query.organizationId),
        query.actorId ? eq(auditRecords.actorUserId, query.actorId) : undefined,
        query.projectId ? eq(auditRecords.projectId, query.projectId) : undefined,
        query.action ? like(auditRecords.action, `%${query.action}%`) : undefined,
        query.resourceType ? eq(auditRecords.resourceType, query.resourceType) : undefined,
        query.resourceId ? eq(auditRecords.resourceId, query.resourceId) : undefined,
        query.outcome ? eq(auditRecords.outcome, query.outcome) : undefined,
        query.from ? gte(auditRecords.createdAt, query.from) : undefined,
        query.to ? lte(auditRecords.createdAt, query.to) : undefined,
        query.cursor
          ? or(
              lt(auditRecords.createdAt, query.cursor.createdAt),
              and(eq(auditRecords.createdAt, query.cursor.createdAt), lt(auditRecords.id, query.cursor.id)),
            )
          : undefined,
      ].filter((filter) => filter !== undefined)
      const rows = await db
        .select()
        .from(auditRecords)
        .where(and(...filters))
        .orderBy(desc(auditRecords.createdAt), desc(auditRecords.id))
      return rows.map(recordFrom)
    },

    async find(organizationId, recordId) {
      const row = await db
        .select()
        .from(auditRecords)
        .where(and(eq(auditRecords.id, recordId), eq(auditRecords.organizationId, organizationId)))
        .get()
      return row ? recordFrom(row) : null
    },
  }
}
