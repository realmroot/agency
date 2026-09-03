import type { BudgetScope } from '@server/domain/policy'
import { newPrimaryKey } from '@server/id'
import type { BudgetRecord, BudgetRepo, CreateBudgetInput, UpdateBudgetFields } from '@server/usecases/ports'
import { ResourceDeletedDuringMutationError } from '@server/usecases/ports'
import { and, eq, isNull } from 'drizzle-orm'
import type { drizzle } from 'drizzle-orm/d1'
import { budgets } from '../../db/schema'
import { throwIfDeletedParentConstraint } from './soft-delete-constraints'

type Db = ReturnType<typeof drizzle>
type BudgetRow = typeof budgets.$inferSelect

function parseJson<T>(value: string, fallback: T) {
  return value ? (JSON.parse(value) as T) : fallback
}

function recordFrom(row: BudgetRow): BudgetRecord {
  return {
    id: row.id,
    scope: row.scope as BudgetScope,
    providerId: row.providerId,
    modelId: row.modelId,
    limitType: row.limitType as BudgetRecord['limitType'],
    limitValue: row.limitValue,
    window: row.window as BudgetRecord['window'],
    enabled: row.enabled,
    metadata: parseJson<Record<string, unknown>>(row.metadata, {}),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

export function createBudgetRepo(db: Db): BudgetRepo {
  return {
    async list(projectId) {
      const rows = await db
        .select()
        .from(budgets)
        .where(and(eq(budgets.projectId, projectId), isNull(budgets.deletedAt)))
      return rows.map(recordFrom)
    },

    async listEnabled(projectId) {
      const rows = await db
        .select()
        .from(budgets)
        .where(and(eq(budgets.projectId, projectId), eq(budgets.enabled, true), isNull(budgets.deletedAt)))
      return rows.map(recordFrom)
    },

    async find(projectId, budgetId) {
      const row = await db
        .select()
        .from(budgets)
        .where(and(eq(budgets.id, budgetId), eq(budgets.projectId, projectId), isNull(budgets.deletedAt)))
        .get()
      return row ? recordFrom(row) : null
    },

    async insert(input: CreateBudgetInput, timestamp) {
      const row: BudgetRow = {
        id: newPrimaryKey(),
        organizationId: input.organizationId,
        projectId: input.projectId,
        scope: input.scope,
        providerId: input.providerId,
        modelId: input.modelId,
        limitType: input.limitType,
        limitValue: input.limitValue,
        window: input.window,
        enabled: input.enabled,
        metadata: JSON.stringify(input.metadata),
        deletedAt: null,
        createdAt: timestamp,
        updatedAt: timestamp,
      }
      try {
        await db.insert(budgets).values(row)
      } catch (error) {
        throwIfDeletedParentConstraint(error, 'Budget')
        throw error
      }
      return recordFrom(row)
    },

    async update(projectId, budgetId, fields: UpdateBudgetFields, updatedAt) {
      const row = await db
        .update(budgets)
        .set({
          limitValue: fields.limitValue,
          window: fields.window,
          enabled: fields.enabled,
          metadata: JSON.stringify(fields.metadata),
          updatedAt,
        })
        .where(and(eq(budgets.id, budgetId), eq(budgets.projectId, projectId), isNull(budgets.deletedAt)))
        .returning()
        .get()
      if (!row) throw new ResourceDeletedDuringMutationError('Budget')
      return recordFrom(row)
    },

    async delete(projectId, budgetId, deletedAt) {
      await db
        .update(budgets)
        .set({ deletedAt, updatedAt: deletedAt })
        .where(and(eq(budgets.id, budgetId), eq(budgets.projectId, projectId), isNull(budgets.deletedAt)))
    },
  }
}
