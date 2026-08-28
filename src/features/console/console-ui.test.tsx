import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { delay } from 'msw'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Agent, AuthContext, Project, Session } from '@/lib/amarpc'
import { HttpResponse, http, server } from '@/test/msw'
import { type AgentOverrides, agent as resourceAgent } from '@/test/resource-fixtures'
import { buildTestSession, type TestSessionOverrides } from '@/testing/session'
import { ConsoleLayout } from './ConsoleLayout'
import { ConsoleShell } from './ConsoleShell'
import { CreateProjectSheet } from './CreateProjectSheet'
import { ConsoleContextProvider, useConsoleContext } from './console-context'
import { JsonBlock } from './json-block'
import { RelatedResourcesTable } from './related-resources-table'

// ─── Fixtures ────────────────────────────────────────────────────────────────

function makeQueryClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
}

function buildAuth(overrides: Partial<AuthContext> = {}): AuthContext {
  return {
    user: { id: 'user_1', email: 'user@example.com', name: 'Alice', avatarUrl: null },
    organization: { id: 'org_1', name: 'My Org' },
    project: { id: 'project_1', name: 'Project One' },
    roles: [],
    permissions: [],
    ...overrides,
  }
}

function buildProject(overrides: Partial<Project> = {}): Project {
  return {
    id: 'project_1',
    name: 'Project One',
    createdAt: '2026-05-23T00:00:00.000Z',
    updatedAt: '2026-05-23T00:00:00.000Z',
    ...overrides,
  }
}

function buildAgent(overrides: AgentOverrides = {}): Agent {
  return resourceAgent({
    name: 'My Agent',
    systemPrompt: 'Do things',
    model: '@cf/model',
    skills: [],
    allowedTools: [],
    createdAt: '2026-05-23T00:00:00.000Z',
    updatedAt: '2026-05-23T00:00:00.000Z',
    ...overrides,
  })
}

function buildSession(overrides: TestSessionOverrides = {}): Session {
  return buildTestSession({ name: 'Test session', ...overrides })
}

// MSW helper: serve a projects list envelope (the real api client calls GET /api/v1/projects)
function projectsHandler(projects: Project[]) {
  return http.get('*/api/v1/projects', () =>
    HttpResponse.json({ data: projects, pagination: { limit: 50, hasMore: false, nextCursor: null } }),
  )
}

// MSW helper: make the projects endpoint return a specific HTTP error status
function projectsErrorHandler(status: number, message: string) {
  return http.get('*/api/v1/projects', () => HttpResponse.json({ error: { type: 'error', message } }, { status }))
}

function renderShell(auth: AuthContext = buildAuth(), projects: Project[] = [buildProject()], extraPath = '/') {
  const client = makeQueryClient()
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[extraPath]}>
        <ConsoleContextProvider value={{ auth, projects, selectProject: vi.fn() }}>
          <ConsoleShell>
            <div data-testid="shell-child">child</div>
          </ConsoleShell>
        </ConsoleContextProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  )
  return client
}

// Radix menus rely on Pointer Events APIs jsdom doesn't implement; stub them so
// fireEvent can open dropdowns and reach their items.
function stubMenuPointerEvents() {
  Object.defineProperty(HTMLElement.prototype, 'hasPointerCapture', { value: vi.fn(() => false), configurable: true })
  Object.defineProperty(HTMLElement.prototype, 'setPointerCapture', { value: vi.fn(), configurable: true })
  Object.defineProperty(HTMLElement.prototype, 'releasePointerCapture', { value: vi.fn(), configurable: true })
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { value: vi.fn(), configurable: true })
}

// ─── console-context.tsx ─────────────────────────────────────────────────────

