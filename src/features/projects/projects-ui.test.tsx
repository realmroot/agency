import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { toast } from 'sonner'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AuthContext, Project } from '@/lib/enborrpc'
import { createCollection, HttpResponse, http, resourceHandlers, server } from '@/test/msw'
import { ConsoleContextProvider } from '../console/console-context'
import { ProjectsPage } from './ProjectsPage'

const timestamp = '2026-09-03T00:00:00.000Z'

function project(id: string, name: string): Project {
  return { id, name, createdAt: timestamp, updatedAt: timestamp }
}

function renderPage(projects: Project[], activeProject: Project = project('project_default', 'Default')) {
  const collection = createCollection(projects)
  server.use(
    ...resourceHandlers('projects', collection, (body, index) =>
      project(`project_${index}`, String(body.name ?? 'Project')),
    ),
  )
  const auth: AuthContext = {
    user: { id: 'user_1', email: 'user@example.com', name: 'User', avatarUrl: null },
    organization: { id: 'org_1', name: 'Organization' },
    project: { id: activeProject.id, name: activeProject.name },
    roles: [],
    permissions: [],
  }
  const selectProject = vi.fn()
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}
    >
      <MemoryRouter>
        <ConsoleContextProvider value={{ auth, projects, selectProject }}>
          <ProjectsPage />
        </ConsoleContextProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  )
  return { collection, selectProject }
}

describe('[spec: web-console/project-management] ProjectsPage', () => {
  afterEach(() => vi.restoreAllMocks())

  it('renders the empty organization state', async () => {
    renderPage([])

    expect(await screen.findByText('No projects')).toBeTruthy()
    expect(screen.getByText('Create a project from the project switcher.')).toBeTruthy()
  })

  it('lists organization projects without rename or delete actions for Default', async () => {
    renderPage([project('project_default', 'Default'), project('project_workspace', 'Workspace')])

    expect(await screen.findByRole('heading', { name: 'Project management' })).toBeTruthy()
    expect(await screen.findByText('Workspace')).toBeTruthy()
    expect(screen.getAllByText('Default').length).toBeGreaterThan(0)
    expect(screen.getByText('Managed')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Rename Default' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Delete Default' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Rename Workspace' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Delete Workspace' })).toBeTruthy()
  })

  it('keeps ordinary project actions semantically available at a narrow viewport', async () => {
    const originalWidth = window.innerWidth
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 320 })
    window.dispatchEvent(new Event('resize'))

    try {
      renderPage([project('project_default', 'Default'), project('project_workspace', 'Workspace')])

      expect(await screen.findByRole('columnheader', { name: 'Actions' })).toBeTruthy()
      expect(screen.getByRole('button', { name: 'Rename Workspace' })).toBeTruthy()
      expect(screen.getByRole('button', { name: 'Delete Workspace' })).toBeTruthy()
    } finally {
      Object.defineProperty(window, 'innerWidth', { configurable: true, value: originalWidth })
      window.dispatchEvent(new Event('resize'))
    }
  })

  it('renames through a secondary form and confirms deletion before refreshing the list', async () => {
    const defaultProject = project('project_default', 'Default')
    const workspace = project('project_workspace', 'Workspace')
    const { collection, selectProject } = renderPage([defaultProject, workspace], workspace)
    await screen.findByText('Workspace')

    fireEvent.click(screen.getByRole('button', { name: 'Rename Workspace' }))
    const renameSheet = await screen.findByRole('dialog')
    expect(within(renameSheet).getByRole('heading', { name: 'Rename project' })).toBeTruthy()
    fireEvent.change(within(renameSheet).getByLabelText('Name'), { target: { value: 'Renamed workspace' } })
    fireEvent.click(within(renameSheet).getByRole('button', { name: 'Rename project' }))

    expect(await screen.findByText('Renamed workspace')).toBeTruthy()
    expect(collection.get('project_workspace')?.name).toBe('Renamed workspace')

    fireEvent.click(screen.getByRole('button', { name: 'Delete Renamed workspace' }))
    expect(collection.get('project_workspace')).toBeTruthy()
    await waitFor(() => expect(screen.getByText('Delete project?')).toBeTruthy())
    const confirmation = screen.getAllByRole('button', { name: 'Delete project', hidden: true }).at(-1)!
    fireEvent.click(confirmation)

    await waitFor(() => expect(collection.get('project_workspace')).toBeUndefined())
    expect(selectProject).toHaveBeenCalledWith('project_default')
    await waitFor(() => expect(screen.queryByText('Renamed workspace')).toBeNull())
  })

  it('does not switch projects after deleting an inactive project', async () => {
    const { selectProject } = renderPage([
      project('project_default', 'Default'),
      project('project_workspace', 'Workspace'),
    ])
    await screen.findByText('Workspace')

    fireEvent.click(screen.getByRole('button', { name: 'Delete Workspace' }))
    await waitFor(() => expect(screen.getByText('Delete project?')).toBeTruthy())
    const confirmation = screen.getAllByRole('button', { name: 'Delete project', hidden: true }).at(-1)!
    fireEvent.click(confirmation)

    await waitFor(() => expect(screen.queryByText('Workspace')).toBeNull())
    expect(selectProject).not.toHaveBeenCalled()
  })

  it('keeps the rename sheet open on a conflict and allows it to be closed', async () => {
    const errorSpy = vi.spyOn(toast, 'error').mockImplementation(() => 'toast-id')
    renderPage([project('project_default', 'Default'), project('project_workspace', 'Workspace')])
    await screen.findByText('Workspace')
    server.use(
      http.patch('*/api/v1/projects/:projectId', () =>
        HttpResponse.json(
          {
            error: {
              type: 'conflict',
              message: 'A project named "Existing" already exists in this organization',
            },
          },
          { status: 409 },
        ),
      ),
    )

    fireEvent.click(screen.getByRole('button', { name: 'Rename Workspace' }))
    const renameSheet = await screen.findByRole('dialog')
    fireEvent.change(within(renameSheet).getByLabelText('Name'), { target: { value: 'Existing' } })
    fireEvent.click(within(renameSheet).getByRole('button', { name: 'Rename project' }))

    await waitFor(() =>
      expect(errorSpy).toHaveBeenCalledWith('A project named "Existing" already exists in this organization'),
    )
    expect(screen.getByRole('dialog')).toBeTruthy()
    fireEvent.click(within(renameSheet).getByRole('button', { name: 'Close' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('reports delete failures without removing the project', async () => {
    const errorSpy = vi.spyOn(toast, 'error').mockImplementation(() => 'toast-id')
    const { collection } = renderPage([
      project('project_default', 'Default'),
      project('project_workspace', 'Workspace'),
    ])
    await screen.findByText('Workspace')
    server.use(
      http.delete('*/api/v1/projects/:projectId', () =>
        HttpResponse.json({ error: { type: 'conflict', message: 'Project is not empty' } }, { status: 409 }),
      ),
    )

    fireEvent.click(screen.getByRole('button', { name: 'Delete Workspace' }))
    await waitFor(() => expect(screen.getByText('Delete project?')).toBeTruthy())
    const confirmation = screen.getAllByRole('button', { name: 'Delete project', hidden: true }).at(-1)!
    fireEvent.click(confirmation)

    await waitFor(() => expect(errorSpy).toHaveBeenCalledWith('Project is not empty'))
    expect(collection.get('project_workspace')).toBeTruthy()
    expect(screen.getByText('Workspace')).toBeTruthy()
  })
})
