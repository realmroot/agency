import { describe, expect, it, vi } from 'vitest'
import type { Deps } from './deps'
import { type AuthScope, type ProjectRecord, ProjectReservedNameError } from './ports'
import { createProject, deleteProject, listProjects } from './projects'

const auth: AuthScope = {
  organization: { id: 'org_1', name: 'Org' },
  project: { id: 'project_1', name: 'Project' },
  user: { id: 'user_1' },
  roles: [],
  permissions: [],
}

function projectRecord(overrides: Partial<ProjectRecord> = {}): ProjectRecord {
  return {
    id: 'project_1',
    name: 'Default',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

function fakeDeps(repo: Partial<Deps['projects']> = {}): Deps {
  const projects: Deps['projects'] = {
    list: async () => ({ rows: [], hasMore: false }),
    find: async () => null,
    findDefault: async () => null,
    ensureDefault: async () => projectRecord(),
    insert: async (_org, name, timestamp) => projectRecord({ name, createdAt: timestamp, updatedAt: timestamp }),
    delete: async () => 'not_found',
    ...repo,
  }
  return { projects } as unknown as Deps
}

describe('listProjects [spec: projects/lifecycle]', () => {
  it('ensures the default project before a first unpaged list when custom projects already exist', async () => {
    const custom = projectRecord({ id: 'project_custom', name: 'Control Plane' })
    const ensured = projectRecord()
    const ensureDefault = vi.fn(async () => ensured)
    const page = await listProjects(
      fakeDeps({
        ensureDefault,
        list: async () => ({ rows: [custom, ensured], hasMore: false }),
      }),
      auth,
      { limit: 50, cursor: null },
    )

    expect(ensureDefault).toHaveBeenCalledWith('org_1', expect.any(String))
    expect(page.rows).toEqual([custom, ensured])
  })

  it('does not ensure the default when paging past the first page', async () => {
    const ensureDefault = vi.fn(async () => projectRecord())
    const page = await listProjects(fakeDeps({ ensureDefault }), auth, {
      limit: 50,
      cursor: { createdAt: '2026-01-01T00:00:00.000Z', id: 'project_x' },
    })
    expect(ensureDefault).not.toHaveBeenCalled()
    expect(page.rows).toEqual([])
  })
})

describe('createProject', () => {
  it('ensures the default before inserting a custom project in the caller organization', async () => {
    const operations: string[] = []
    let ensuredAt: string | null = null
    let insertedAt: string | null = null
    const ensureDefault = vi.fn(async (_organizationId: string, timestamp: string) => {
      operations.push('ensureDefault')
      ensuredAt = timestamp
      return projectRecord()
    })
    const insert = vi.fn(async (_organizationId: string, name: string, timestamp: string) => {
      operations.push('insert')
      insertedAt = timestamp
      return projectRecord({ id: 'project_custom', name })
    })

    const project = await createProject(fakeDeps({ ensureDefault, insert }), auth, 'Control Plane')

    expect(project.name).toBe('Control Plane')
    expect(operations).toEqual(['ensureDefault', 'insert'])
    expect(ensureDefault).toHaveBeenCalledWith('org_1', expect.any(String))
    expect(insert).toHaveBeenCalledWith('org_1', 'Control Plane', expect.any(String))
    expect(insertedAt).toBe(ensuredAt)
  })

  it('rejects the reserved Default name without ensuring or inserting', async () => {
    const ensureDefault = vi.fn(async () => projectRecord())
    const insert = vi.fn(async () => projectRecord())

    await expect(createProject(fakeDeps({ ensureDefault, insert }), auth, 'Default')).rejects.toBeInstanceOf(
      ProjectReservedNameError,
    )
    expect(ensureDefault).not.toHaveBeenCalled()
    expect(insert).not.toHaveBeenCalled()
  })
})

describe('deleteProject', () => {
  it('deletes a non-default project through the caller organization boundary', async () => {
    let deletedScope: [string, string] | null = null
    const result = await deleteProject(
      fakeDeps({
        find: async () => projectRecord({ id: 'project_2', name: 'Workspace' }),
        findDefault: async () => projectRecord({ id: 'project_1' }),
        delete: async (organizationId, projectId) => {
          deletedScope = [organizationId, projectId]
          return 'deleted'
        },
      }),
      auth,
      'project_2',
    )

    expect(result).toBe('deleted')
    expect(deletedScope).toEqual(['org_1', 'project_2'])
  })

  it('protects the default project from deletion', async () => {
    const remove = vi.fn(async () => 'deleted' as const)

    const result = await deleteProject(
      fakeDeps({ find: async () => projectRecord(), findDefault: async () => projectRecord(), delete: remove }),
      auth,
      'project_1',
    )

    expect(result).toBe('default_project')
    expect(remove).not.toHaveBeenCalled()
  })
})