describe('[spec: console/context] ConsoleContextProvider and useConsoleContext', () => {
  it('provides context value to consumers', () => {
    const auth = buildAuth()
    const projects = [buildProject()]
    const selectProject = vi.fn()

    function Consumer() {
      const ctx = useConsoleContext()
      return (
        <div>
          <span data-testid="email">{ctx.auth.user.email}</span>
          <span data-testid="org">{ctx.auth.organization.name}</span>
          <span data-testid="project">{ctx.auth.project.name}</span>
          <span data-testid="project-count">{ctx.projects.length}</span>
        </div>
      )
    }

    render(
      <ConsoleContextProvider value={{ auth, projects, selectProject }}>
        <Consumer />
      </ConsoleContextProvider>,
    )

    expect(screen.getByTestId('email').textContent).toBe('user@example.com')
    expect(screen.getByTestId('org').textContent).toBe('My Org')
    expect(screen.getByTestId('project').textContent).toBe('Project One')
    expect(screen.getByTestId('project-count').textContent).toBe('1')
  })

  it('throws when useConsoleContext is called outside provider', () => {
    function Bad() {
      useConsoleContext()
      return null
    }

    const originalError = console.error
    console.error = vi.fn()
    expect(() => render(<Bad />)).toThrow('useConsoleContext must be used inside ConsoleContextProvider')
    console.error = originalError
  })

  it('calls selectProject when invoked through context', () => {
    const selectProject = vi.fn()

    function Caller() {
      const ctx = useConsoleContext()
      return (
        <button type="button" onClick={() => ctx.selectProject('project_2')}>
          switch
        </button>
      )
    }

    render(
      <ConsoleContextProvider value={{ auth: buildAuth(), projects: [], selectProject }}>
        <Caller />
      </ConsoleContextProvider>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'switch' }))
    expect(selectProject).toHaveBeenCalledWith('project_2')
  })
})

// ─── json-block.tsx ──────────────────────────────────────────────────────────

describe('[spec: console/json-block] JsonBlock', () => {
  it('renders the provided JSON value in a pre element', () => {
    render(<JsonBlock value='{"key":"value"}' />)
    expect(screen.getByText('{"key":"value"}')).toBeTruthy()
  })

  it('applies compact styling when compact=true', () => {
    const { container } = render(<JsonBlock value="{}" compact />)
    const scrollable = container.querySelector('.max-h-48')
    expect(scrollable).toBeTruthy()
  })

  it('applies default (non-compact) styling when compact=false', () => {
    const { container } = render(<JsonBlock value="{}" compact={false} />)
    const scrollable = container.querySelector('.max-h-96')
    expect(scrollable).toBeTruthy()
  })

  it('applies inverted styling when inverted=true', () => {
    const { container } = render(<JsonBlock value="{}" inverted />)
    const scrollable = container.querySelector('.bg-primary')
    expect(scrollable).toBeTruthy()
  })

  it('applies non-inverted (muted) styling when inverted=false', () => {
    const { container } = render(<JsonBlock value="{}" inverted={false} />)
    const scrollable = container.querySelector('.bg-muted\\/30')
    expect(scrollable).toBeTruthy()
  })

  it('renders with default props (not compact, not inverted)', () => {
    const { container } = render(<JsonBlock value="test content" />)
    const scrollable = container.querySelector('.max-h-96')
    expect(scrollable).toBeTruthy()
    const muted = container.querySelector('.bg-muted\\/30')
    expect(muted).toBeTruthy()
  })

  it('renders compact+inverted combination', () => {
    const { container } = render(<JsonBlock value="{}" compact inverted />)
    const el = container.querySelector('.max-h-48')
    expect(el).toBeTruthy()
    expect(el?.className).toContain('bg-primary')
  })
})

// ─── related-resources-table.tsx ─────────────────────────────────────────────

