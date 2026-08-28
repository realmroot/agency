import { describe, expect, it, vi } from 'vitest'
import type { Deps } from './deps'
import type { AuthScope, ProjectRecord } from './ports'
import { createProject, listProjects } from './projects'

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
    name: 'Default project',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

function fakeDeps(repo: Partial<Deps['projects']> = {}): Deps {
  const projects: Deps['projects'] = {
    list: async () => ({ rows: [], hasMore: false }),
    find: async () => null,
    insert: async (_org, name, timestamp) => projectRecord({ name, createdAt: timestamp, updatedAt: timestamp }),
    ...repo,
  }
  return { projects } as unknown as Deps
}

describe('listProjects [spec: projects/lifecycle]', () => {
  it('lazily creates the default project on a first empty page', async () => {
    const insert = vi.fn(async () => projectRecord())
    const page = await listProjects(fakeDeps({ insert }), auth, { limit: 50, cursor: null })
    expect(insert).toHaveBeenCalledOnce()
    expect(page.rows).toHaveLength(1)
    expect(page.rows[0]?.name).toBe('Default project')
  })

  it('does not auto-create when paging past the first page', async () => {
    const insert = vi.fn(async () => projectRecord())
    const page = await listProjects(fakeDeps({ insert }), auth, {
      limit: 50,
      cursor: { createdAt: '2026-01-01T00:00:00.000Z', id: 'project_x' },
    })
    expect(insert).not.toHaveBeenCalled()
    expect(page.rows).toEqual([])
  })

  it('returns the existing page untouched when projects exist', async () => {
    const existing = projectRecord({ id: 'project_existing' })
    const insert = vi.fn(async () => projectRecord())
    const page = await listProjects(
      fakeDeps({ insert, list: async () => ({ rows: [existing], hasMore: false }) }),
      auth,
      { limit: 50, cursor: null },
    )
    expect(insert).not.toHaveBeenCalled()
    expect(page.rows).toEqual([existing])
  })
})

describe('createProject', () => {
  it('inserts a project in the caller organization', async () => {
    const project = await createProject(fakeDeps(), auth, 'Control Plane')
    expect(project.name).toBe('Control Plane')
  })
})
