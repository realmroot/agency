import { DEFAULT_PROJECT_NAME } from '@server/domain/project'
import { newPrimaryKey } from '@server/id'
import type { ListPageResult, ProjectListQuery, ProjectRecord, ProjectRepo } from '@server/usecases/ports'
import { and, asc, desc, eq, lt, or } from 'drizzle-orm'
import type { drizzle } from 'drizzle-orm/d1'
import { projects } from '../../db/schema'

type Db = ReturnType<typeof drizzle>
type ProjectRow = typeof projects.$inferSelect

// organizationId stays in the DB for tenancy but never leaves the record.
function recordFrom(row: ProjectRow): ProjectRecord {
  return { id: row.id, name: row.name, createdAt: row.createdAt, updatedAt: row.updatedAt }
}

function isForeignKeyConstraintError(error: unknown): boolean {
  if (error instanceof Error && error.message.toLowerCase().includes('foreign key constraint failed')) return true
  if (error && typeof error === 'object' && 'cause' in error) {
    return isForeignKeyConstraintError((error as { cause?: unknown }).cause)
  }
  return false
}

export function createProjectRepo(db: Db): ProjectRepo {
  return {
    async list(query: ProjectListQuery): Promise<ListPageResult<ProjectRecord>> {
      const filters = [
        eq(projects.organizationId, query.organizationId),
        query.cursor
          ? or(
              lt(projects.createdAt, query.cursor.createdAt),
              and(eq(projects.createdAt, query.cursor.createdAt), lt(projects.id, query.cursor.id)),
            )
          : undefined,
      ].filter((filter) => filter !== undefined)
      const rows = await db
        .select()
        .from(projects)
        .where(and(...filters))
        .orderBy(desc(projects.createdAt), desc(projects.id))
        .limit(query.limit + 1)
      const hasMore = rows.length > query.limit
      return { rows: rows.slice(0, query.limit).map(recordFrom), hasMore }
    },

    async find(organizationId, projectId) {
      const row = await db
        .select()
        .from(projects)
        .where(and(eq(projects.id, projectId), eq(projects.organizationId, organizationId)))
        .get()
      return row ? recordFrom(row) : null
    },

    async findDefault(organizationId) {
      const row = await db
        .select()
        .from(projects)
        .where(and(eq(projects.organizationId, organizationId), eq(projects.name, DEFAULT_PROJECT_NAME)))
        .orderBy(asc(projects.createdAt), asc(projects.id))
        .get()
      return row ? recordFrom(row) : null
    },

    async ensureDefault(organizationId, timestamp) {
      const row: ProjectRow = {
        id: newPrimaryKey(),
        organizationId,
        name: DEFAULT_PROJECT_NAME,
        createdAt: timestamp,
        updatedAt: timestamp,
      }
      await db.insert(projects).values(row).onConflictDoNothing()
      const project = await db
        .select()
        .from(projects)
        .where(and(eq(projects.organizationId, organizationId), eq(projects.name, DEFAULT_PROJECT_NAME)))
        .get()
      if (!project) throw new Error('Default project could not be resolved after creation')
      return recordFrom(project)
    },

    async insert(organizationId, name, timestamp) {
      const row: ProjectRow = {
        id: newPrimaryKey(),
        organizationId,
        name,
        createdAt: timestamp,
        updatedAt: timestamp,
      }
      await db.insert(projects).values(row)
      return recordFrom(row)
    },

    async delete(organizationId, projectId) {
      try {
        const deleted = await db
          .delete(projects)
          .where(and(eq(projects.id, projectId), eq(projects.organizationId, organizationId)))
          .returning({ id: projects.id })
        return deleted.length > 0 ? 'deleted' : 'not_found'
      } catch (error) {
        if (isForeignKeyConstraintError(error)) return 'not_empty'
        throw error
      }
    },
  }
}
