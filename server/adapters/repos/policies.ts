import type { PolicyScopeLevel } from '@server/domain/policy'
import { newPrimaryKey } from '@server/id'
import type {
  CreatePolicyInput,
  PolicyRecord,
  PolicyRepo,
  PolicyScope,
  ReplacePolicyFields,
} from '@server/usecases/ports'
import { and, eq, isNull } from 'drizzle-orm'
import type { drizzle } from 'drizzle-orm/d1'
import { policies } from '../../db/schema'

type Db = ReturnType<typeof drizzle>
type PolicyRow = typeof policies.$inferSelect

function parseJson<T>(value: string, fallback: T) {
  return value ? (JSON.parse(value) as T) : fallback
}

function recordFrom(row: PolicyRow): PolicyRecord {
  return {
    id: row.id,
    projectId: row.projectId,
    scope: {
      level: row.scope as PolicyScopeLevel,
      ...(row.teamId ? { teamId: row.teamId } : {}),
    },
    toolPolicy: parseJson<Record<string, unknown>>(row.toolPolicy, {}),
    mcpPolicy: parseJson<Record<string, unknown>>(row.mcpPolicy, {}),
    sandboxPolicy: parseJson<Record<string, unknown>>(row.sandboxPolicy, {}),
    metadata: parseJson<Record<string, unknown>>(row.metadata, {}),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

export function createPolicyRepo(db: Db): PolicyRepo {
  return {
    async list(projectId) {
      const rows = await db.select().from(policies).where(eq(policies.projectId, projectId))
      return rows.map(recordFrom)
    },

    async find(projectId, policyId) {
      const row = await db
        .select()
        .from(policies)
        .where(and(eq(policies.id, policyId), eq(policies.projectId, projectId)))
        .get()
      return row ? recordFrom(row) : null
    },

    async findByScope(projectId, scope: PolicyScope) {
      const row = await db
        .select()
        .from(policies)
        .where(
          and(
            eq(policies.projectId, projectId),
            eq(policies.scope, scope.level),
            scope.teamId ? eq(policies.teamId, scope.teamId) : isNull(policies.teamId),
          ),
        )
        .get()
      return row ? recordFrom(row) : null
    },

    async insert(input: CreatePolicyInput, timestamp) {
      const row: PolicyRow = {
        id: newPrimaryKey(),
        organizationId: input.organizationId,
        projectId: input.projectId,
        scope: input.scope.level,
        teamId: input.scope.teamId ?? null,
        toolPolicy: JSON.stringify(input.toolPolicy),
        mcpPolicy: JSON.stringify(input.mcpPolicy),
        sandboxPolicy: JSON.stringify(input.sandboxPolicy),
        metadata: JSON.stringify(input.metadata),
        createdAt: timestamp,
        updatedAt: timestamp,
      }
      await db.insert(policies).values(row)
      return recordFrom(row)
    },

    async replace(projectId, policyId, fields: ReplacePolicyFields, updatedAt) {
      const row = await db
        .update(policies)
        .set({
          toolPolicy: JSON.stringify(fields.toolPolicy),
          mcpPolicy: JSON.stringify(fields.mcpPolicy),
          sandboxPolicy: JSON.stringify(fields.sandboxPolicy),
          metadata: JSON.stringify(fields.metadata),
          updatedAt,
        })
        .where(and(eq(policies.id, policyId), eq(policies.projectId, projectId)))
        .returning()
        .get()
      return recordFrom(row)
    },

    async delete(projectId, policyId) {
      await db.delete(policies).where(and(eq(policies.id, policyId), eq(policies.projectId, projectId)))
    },
  }
}