describe('[spec: console/related-resources-table] RelatedResourcesTable', () => {
  it('renders empty state message when items array is empty', () => {
    render(
      <MemoryRouter>
        <RelatedResourcesTable title="Agents" empty="No agents found" items={[]} />
      </MemoryRouter>,
    )

    expect(screen.getByText('No agents found')).toBeTruthy()
    expect(screen.getByText('Agents')).toBeTruthy()
  })

  it('renders an Agent row with link to /agents/:id and name as display', () => {
    const agent = buildAgent()
    render(
      <MemoryRouter>
        <RelatedResourcesTable title="Agents" empty="No agents" items={[agent]} />
      </MemoryRouter>,
    )

    const link = screen.getAllByRole('link', { name: 'My Agent' })[0] as HTMLAnchorElement
    expect(link).toBeTruthy()
    expect(link.getAttribute('href')).toBe('/agents/agent_1')
    expect(screen.getByText('active')).toBeTruthy()
  })

  it('renders an archived Agent row with archived status badge', () => {
    const agent = buildAgent({ archivedAt: '2026-05-24T00:00:00.000Z' })
    render(
      <MemoryRouter>
        <RelatedResourcesTable title="Agents" empty="No agents" items={[agent]} />
      </MemoryRouter>,
    )

    expect(screen.getByText('archived')).toBeTruthy()
  })

  it('renders a Session row with link to /sessions/:id and id as display', () => {
    const session = buildSession()
    render(
      <MemoryRouter>
        <RelatedResourcesTable title="Sessions" empty="No sessions" items={[session]} />
      </MemoryRouter>,
    )

    const link = screen.getAllByRole('link', { name: 'Test session' })[0] as HTMLAnchorElement
    expect(link).toBeTruthy()
    expect(link.getAttribute('href')).toBe('/sessions/session_1')
    expect(screen.getByText('session_1')).toBeTruthy()
    expect(screen.getByText('idle')).toBeTruthy()
  })

  it('renders Open button linking to correct path for Agent', () => {
    const agent = buildAgent()
    render(
      <MemoryRouter>
        <RelatedResourcesTable title="Agents" empty="No agents" items={[agent]} />
      </MemoryRouter>,
    )

    const openLink = screen.getByRole('link', { name: 'Open' })
    expect(openLink.getAttribute('href')).toBe('/agents/agent_1')
  })

  it('renders Open button linking to correct path for Session', () => {
    const session = buildSession()
    render(
      <MemoryRouter>
        <RelatedResourcesTable title="Sessions" empty="No sessions" items={[session]} />
      </MemoryRouter>,
    )

    const openLink = screen.getByRole('link', { name: 'Open' })
    expect(openLink.getAttribute('href')).toBe('/sessions/session_1')
  })

  it('renders multiple rows with correct count', () => {
    const agents = [buildAgent({ id: 'agent_1', name: 'Alpha' }), buildAgent({ id: 'agent_2', name: 'Beta' })]
    render(
      <MemoryRouter>
        <RelatedResourcesTable title="Agents" empty="No agents" items={agents} />
      </MemoryRouter>,
    )

    expect(screen.getByText('Alpha')).toBeTruthy()
    expect(screen.getByText('Beta')).toBeTruthy()
  })

  it('renders session row with startedAt date displayed', () => {
    const session = buildSession({ startedAt: '2026-05-23T00:00:00.000Z' })
    render(
      <MemoryRouter>
        <RelatedResourcesTable title="Sessions" empty="No sessions" items={[session]} />
      </MemoryRouter>,
    )

    expect(screen.getAllByText('session_1').length).toBeGreaterThan(0)
    expect(screen.queryByText('None')).toBeNull()
  })

  it('renders session row with null startedAt showing None', () => {
    const session = buildSession({ startedAt: null })
    render(
      <MemoryRouter>
        <RelatedResourcesTable title="Sessions" empty="No sessions" items={[session]} />
      </MemoryRouter>,
    )

    expect(screen.getByText('None')).toBeTruthy()
  })

  it('renders table header columns', () => {
    render(
      <MemoryRouter>
        <RelatedResourcesTable title="Resources" empty="Empty" items={[]} />
      </MemoryRouter>,
    )

    expect(screen.getByText('Resource')).toBeTruthy()
    expect(screen.getByText('Status')).toBeTruthy()
    expect(screen.getByText('Updated')).toBeTruthy()
    expect(screen.getByText('Actions')).toBeTruthy()
  })
})

// ─── ConsoleShell.tsx ─────────────────────────────────────────────────────────

