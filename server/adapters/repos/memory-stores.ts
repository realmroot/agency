import type { Memory, MemoryStore } from '@server/domain/memory-store'
import { resourceMetadata, resourcePhase } from '@server/domain/resource'
import { newPrimaryKey } from '@server/id'
import type {
  CreateMemoryStoreInput,
  CreateMemoryStoreMemoryInput,
  ListPageResult,
  MemoryStoreListQuery,
  MemoryStoreMemoryListQuery,
  MemoryStoreRepo,
  UpdateMemoryStoreFields,
  UpdateMemoryStoreMemoryFields,
} from '@server/usecases/ports'
import { ResourceDeletedDuringMutationError } from '@server/usecases/ports'
import { and, desc, eq, gte, isNull, like, lt, lte, or } from 'drizzle-orm'
import type { drizzle } from 'drizzle-orm/d1'
import { memoryStoreMemories, memoryStores } from '../../db/schema'
import { throwIfDeletedParentConstraint } from './soft-delete-constraints'

type Db = ReturnType<typeof drizzle>
type MemoryStoreRow = typeof memoryStores.$inferSelect
type MemoryRow = typeof memoryStoreMemories.$inferSelect

function parseJson<T>(value: string) {
  return JSON.parse(value) as T
}

function stringify(value: unknown) {
  return JSON.stringify(value)
}

function storeRecordFrom(row: MemoryStoreRow): MemoryStore {
  return {
    metadata: resourceMetadata({
      uid: row.id,
      pid: row.projectId,
      name: row.name,
      description: row.description,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      deletedAt: row.deletedAt,
    }),
    spec: {},
    status: { phase: resourcePhase(row.deletedAt) },
  }
}

function memoryRecordFrom(row: MemoryRow): Memory {
  return {
    metadata: resourceMetadata({
      uid: row.id,
      pid: row.projectId,
      name: row.path,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    }),
    spec: {
      storeId: row.storeId,
      path: row.path,
      content: row.content,
      metadata: parseJson<Record<string, unknown>>(row.metadata),
    },
    status: { phase: 'active' },
  }
}

