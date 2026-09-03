import { DEFAULT_PROJECT_NAME } from '@server/domain/project'
import { newPrimaryKey } from '@server/id'
import {
  type ListPageResult,
  type ProjectListQuery,
  ProjectNameConflictError,
  type ProjectRecord,
  type ProjectRepo,
} from '@server/usecases/ports'
import { and, asc, desc, eq, isNull, lt, notExists, or } from 'drizzle-orm'
import type { drizzle } from 'drizzle-orm/d1'
import {
  agents,
  budgets,
  environments,
  identities,
  memoryStores,
  projects,
  runners,
  sessions,
  triggers,
  vaults,
} from '../../db/schema'

type Db = ReturnType<typeof drizzle>
type ProjectRow = typeof projects.$inferSelect

// organizationId stays in the DB for tenancy but never leaves the record.
function recordFrom(row: ProjectRow): ProjectRecord {
  return { id: row.id, name: row.name, createdAt: row.createdAt, updatedAt: row.updatedAt }
}

function hasNoLiveResources(db: Db, projectId: string) {
  return and(
    notExists(
      db
        .select({ id: agents.id })
        .from(agents)
        .where(and(eq(agents.projectId, projectId), isNull(agents.deletedAt))),
    ),
    notExists(
      db
        .select({ id: budgets.id })
        .from(budgets)
        .where(and(eq(budgets.projectId, projectId), isNull(budgets.deletedAt))),
    ),
    notExists(
      db
        .select({ id: environments.id })
        .from(environments)
        .where(and(eq(environments.projectId, projectId), isNull(environments.deletedAt))),
    ),
    notExists(
      db
        .select({ id: identities.id })
        .from(identities)
        .where(and(eq(identities.projectId, projectId), isNull(identities.deletedAt))),
    ),
    notExists(
      db
        .select({ id: memoryStores.id })
        .from(memoryStores)
        .where(and(eq(memoryStores.projectId, projectId), isNull(memoryStores.deletedAt))),
    ),
    notExists(
      db
        .select({ id: runners.id })
        .from(runners)
        .where(and(eq(runners.projectId, projectId), isNull(runners.deletedAt))),
    ),
    notExists(
      db
        .select({ id: sessions.id })
        .from(sessions)
        .where(and(eq(sessions.projectId, projectId), isNull(sessions.deletedAt))),
    ),
    notExists(
      db
        .select({ id: triggers.id })
        .from(triggers)
        .where(and(eq(triggers.projectId, projectId), isNull(triggers.deletedAt))),
    ),
    notExists(
      db
        .select({ id: vaults.id })
        .from(vaults)
        .where(and(eq(vaults.projectId, projectId), isNull(vaults.managedBy), isNull(vaults.deletedAt))),
    ),
  )
}

function isProjectNameConstraintError(error: unknown): boolean {
  if (
    error instanceof Error &&
    error.message.toLowerCase().includes('unique constraint failed: projects.organization_id, projects.name')
  )
    return true
  if (error && typeof error === 'object' && 'cause' in error) {
    return isProjectNameConstraintError((error as { cause?: unknown }).cause)
  }
  return false
}

export function createProjectRepo(db: Db): ProjectRepo {
  return {
    async list(query: ProjectListQuery): Promise<ListPageResult<ProjectRecord>> {
      const filters = [
        eq(projects.organizationId, query.organizationId),
        isNull(projects.deletedAt),
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
        .where(and(eq(projects.id, projectId), eq(projects.organizationId, organizationId), isNull(projects.deletedAt)))
        .get()
      return row ? recordFrom(row) : null
    },

    async findDefault(organizationId) {
      const row = await db
        .select()
        .from(projects)
        .where(
          and(
            eq(projects.organizationId, organizationId),
            eq(projects.name, DEFAULT_PROJECT_NAME),
            isNull(projects.deletedAt),
          ),
        )
        .orderBy(asc(projects.createdAt), asc(projects.id))
        .get()
      return row ? recordFrom(row) : null
    },

    async ensureDefault(organizationId, timestamp) {
      const row: ProjectRow = {
        id: newPrimaryKey(),
        organizationId,
        name: DEFAULT_PROJECT_NAME,
        deletedAt: null,
        createdAt: timestamp,
        updatedAt: timestamp,
      }
      await db.insert(projects).values(row).onConflictDoNothing()
      const project = await db
        .select()
        .from(projects)
        .where(
          and(
            eq(projects.organizationId, organizationId),
            eq(projects.name, DEFAULT_PROJECT_NAME),
            isNull(projects.deletedAt),
          ),
        )
        .get()
      if (!project) throw new Error('Default project could not be resolved after creation')
      return recordFrom(project)
    },

    async insert(organizationId, name, timestamp) {
      const row: ProjectRow = {
        id: newPrimaryKey(),
        organizationId,
        name,
        deletedAt: null,
        createdAt: timestamp,
        updatedAt: timestamp,
      }
      try {
        await db.insert(projects).values(row)
      } catch (error) {
        if (isProjectNameConstraintError(error)) throw new ProjectNameConflictError(name)
        throw error
      }
      return recordFrom(row)
    },

    async updateName(organizationId, projectId, name, timestamp) {
      try {
        const row = await db
          .update(projects)
          .set({ name, updatedAt: timestamp })
          .where(
            and(eq(projects.id, projectId), eq(projects.organizationId, organizationId), isNull(projects.deletedAt)),
          )
          .returning()
          .get()
        return row ? recordFrom(row) : null
      } catch (error) {
        if (isProjectNameConstraintError(error)) throw new ProjectNameConflictError(name)
        throw error
      }
    },

    async delete(organizationId, projectId) {
      const deletedAt = new Date().toISOString()
      const deleted = await db
        .update(projects)
        .set({ deletedAt, updatedAt: deletedAt })
        .where(
          and(
            eq(projects.id, projectId),
            eq(projects.organizationId, organizationId),
            isNull(projects.deletedAt),
            hasNoLiveResources(db, projectId),
          ),
        )
        .returning({ id: projects.id })
      if (deleted.length > 0) return 'deleted'
      const project = await db
        .select({ id: projects.id })
        .from(projects)
        .where(and(eq(projects.id, projectId), eq(projects.organizationId, organizationId), isNull(projects.deletedAt)))
        .get()
      return project ? 'not_empty' : 'not_found'
    },
  }
}