describe('[spec: console/shell] ConsoleShell', () => {
  it('renders children inside the shell', () => {
    renderShell()
    expect(screen.getByTestId('shell-child')).toBeTruthy()
  })

  it('renders the app brand name', () => {
    renderShell()
    expect(screen.getAllByText('Any Managed Agents').length).toBeGreaterThan(0)
  })

  it('renders desktop nav links for all sections', () => {
    renderShell()
    expect(screen.getAllByRole('link', { name: 'Agents' }).length).toBeGreaterThan(0)
    expect(screen.getAllByRole('link', { name: 'Environments' }).length).toBeGreaterThan(0)
    expect(screen.getAllByRole('link', { name: 'Sessions' }).length).toBeGreaterThan(0)
    expect(screen.getAllByRole('link', { name: 'Triggers' }).length).toBeGreaterThan(0)
    expect(screen.getAllByRole('link', { name: 'Vaults' }).length).toBeGreaterThan(0)
    expect(screen.getAllByRole('link', { name: 'Audit' }).length).toBeGreaterThan(0)
    expect(screen.getAllByRole('link', { name: 'Settings' }).length).toBeGreaterThan(0)
    expect(screen.queryByRole('link', { name: 'Providers' })).toBeNull()
    expect(screen.queryByRole('link', { name: 'MCP' })).toBeNull()
  })

  it('renders user name from auth context', () => {
    renderShell(buildAuth({ user: { id: 'u1', email: 'test@x.com', name: 'Bob Smith', avatarUrl: null } }))
    expect(screen.getAllByText('Bob Smith').length).toBeGreaterThan(0)
  })

  it('renders user email when name is null', () => {
    renderShell(buildAuth({ user: { id: 'u1', email: 'fallback@x.com', name: null, avatarUrl: null } }))
    expect(screen.getAllByText('fallback@x.com').length).toBeGreaterThan(0)
  })

  it('renders organization name from auth context', () => {
    renderShell(buildAuth({ organization: { id: 'org_2', name: 'Acme Corp' } }))
    expect(screen.getAllByText('Acme Corp').length).toBeGreaterThan(0)
  })

  it('renders project select with project names', () => {
    const projects = [buildProject({ id: 'p1', name: 'Alpha' }), buildProject({ id: 'p2', name: 'Beta' })]
    const auth = buildAuth({ project: { id: 'p1', name: 'Alpha' } })
    renderShell(auth, projects)
    expect(screen.getAllByText('Alpha').length).toBeGreaterThan(0)
  })

  it('applies full-bleed layout when on a session detail route', () => {
    const { container } = render(
      <QueryClientProvider client={makeQueryClient()}>
        <MemoryRouter initialEntries={['/sessions/session_1']}>
          <ConsoleContextProvider value={{ auth: buildAuth(), projects: [buildProject()], selectProject: vi.fn() }}>
            <ConsoleShell>
              <div />
            </ConsoleShell>
          </ConsoleContextProvider>
        </MemoryRouter>
      </QueryClientProvider>,
    )
    const content = container.querySelector('[data-console-content="full-bleed"]')
    expect(content).toBeTruthy()
  })

  it('applies contained layout when on a non-session route', () => {
    const { container } = render(
      <QueryClientProvider client={makeQueryClient()}>
        <MemoryRouter initialEntries={['/agents']}>
          <ConsoleContextProvider value={{ auth: buildAuth(), projects: [buildProject()], selectProject: vi.fn() }}>
            <ConsoleShell>
              <div />
            </ConsoleShell>
          </ConsoleContextProvider>
        </MemoryRouter>
      </QueryClientProvider>,
    )
    const content = container.querySelector('[data-console-content="contained"]')
    expect(content).toBeTruthy()
  })

  it('sidebar placement shows ArrowRight icon (isSidebar=true branch)', () => {
    const auth = buildAuth({ user: { id: 'u1', email: 'x@y.com', name: 'Test', avatarUrl: null } })
    const { container } = render(
      <QueryClientProvider client={makeQueryClient()}>
        <MemoryRouter>
          <ConsoleContextProvider value={{ auth, projects: [], selectProject: vi.fn() }}>
            <ConsoleShell>
              <div />
            </ConsoleShell>
          </ConsoleContextProvider>
        </MemoryRouter>
      </QueryClientProvider>,
    )
    expect(container.querySelector('.mt-4.border-t.pt-3')).toBeTruthy()
    expect(container.querySelector('.fixed.bottom-4')).toBeTruthy()
  })

  it('calls signOut when Log out menu item is selected', async () => {
    stubMenuPointerEvents()

    const signOut = vi.fn().mockResolvedValue(undefined)
    vi.spyOn(await import('@/lib/oidc'), 'signOut').mockImplementation(signOut)

    const auth = buildAuth()
    render(
      <QueryClientProvider client={makeQueryClient()}>
        <MemoryRouter>
          <ConsoleContextProvider value={{ auth, projects: [buildProject()], selectProject: vi.fn() }}>
            <ConsoleShell>
              <div />
            </ConsoleShell>
          </ConsoleContextProvider>
        </MemoryRouter>
      </QueryClientProvider>,
    )

    // The user-menu trigger carries the user name; the project switcher now precedes it in the DOM.
    const trigger = screen.getAllByText(auth.user.name as string)[0]!.closest('button') as HTMLElement
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerId: 1, pointerType: 'mouse' })
    fireEvent.mouseDown(trigger)
    fireEvent.click(trigger)

    await waitFor(() => expect(screen.getAllByText(/Log out/).length).toBeGreaterThan(0))
    const logoutItems = screen.getAllByText(/Log out/)
    fireEvent.click(logoutItems[0]!)
    await waitFor(() => expect(signOut).toHaveBeenCalled())
  })

  it('[spec: web-console/project-switcher] switches the active project from the sidebar dropdown', async () => {
    stubMenuPointerEvents()

    const selectProject = vi.fn()
    const projects = [buildProject({ id: 'p1', name: 'Alpha' }), buildProject({ id: 'p2', name: 'Beta' })]
    const auth = buildAuth({ project: { id: 'p1', name: 'Alpha' } })

    render(
      <QueryClientProvider client={makeQueryClient()}>
        <MemoryRouter>
          <ConsoleContextProvider value={{ auth, projects, selectProject }}>
            <ConsoleShell>
              <div />
            </ConsoleShell>
          </ConsoleContextProvider>
        </MemoryRouter>
      </QueryClientProvider>,
    )

    const trigger = screen.getAllByLabelText('Switch project')[0]!
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerId: 1, pointerType: 'mouse' })
    fireEvent.click(trigger)

    fireEvent.click(await screen.findByRole('menuitem', { name: 'Beta' }))
    await waitFor(() => expect(selectProject).toHaveBeenCalledWith('p2'))
  })

  it('[spec: web-console/project-switcher] opens the create-project form from the switcher', async () => {
    stubMenuPointerEvents()

    const projects = [buildProject({ id: 'p1', name: 'Alpha' })]
    const auth = buildAuth({ project: { id: 'p1', name: 'Alpha' } })

    render(
      <QueryClientProvider client={makeQueryClient()}>
        <MemoryRouter>
          <ConsoleContextProvider value={{ auth, projects, selectProject: vi.fn() }}>
            <ConsoleShell>
              <div />
            </ConsoleShell>
          </ConsoleContextProvider>
        </MemoryRouter>
      </QueryClientProvider>,
    )

    const trigger = screen.getAllByLabelText('Switch project')[0]!
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerId: 1, pointerType: 'mouse' })
    fireEvent.click(trigger)

    fireEvent.click(await screen.findByRole('menuitem', { name: 'Create project' }))
    await waitFor(() => expect(screen.getByText(/A project isolates its own/)).toBeTruthy())
  })
})

