import type { ListPageResult, ProjectListQuery, ProjectRecord, ProjectRepo } from '@server/usecases/ports'
import { and, desc, eq, lt, or } from 'drizzle-orm'
import type { drizzle } from 'drizzle-orm/d1'
import { projects } from '../../db/schema'

type Db = ReturnType<typeof drizzle>
type ProjectRow = typeof projects.$inferSelect

function newId(prefix: string) {
  return `${prefix}_${crypto.randomUUID().replaceAll('-', '')}`
}

// organizationId stays in the DB for tenancy but never leaves the record.
function recordFrom(row: ProjectRow): ProjectRecord {
  return { id: row.id, name: row.name, createdAt: row.createdAt, updatedAt: row.updatedAt }
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

    async insert(organizationId, name, timestamp) {
      const row: ProjectRow = {
        id: newId('project'),
        organizationId,
        name,
        createdAt: timestamp,
        updatedAt: timestamp,
      }
      await db.insert(projects).values(row)
      return recordFrom(row)
    },
  }
}
