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
import { and, desc, eq, gte, isNotNull, isNull, like, lt, lte, or } from 'drizzle-orm'
import type { drizzle } from 'drizzle-orm/d1'
import { memoryStoreMemories, memoryStores } from '../../db/schema'

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
      archivedAt: row.archivedAt,
    }),
    spec: {},
    status: { phase: resourcePhase(row.archivedAt) },
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
        query.archived ? isNotNull(memoryStores.archivedAt) : isNull(memoryStores.archivedAt),
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
        .where(and(eq(memoryStores.id, storeId), eq(memoryStores.projectId, projectId)))
        .get()
      return row ? storeRecordFrom(row) : null
    },

    async insert(input: CreateMemoryStoreInput, createdAt): Promise<MemoryStore> {
      const row = {
        id: newPrimaryKey(),
        projectId: input.projectId,
        name: input.name,
        description: input.description,
        archivedAt: null,
        createdAt,
        updatedAt: createdAt,
      }
      await db.insert(memoryStores).values(row)
      return storeRecordFrom(row)
    },

    async update(projectId, storeId, fields: UpdateMemoryStoreFields, updatedAt) {
      await db
        .update(memoryStores)
        .set({
          name: fields.name,
          description: fields.description,
          archivedAt: fields.archivedAt,
          updatedAt,
        })
        .where(and(eq(memoryStores.id, storeId), eq(memoryStores.projectId, projectId)))
    },

    async listMemories(query: MemoryStoreMemoryListQuery): Promise<ListPageResult<Memory>> {
      const filters = [
        eq(memoryStoreMemories.projectId, query.projectId),
        eq(memoryStoreMemories.storeId, query.storeId),
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
        createdAt,
        updatedAt: createdAt,
      }
      await db.insert(memoryStoreMemories).values(row)
      return memoryRecordFrom(row)
    },

    async updateMemory(projectId, storeId, memoryId, fields: UpdateMemoryStoreMemoryFields, updatedAt) {
      await db
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
          ),
        )
    },

    async deleteMemory(projectId, storeId, memoryId) {
      await db
        .delete(memoryStoreMemories)
        .where(
          and(
            eq(memoryStoreMemories.id, memoryId),
            eq(memoryStoreMemories.storeId, storeId),
            eq(memoryStoreMemories.projectId, projectId),
          ),
        )
    },
  }
}