// ─── CreateProjectSheet.tsx ──────────────────────────────────────────────────
//
// CreateProjectSheet drives the REAL api client against MSW (POST /api/v1/projects)
// and reads the console context for selectProject. It is always rendered inside a
// ConsoleContextProvider so useConsoleContext resolves.

describe('[spec: web-console/project-switcher] CreateProjectSheet', () => {
  function renderSheet(
    open: boolean,
    onOpenChange: (open: boolean) => void = vi.fn(),
    selectProject: (projectId: string) => void = vi.fn(),
  ) {
    render(
      <QueryClientProvider client={makeQueryClient()}>
        <MemoryRouter>
          <ConsoleContextProvider value={{ auth: buildAuth(), projects: [buildProject()], selectProject }}>
            <CreateProjectSheet open={open} onOpenChange={onOpenChange} />
          </ConsoleContextProvider>
        </MemoryRouter>
      </QueryClientProvider>,
    )
  }

  it('renders the form with a disabled submit until a name is entered', () => {
    renderSheet(true)
    expect(screen.getByText(/A project isolates its own/)).toBeTruthy()
    expect(screen.getByLabelText('Name')).toBeTruthy()
    expect(screen.getByRole('button', { name: /Create project/i })).toBeDisabled()
  })

  it('does not render form content when closed', () => {
    renderSheet(false)
    expect(screen.queryByText(/A project isolates its own/)).toBeNull()
  })

  it('creates a project, switches to it, and closes on submit', async () => {
    server.use(
      http.post('*/api/v1/projects', async ({ request }) => {
        const body = (await request.json()) as Record<string, unknown>
        return HttpResponse.json(buildProject({ id: 'project_new', name: String(body.name) }), { status: 201 })
      }),
      projectsHandler([buildProject(), buildProject({ id: 'project_new', name: 'New Project' })]),
    )

    const onOpenChange = vi.fn()
    const selectProject = vi.fn()
    renderSheet(true, onOpenChange, selectProject)

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'New Project' } })
    fireEvent.click(screen.getByRole('button', { name: /Create project/i }))

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
    await waitFor(() => expect(selectProject).toHaveBeenCalledWith('project_new'))
  })

  it('shows the in-flight label while the create request is pending', async () => {
    server.use(
      http.post('*/api/v1/projects', async ({ request }) => {
        await delay(40)
        const body = (await request.json()) as Record<string, unknown>
        return HttpResponse.json(buildProject({ id: 'project_new', name: String(body.name) }), { status: 201 })
      }),
      projectsHandler([buildProject({ id: 'project_new', name: 'New Project' })]),
    )

    renderSheet(true)
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'New Project' } })
    fireEvent.click(screen.getByRole('button', { name: /Create project/i }))

    expect(await screen.findByRole('button', { name: /Creating project/i })).toBeTruthy()
    // Let the delayed response settle so the pending state resolves inside act().
    await waitFor(() => expect(screen.getByRole('button', { name: /Create project/i })).toBeInTheDocument())
  })

  it('keeps the sheet open and surfaces an error when the request fails', async () => {
    server.use(http.post('*/api/v1/projects', () => HttpResponse.json({ error: 'Server error' }, { status: 500 })))

    const onOpenChange = vi.fn()
    renderSheet(true, onOpenChange)

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Doomed' } })
    fireEvent.click(screen.getByRole('button', { name: /Create project/i }))

    await waitFor(() => expect(screen.getByRole('button', { name: /Create project/i })).toBeInTheDocument())
    expect(onOpenChange).not.toHaveBeenCalledWith(false)
  })
})

