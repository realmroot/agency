import { DEFAULT_PROJECT_NAME } from '../domain/project'
import type { Deps } from './deps'
import type { OrgScope, ProjectListQuery, ProjectRecord } from './ports'

// Lists projects in the caller's organization. Every organization always has at
// least its default project, so a first, unpaged, empty page lazily creates it.
export async function listProjects(
  deps: Deps,
  auth: OrgScope,
  query: Omit<ProjectListQuery, 'organizationId'>,
): Promise<{ rows: ProjectRecord[]; hasMore: boolean }> {
  const page = await deps.projects.list({ organizationId: auth.organization.id, ...query })
  if (page.rows.length === 0 && !query.cursor) {
    const created = await deps.projects.insert(auth.organization.id, DEFAULT_PROJECT_NAME, new Date().toISOString())
    return { rows: [created], hasMore: false }
  }
  return page
}

export async function createProject(deps: Deps, auth: OrgScope, name: string): Promise<ProjectRecord> {
  return deps.projects.insert(auth.organization.id, name, new Date().toISOString())
}
