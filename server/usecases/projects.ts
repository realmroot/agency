import { DEFAULT_PROJECT_NAME } from '../domain/project'
import type { Deps } from './deps'
import {
  type OrgScope,
  type ProjectDeleteResult,
  type ProjectListQuery,
  type ProjectRecord,
  ProjectReservedNameError,
} from './ports'

// Lists projects in the caller's organization. Every organization always has at
// least its default project, so a first, unpaged, empty page lazily creates it.
export async function listProjects(
  deps: Deps,
  auth: OrgScope,
  query: Omit<ProjectListQuery, 'organizationId'>,
): Promise<{ rows: ProjectRecord[]; hasMore: boolean }> {
  if (!query.cursor) {
    await deps.projects.ensureDefault(auth.organization.id, new Date().toISOString())
  }
  return deps.projects.list({ organizationId: auth.organization.id, ...query })
}

export async function createProject(deps: Deps, auth: OrgScope, name: string): Promise<ProjectRecord> {
  if (name === DEFAULT_PROJECT_NAME) throw new ProjectReservedNameError()
  const timestamp = new Date().toISOString()
  await deps.projects.ensureDefault(auth.organization.id, timestamp)
  return deps.projects.insert(auth.organization.id, name, timestamp)
}

export async function deleteProject(deps: Deps, auth: OrgScope, projectId: string): Promise<ProjectDeleteResult> {
  const project = await deps.projects.find(auth.organization.id, projectId)
  if (!project) return 'not_found'
  const defaultProject = await deps.projects.findDefault(auth.organization.id)
  if (defaultProject?.id === project.id) return 'default_project'
  return deps.projects.delete(auth.organization.id, projectId)
}