export function createMemoryStoreRepo(db: Db): MemoryStoreRepo {
  return {
    async list(query: MemoryStoreListQuery): Promise<ListPageResult<MemoryStore>> {
      const filters = [
        eq(memoryStores.projectId, query.projectId),
        isNull(memoryStores.deletedAt),
        query.search ? like(memoryStores.name, `%${query.search}%`) : undefined,
        query.createdFrom ? gte(memoryStores.createdAt, query.createdFrom) : undefined,
        query.createdTo ? lte(memoryStores.createdAt, query.createdTo) : undefined,
        query.cursor
          ? or(
              lt(memoryStores.createdAt, query.cursor.createdAt),
              and(eq(memoryStores.createdAt, query.cursor.createdAt), lt(memoryStores.id, query.cursor.id)),
            )
          : undefined,
      ].filter((filter) => filter !== undefined)
      const rows = await db
        .select()
        .from(memoryStores)
        .where(and(...filters))
        .orderBy(desc(memoryStores.createdAt), desc(memoryStores.id))
        .limit(query.limit + 1)
      return { rows: rows.slice(0, query.limit).map(storeRecordFrom), hasMore: rows.length > query.limit }
    },

    async find(projectId, storeId) {
      const row = await db
        .select()
        .from(memoryStores)
        .where(and(eq(memoryStores.id, storeId), eq(memoryStores.projectId, projectId), isNull(memoryStores.deletedAt)))
        .get()
      return row ? storeRecordFrom(row) : null
    },

    async insert(input: CreateMemoryStoreInput, createdAt): Promise<MemoryStore> {
      const row = {
        id: newPrimaryKey(),
        projectId: input.projectId,
        name: input.name,
        description: input.description,
        deletedAt: null,
        createdAt,
        updatedAt: createdAt,
      }
      try {
        await db.insert(memoryStores).values(row)
      } catch (error) {
        throwIfDeletedParentConstraint(error, 'Memory store')
        throw error
      }
      return storeRecordFrom(row)
    },

    async update(projectId, storeId, fields: UpdateMemoryStoreFields, updatedAt) {
      const updated = await db
        .update(memoryStores)
        .set({
          name: fields.name,
          description: fields.description,
          updatedAt,
        })
        .where(and(eq(memoryStores.id, storeId), eq(memoryStores.projectId, projectId), isNull(memoryStores.deletedAt)))
        .returning({ id: memoryStores.id })
      if (updated.length === 0) throw new ResourceDeletedDuringMutationError('Memory store')
    },

    async delete(projectId, storeId, deletedAt) {
      const [stores] = await db.batch([
        db
          .update(memoryStores)
          .set({ deletedAt, updatedAt: deletedAt })
          .where(
            and(eq(memoryStores.id, storeId), eq(memoryStores.projectId, projectId), isNull(memoryStores.deletedAt)),
          )
          .returning({ id: memoryStores.id }),
        db
          .update(memoryStoreMemories)
          .set({ deletedAt, updatedAt: deletedAt })
          .where(
            and(
              eq(memoryStoreMemories.storeId, storeId),
              eq(memoryStoreMemories.projectId, projectId),
              isNull(memoryStoreMemories.deletedAt),
            ),
          ),
      ])
      return stores.length > 0
    },

    async listMemories(query: MemoryStoreMemoryListQuery): Promise<ListPageResult<Memory>> {
      const filters = [
        eq(memoryStoreMemories.projectId, query.projectId),
        eq(memoryStoreMemories.storeId, query.storeId),
        isNull(memoryStoreMemories.deletedAt),
        query.cursor
          ? or(
              lt(memoryStoreMemories.createdAt, query.cursor.createdAt),
              and(
                eq(memoryStoreMemories.createdAt, query.cursor.createdAt),
                lt(memoryStoreMemories.id, query.cursor.id),
              ),
            )
          : undefined,
      ].filter((filter) => filter !== undefined)
      const rows = await db
        .select()
        .from(memoryStoreMemories)
        .where(and(...filters))
        .orderBy(desc(memoryStoreMemories.createdAt), desc(memoryStoreMemories.id))
        .limit(query.limit + 1)
      return { rows: rows.slice(0, query.limit).map(memoryRecordFrom), hasMore: rows.length > query.limit }
    },

    async findMemory(projectId, storeId, memoryId) {
      const row = await db
        .select()
        .from(memoryStoreMemories)
        .where(
          and(
            eq(memoryStoreMemories.id, memoryId),
            eq(memoryStoreMemories.storeId, storeId),
            eq(memoryStoreMemories.projectId, projectId),
            isNull(memoryStoreMemories.deletedAt),
          ),
        )
        .get()
      return row ? memoryRecordFrom(row) : null
    },

    async insertMemory(input: CreateMemoryStoreMemoryInput, createdAt): Promise<Memory> {
      const row = {
        id: newPrimaryKey(),
        storeId: input.storeId,
        projectId: input.projectId,
        path: input.path,
        content: input.content,
        metadata: stringify(input.metadata),
        deletedAt: null,
        createdAt,
        updatedAt: createdAt,
      }
      try {
        await db.insert(memoryStoreMemories).values(row)
      } catch (error) {
        throwIfDeletedParentConstraint(error, 'Memory')
        throw error
      }
      return memoryRecordFrom(row)
    },

    async updateMemory(projectId, storeId, memoryId, fields: UpdateMemoryStoreMemoryFields, updatedAt) {
      const updated = await db
        .update(memoryStoreMemories)
        .set({
          path: fields.path,
          content: fields.content,
          metadata: stringify(fields.metadata),
          updatedAt,
        })
        .where(
          and(
            eq(memoryStoreMemories.id, memoryId),
            eq(memoryStoreMemories.storeId, storeId),
            eq(memoryStoreMemories.projectId, projectId),
            isNull(memoryStoreMemories.deletedAt),
          ),
        )
        .returning({ id: memoryStoreMemories.id })
      if (updated.length === 0) throw new ResourceDeletedDuringMutationError('Memory')
    },

    async deleteMemory(projectId, storeId, memoryId, deletedAt) {
      await db
        .update(memoryStoreMemories)
        .set({ deletedAt, updatedAt: deletedAt })
        .where(
          and(
            eq(memoryStoreMemories.id, memoryId),
            eq(memoryStoreMemories.storeId, storeId),
            eq(memoryStoreMemories.projectId, projectId),
            isNull(memoryStoreMemories.deletedAt),
          ),
        )
    },
  }
}