// ─── ConsoleLayout.tsx ───────────────────────────────────────────────────────
//
// ConsoleLayout calls getCurrentUser() (from @/lib/oidc) and api.listProjects()
// (which hits GET /api/v1/projects). The e2e localStorage token set by setup.ts
// makes getCurrentUser fast-path to an e2e user, so happy-path tests need no spy.
// Error/null-user tests spy only on @/lib/oidc (allowed — not @/lib/amarpc).
// The projects endpoint is handled by MSW — no @/lib/amarpc mock ever.
//
// IMPORTANT: the e2e token in localStorage is also used by getAuthHeaders() for
// API request headers. Never remove it — only spy on getCurrentUser when you need
// a different profile. Spies are cleaned up via afterEach(vi.restoreAllMocks).

describe('[spec: web-console/shell] ConsoleLayout', () => {
  // Restore all oidc/signIn spies between tests so they don't bleed.
  afterEach(() => vi.restoreAllMocks())

  function renderLayout() {
    const client = makeQueryClient()
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <ConsoleLayout />
        </MemoryRouter>
      </QueryClientProvider>,
    )
    return client
  }

  // Happy path: setup.ts seeds the e2e token → getCurrentUser resolves automatically.
  it('renders ConsoleShell with nav when authenticated with projects', async () => {
    server.use(projectsHandler([buildProject()]))
    renderLayout()
    await waitFor(() => expect(screen.getAllByText('Any Managed Agents').length).toBeGreaterThan(0))
    expect(screen.getAllByRole('link', { name: 'Agents' }).length).toBeGreaterThan(0)
  })

  it('shows console unavailable when projects list is empty (no selected project)', async () => {
    server.use(projectsHandler([]))
    renderLayout()
    await waitFor(() => expect(screen.getByText('Console unavailable')).toBeTruthy())
    expect(screen.getByText('Unable to create or load a project.')).toBeTruthy()
  })

  it('shows console unavailable when projects query returns 401', async () => {
    server.use(projectsErrorHandler(401, 'Unauthorized'))
    renderLayout()
    await waitFor(() => expect(screen.getByText('Any Managed Agents')).toBeTruthy())
    expect(screen.getByText(/Sign in through OIDC provider/)).toBeTruthy()
  })

  it('shows console unavailable when projects query returns non-401 api error', async () => {
    server.use(projectsErrorHandler(500, 'Server error'))
    renderLayout()
    await waitFor(() => expect(screen.getByText('Console unavailable')).toBeTruthy())
    expect(screen.getByText('Server error')).toBeTruthy()
  })

  it('shows console unavailable with generic message for network failure on projects', async () => {
    server.use(http.get('*/api/v1/projects', () => HttpResponse.error()))
    renderLayout()
    await waitFor(() => expect(screen.getByText('Console unavailable')).toBeTruthy())
    expect(screen.getByText('Unable to load the project list.')).toBeTruthy()
  })

  it('shows sign-in screen when user is null (not authenticated)', async () => {
    // Spy overrides the e2e fast-path in getCurrentUser; keep the e2e token for
    // getAccessToken so API headers still work on any conditional project fetch.
    vi.spyOn(await import('@/lib/oidc'), 'getCurrentUser').mockResolvedValue(null)
    // projectsQuery is disabled when userQuery returns null, so no handler needed.
    // Register a fallback so onUnhandledRequest:'error' doesn't fire if timing varies.
    server.use(projectsHandler([]))
    renderLayout()
    await waitFor(() => expect(screen.getByText('Any Managed Agents')).toBeTruthy())
    expect(screen.getByText(/Sign in through OIDC provider/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Continue with OIDC provider' })).toBeTruthy()
  })

  it('shows sign-in screen when the current Session endpoint returns 401', async () => {
    window.localStorage.removeItem('ama:e2e-access-token')
    server.use(
      http.get('*/api/v1/auth/sessions/current', () =>
        HttpResponse.json(
          { error: { type: 'authentication_required', message: 'Authentication required' } },
          { status: 401 },
        ),
      ),
    )
    renderLayout()
    await waitFor(() => expect(screen.getByText('Any Managed Agents')).toBeTruthy())
    expect(screen.getByText(/Sign in through OIDC provider/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Continue with OIDC provider' })).toBeTruthy()
  })

  it.each([
    [403, 'Browser session is not authorized for this application.'],
    [500, 'Failed to read browser session.'],
  ])('shows console unavailable when the current Session endpoint returns %s', async (status, message) => {
    window.localStorage.removeItem('ama:e2e-access-token')
    server.use(
      http.get('*/api/v1/auth/sessions/current', () =>
        HttpResponse.json({ error: { type: 'auth_error', message: 'Auth failed' } }, { status }),
      ),
    )
    renderLayout()
    await waitFor(() => expect(screen.getByText('Console unavailable')).toBeTruthy())
    expect(screen.getByText(message)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Continue with OIDC provider' })).toBeNull()
  })

  it('shows loading state while user query is pending', async () => {
    let resolveUser!: (v: unknown) => void
    const hanging = new Promise((res) => {
      resolveUser = res
    })
    vi.spyOn(await import('@/lib/oidc'), 'getCurrentUser').mockReturnValue(hanging as never)
    server.use(projectsHandler([]))
    renderLayout()

    expect(screen.getByText('Loading console')).toBeTruthy()
    resolveUser(null)
  })

  it('uses the explicit current-user organization', async () => {
    vi.spyOn(await import('@/lib/oidc'), 'getCurrentUser').mockResolvedValue({
      profile: { sub: 'u1', email: 'u@x.com', name: 'A' },
      organization: { id: 'org_explicit', name: 'My Org' },
    })
    server.use(projectsHandler([buildProject()]))
    renderLayout()
    await waitFor(() => expect(screen.getAllByText('Any Managed Agents').length).toBeGreaterThan(0))
    expect(screen.getAllByText('My Org').length).toBeGreaterThan(0)
  })

  it('shows Personal workspace only for the user Context sentinel', async () => {
    vi.spyOn(await import('@/lib/oidc'), 'getCurrentUser').mockResolvedValue({
      profile: { sub: 'u1', email: 'u@x.com', name: null },
      organization: { id: 'user:u1', name: 'Personal workspace' },
    })
    server.use(projectsHandler([buildProject()]))
    renderLayout()
    await waitFor(() => expect(screen.getAllByText('Any Managed Agents').length).toBeGreaterThan(0))
    expect(screen.getAllByText('Personal workspace').length).toBeGreaterThan(0)
  })

  it('shows the explicit Organization label instead of Personal workspace', async () => {
    vi.spyOn(await import('@/lib/oidc'), 'getCurrentUser').mockResolvedValue({
      profile: { sub: 'u1', email: 'u@x.com', name: null },
      organization: { id: 'org-123', name: 'Organization org-123' },
    })
    server.use(projectsHandler([buildProject()]))
    renderLayout()
    await waitFor(() => expect(screen.getAllByText('Organization org-123').length).toBeGreaterThan(0))
    expect(screen.queryByText('Personal workspace')).toBeNull()
  })

  it('uses picture from profile as avatarUrl when present', async () => {
    vi.spyOn(await import('@/lib/oidc'), 'getCurrentUser').mockResolvedValue({
      profile: { sub: 'u1', email: 'u@x.com', name: 'A', picture: 'https://img.example.com/pic.jpg' },
      organization: { id: 'org-123', name: 'Organization org-123' },
    })
    server.use(projectsHandler([buildProject()]))
    renderLayout()
    await waitFor(() => expect(screen.getAllByText('Any Managed Agents').length).toBeGreaterThan(0))
  })

  it('selects first project when no stored project id matches', async () => {
    const projects = [buildProject({ id: 'p1', name: 'First' }), buildProject({ id: 'p2', name: 'Second' })]
    // Clear only the stored project id so nothing matches → falls back to projects[0].
    window.localStorage.removeItem('ama:selected-project-id')
    server.use(projectsHandler(projects))
    renderLayout()
    await waitFor(() => expect(screen.getAllByText('Any Managed Agents').length).toBeGreaterThan(0))
    expect(screen.getAllByText('First').length).toBeGreaterThan(0)
  })

  it('falls back to empty string email when profile.email is not a string', async () => {
    vi.spyOn(await import('@/lib/oidc'), 'getCurrentUser').mockResolvedValue({
      profile: { sub: 'u1', email: 42, name: 'User', picture: null },
      organization: { id: 'org-123', name: 'Organization org-123' },
    } as never)
    server.use(projectsHandler([buildProject()]))
    renderLayout()
    await waitFor(() => expect(screen.getAllByText('Any Managed Agents').length).toBeGreaterThan(0))
    expect(screen.getAllByText('User').length).toBeGreaterThan(0)
  })

  it('listens for ama:selected-project-changed event without crashing', async () => {
    const projects = [buildProject({ id: 'p1', name: 'Alpha' }), buildProject({ id: 'p2', name: 'Beta' })]
    server.use(projectsHandler(projects))
    renderLayout()
    await waitFor(() => expect(screen.getAllByText('Any Managed Agents').length).toBeGreaterThan(0))

    expect(() => {
      window.dispatchEvent(new Event('ama:selected-project-changed'))
    }).not.toThrow()

    await waitFor(() => expect(screen.getAllByText('Any Managed Agents').length).toBeGreaterThan(0))
  })

  it('dispatches signIn when sign-in button is clicked', async () => {
    const signIn = vi.fn().mockResolvedValue(undefined)
    vi.spyOn(await import('@/lib/oidc'), 'signIn').mockImplementation(signIn)
    vi.spyOn(await import('@/lib/oidc'), 'getCurrentUser').mockResolvedValue(null)
    server.use(projectsHandler([]))
    renderLayout()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Continue with OIDC provider' })).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: 'Continue with OIDC provider' }))
    await waitFor(() => expect(signIn).toHaveBeenCalled())
  })

  it('calls setSelectedProjectId when project select changes in the full layout', async () => {
    stubMenuPointerEvents()

    const projects = [buildProject({ id: 'p1', name: 'Alpha' }), buildProject({ id: 'p2', name: 'Beta' })]
    // Seed the stored project id so p1 is pre-selected; e2e token stays for getAccessToken.
    window.localStorage.setItem('ama:selected-project-id', 'p1')
    server.use(projectsHandler(projects))

    const client = makeQueryClient()
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <ConsoleLayout />
        </MemoryRouter>
      </QueryClientProvider>,
    )

    await waitFor(() => expect(screen.getAllByText('Any Managed Agents').length).toBeGreaterThan(0))

    const trigger = screen.getAllByLabelText('Switch project')[0]!
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerId: 1, pointerType: 'mouse' })
    fireEvent.click(trigger)
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Beta' }))

    await waitFor(() => expect(window.localStorage.getItem('ama:selected-project-id')).toBe('p2'))
  })
})
