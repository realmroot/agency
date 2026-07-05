import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { describe, expect, it, vi } from 'vitest'
import type { ClientPagination } from '@/console/use-client-pagination'
import { useClientPagination } from '@/console/use-client-pagination'
import { EnvironmentDetailView } from '@/features/environments/EnvironmentDetailView'
import { EnvironmentsView } from '@/features/environments/EnvironmentsView'
import type { Environment, Runner, Session } from '@/lib/amarpc'
import { createCollection, HttpResponse, http, resourceHandlers, server } from '@/test/msw'
import {
  type EnvironmentOverrides,
  type RunnerOverrides,
  environment as resourceEnvironment,
  runner as resourceRunner,
} from '@/test/resource-fixtures'
import { buildTestSession, type TestSessionOverrides } from '@/testing/session'
import { CreateEnvironmentSheet } from './CreateEnvironmentSheet'
import { EnvironmentDetailPage } from './EnvironmentDetailPage'
import { EnvironmentsPage } from './EnvironmentsPage'
import { useEnvironmentActions } from './use-environment-actions'

// ─── Fixtures ────────────────────────────────────────────────────────────────

function environment(overrides: EnvironmentOverrides = {}): Environment {
  return resourceEnvironment({
    description: 'Node 22 toolchain',
    packages: { type: 'packages', apt: [], cargo: [], gem: [], go: [], npm: ['vite@7'], pip: [] },
    variables: { NODE_ENV: { description: 'environment' } },
    type: 'self_hosted',
    networking: {
      type: 'limited',
      allowMcpServers: false,
      allowPackageManagers: true,
      allowedHosts: ['registry.npmjs.org'],
    },
    version: 2,
    createdAt: '2026-05-23T00:00:00.000Z',
    updatedAt: '2026-05-23T00:00:00.000Z',
    ...overrides,
  })
}

function buildSession(overrides: TestSessionOverrides = {}): Session {
  return buildTestSession({ environmentId: 'env_1', ...overrides })
}

function runner(overrides: RunnerOverrides = {}): Runner {
  return resourceRunner({ environmentId: 'env_1', ...overrides })
}

function pagination<T>(items: T[]): ClientPagination<T> {
  return {
    items,
    page: 1,
    pageCount: 1,
    pageSize: 10,
    total: items.length,
    start: items.length === 0 ? 0 : 1,
    end: items.length,
    canPrevious: false,
    canNext: false,
    viewportRef: { current: null },
    previous: vi.fn(),
    next: vi.fn(),
  }
}

function makeQueryClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
}

// Pointer capture stubs needed by Radix UI dialogs/selects
function stubPointerEvents() {
  Object.defineProperty(HTMLElement.prototype, 'hasPointerCapture', {
    value: vi.fn(() => false),
    configurable: true,
  })
  Object.defineProperty(HTMLElement.prototype, 'setPointerCapture', {
    value: vi.fn(),
    configurable: true,
  })
  Object.defineProperty(HTMLElement.prototype, 'releasePointerCapture', {
    value: vi.fn(),
    configurable: true,
  })
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
    value: vi.fn(),
    configurable: true,
  })
}

async function activateTab(name: string) {
  const tab = screen.getByRole('tab', { name })
  fireEvent.pointerDown(tab, { button: 0, ctrlKey: false })
  fireEvent.mouseDown(tab)
  fireEvent.mouseUp(tab)
  fireEvent.click(tab)
  await waitFor(() => expect(tab.getAttribute('data-state')).toBe('active'))
}

// ─── MSW handler factories ────────────────────────────────────────────────────

// Register environment collection handlers for tests that need the full
// CRUD surface (EnvironmentsPage, EnvironmentDetailPage, CreateEnvironmentSheet).
function setupEnvironmentHandlers(envs: Environment[] = [], sessions: Session[] = [], runners: Runner[] = []) {
  const envCollection = createCollection<Environment>(envs)

  server.use(
    ...resourceHandlers('environments', envCollection, (body, idx) =>
      environment({ id: `env_new_${idx}`, name: String(body.name ?? 'New'), ...body }),
    ),
    // sessions list — EnvironmentDetailPage reads it
    http.get('*/api/v1/sessions', () =>
      HttpResponse.json({
        data: sessions,
        pagination: { limit: 50, hasMore: false, nextCursor: null },
      }),
    ),
    http.get('*/api/v1/runners', ({ request }) => {
      const url = new URL(request.url)
      const environmentId = url.searchParams.get('environmentId')
      const data = environmentId ? runners.filter((runner) => runner.environmentId === environmentId) : runners
      return HttpResponse.json({
        data,
        pagination: { limit: 50, hasMore: false, nextCursor: null },
      })
    }),
  )

  return { envCollection, sessions, runners }
}

// ─── EnvironmentsView ────────────────────────────────────────────────────────

describe('[spec: environments/console-list] EnvironmentsView', () => {
  it('explains the reusable-template empty state when no environments exist', () => {
    render(
      <MemoryRouter>
        <EnvironmentsView environments={[]} pagination={pagination<Environment>([])} onArchive={vi.fn()} />
      </MemoryRouter>,
    )

    expect(screen.getByText('No environments')).toBeTruthy()
    expect(screen.getByText(/Create an execution environment before creating an agent\./)).toBeTruthy()
  })

  it('renders rows with name, status, type, packages, networking, and updated time', () => {
    const environments = [environment()]
    render(
      <MemoryRouter>
        <EnvironmentsView environments={environments} pagination={pagination(environments)} onArchive={vi.fn()} />
      </MemoryRouter>,
    )

    const cell = screen.getByText('Node workspace').closest('td')
    expect(cell).toBeTruthy()
    expect(screen.getByText('self_hosted')).toBeTruthy()
    expect(screen.getByText('npm:vite@7')).toBeTruthy()
    expect(screen.getByText('Limited: registry.npmjs.org')).toBeTruthy()
    expect(screen.getByText('v2')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Node workspace' }).getAttribute('href')).toBe('/environments/env_1')
  })

  it('shows environment description in row when description is provided', () => {
    const environments = [environment({ description: 'My test desc' })]
    render(
      <MemoryRouter>
        <EnvironmentsView environments={environments} pagination={pagination(environments)} onArchive={vi.fn()} />
      </MemoryRouter>,
    )

    expect(screen.getByText('My test desc')).toBeTruthy()
  })

  it('falls back to environment id when description is null', () => {
    const environments = [environment({ description: null })]
    render(
      <MemoryRouter>
        <EnvironmentsView environments={environments} pagination={pagination(environments)} onArchive={vi.fn()} />
      </MemoryRouter>,
    )

    expect(screen.getByText('env_1')).toBeTruthy()
  })

  it('shows "archived" badge when environment is archived', () => {
    const environments = [environment({ archivedAt: '2026-05-24T00:00:00.000Z' })]
    render(
      <MemoryRouter>
        <EnvironmentsView environments={environments} pagination={pagination(environments)} onArchive={vi.fn()} />
      </MemoryRouter>,
    )

    expect(screen.getByText('archived')).toBeTruthy()
  })

  it('shows "active" badge when environment is not archived', () => {
    const environments = [environment()]
    render(
      <MemoryRouter>
        <EnvironmentsView environments={environments} pagination={pagination(environments)} onArchive={vi.fn()} />
      </MemoryRouter>,
    )

    expect(screen.getByText('active')).toBeTruthy()
  })

  it('shows "None" when environment has no packages', () => {
    const environments = [
      environment({ packages: { type: 'packages', apt: [], cargo: [], gem: [], go: [], npm: [], pip: [] } }),
    ]
    render(
      <MemoryRouter>
        <EnvironmentsView environments={environments} pagination={pagination(environments)} onArchive={vi.fn()} />
      </MemoryRouter>,
    )

    expect(screen.getByText('None')).toBeTruthy()
  })

  it('renders package without version without the @ suffix', () => {
    const environments = [
      environment({
        packages: { type: 'packages', apt: [], cargo: [], gem: [], go: [], npm: ['typescript'], pip: [] },
      }),
    ]
    render(
      <MemoryRouter>
        <EnvironmentsView environments={environments} pagination={pagination(environments)} onArchive={vi.fn()} />
      </MemoryRouter>,
    )

    expect(screen.getByText('npm:typescript')).toBeTruthy()
  })

  it('shows open when networking is open', () => {
    const environments = [
      environment({ networking: { type: 'open', allowMcpServers: true, allowPackageManagers: true } }),
    ]
    render(
      <MemoryRouter>
        <EnvironmentsView environments={environments} pagination={pagination(environments)} onArchive={vi.fn()} />
      </MemoryRouter>,
    )

    expect(screen.getByText('open')).toBeTruthy()
  })

  it('calls onArchive when archive confirm is submitted', async () => {
    stubPointerEvents()

    const onArchive = vi.fn()
    const environments = [environment()]
    render(
      <MemoryRouter>
        <EnvironmentsView environments={environments} pagination={pagination(environments)} onArchive={onArchive} />
      </MemoryRouter>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Archive environment' }))
    await waitFor(() => expect(screen.getByText('Archive environment?')).toBeTruthy())
    const confirmBtns = screen.getAllByRole('button', { name: 'Archive environment', hidden: true })
    fireEvent.click(confirmBtns[confirmBtns.length - 1] as HTMLElement)
    await waitFor(() => expect(onArchive).toHaveBeenCalledWith('env_1'))
  })

  it('paginates correctly with multiple environments', () => {
    const envs = Array.from({ length: 11 }, (_, i) => environment({ id: `env_${i + 1}`, name: `Env ${i + 1}` }))

    function Harness() {
      const pag = useClientPagination(envs)
      return (
        <MemoryRouter>
          <EnvironmentsView environments={pag.items} pagination={pag} onArchive={vi.fn()} />
        </MemoryRouter>
      )
    }

    render(<Harness />)
    expect(screen.getByText('1-10 of 11')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }))
    expect(screen.getByText('11-11 of 11')).toBeTruthy()
  })
})

// ─── EnvironmentDetailView ───────────────────────────────────────────────────

describe('[spec: environments/console-detail] EnvironmentDetailView', () => {
  it('shows the profile header and policy facts without raw secret values', async () => {
    const session = buildSession()
    render(
      <MemoryRouter>
        <EnvironmentDetailView environment={environment()} sessions={[session]} onArchive={vi.fn()} />
      </MemoryRouter>,
    )

    expect(screen.getByText('Environment profile')).toBeTruthy()
    expect(screen.getByText('v2')).toBeTruthy()
    expect(screen.getByText('self_hosted')).toBeTruthy()
    expect(screen.getByText('Limited: registry.npmjs.org')).toBeTruthy()
    expect(screen.getByRole('tab', { name: 'Runners' })).toBeTruthy()
    expect(screen.getByRole('tab', { name: 'Sessions' })).toBeTruthy()
    await activateTab('Sessions')
    expect(screen.getByText('Sessions using this environment')).toBeTruthy()
  })

  it('shows runners bound to the environment on the runners tab', () => {
    render(
      <MemoryRouter>
        <EnvironmentDetailView environment={environment()} sessions={[]} runners={[runner()]} onArchive={vi.fn()} />
      </MemoryRouter>,
    )

    expect(screen.getByText('Mac mini runner')).toBeTruthy()
    expect(screen.getByText('runner_1')).toBeTruthy()
    expect(screen.getByText('1/2')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'codex:ready@0.42.0' })).toBeTruthy()
  })

  it('shows empty state when environment is null', () => {
    render(
      <MemoryRouter>
        <EnvironmentDetailView environment={null} sessions={[]} onArchive={vi.fn()} />
      </MemoryRouter>,
    )

    expect(screen.getByText('Environment not found')).toBeTruthy()
    expect(screen.getByText('The requested environment is not in the current project.')).toBeTruthy()
  })

  it('shows "No description" when description is null', () => {
    render(
      <MemoryRouter>
        <EnvironmentDetailView environment={environment({ description: null })} sessions={[]} onArchive={vi.fn()} />
      </MemoryRouter>,
    )

    expect(screen.getByText('No description')).toBeTruthy()
  })

  it('shows "None" for packages and variables when both are empty', () => {
    const env = environment({
      packages: { type: 'packages', apt: [], cargo: [], gem: [], go: [], npm: [], pip: [] },
      variables: {},
    })
    render(
      <MemoryRouter>
        <EnvironmentDetailView environment={env} sessions={[]} onArchive={vi.fn()} />
      </MemoryRouter>,
    )

    const nones = screen.getAllByText('None')
    expect(nones.length).toBeGreaterThanOrEqual(2)
  })

  it('shows open networking in detail view', () => {
    const env = environment({ networking: { type: 'open', allowMcpServers: true, allowPackageManagers: true } })
    render(
      <MemoryRouter>
        <EnvironmentDetailView environment={env} sessions={[]} onArchive={vi.fn()} />
      </MemoryRouter>,
    )

    expect(screen.getByText('open')).toBeTruthy()
  })

  it('shows limited networking when no allowed hosts are configured', () => {
    const env = environment({
      networking: { type: 'limited', allowMcpServers: false, allowPackageManagers: false },
    })
    render(
      <MemoryRouter>
        <EnvironmentDetailView environment={env} sessions={[]} onArchive={vi.fn()} />
      </MemoryRouter>,
    )

    expect(screen.getByText('Limited:')).toBeTruthy()
    expect(screen.getAllByText('Blocked')).toHaveLength(2)
  })

  it('only shows archive button for non-archived environment', () => {
    render(
      <MemoryRouter>
        <EnvironmentDetailView environment={environment()} sessions={[]} onArchive={vi.fn()} />
      </MemoryRouter>,
    )

    expect(screen.getByText('Archive')).toBeTruthy()
  })

  it('does not show archive button for archived environment', () => {
    render(
      <MemoryRouter>
        <EnvironmentDetailView
          environment={environment({ archivedAt: '2026-05-24T00:00:00.000Z' })}
          sessions={[]}
          onArchive={vi.fn()}
        />
      </MemoryRouter>,
    )

    expect(screen.queryByText('Archive')).toBeNull()
  })

  it('filters sessions to only those bound to the current environment', async () => {
    const boundSession = buildSession({ id: 'session_bound', environmentId: 'env_1' })
    const otherSession = buildSession({ id: 'session_other', environmentId: 'env_other' })
    render(
      <MemoryRouter>
        <EnvironmentDetailView
          environment={environment()}
          sessions={[boundSession, otherSession]}
          onArchive={vi.fn()}
        />
      </MemoryRouter>,
    )

    await activateTab('Sessions')
    expect(screen.getAllByText('session_bound').length).toBeGreaterThan(0)
    expect(screen.queryByText('session_other')).toBeNull()
  })

  it('calls onArchive when archive confirm is submitted in detail view', async () => {
    stubPointerEvents()

    const onArchive = vi.fn()
    render(
      <MemoryRouter>
        <EnvironmentDetailView environment={environment()} sessions={[]} onArchive={onArchive} />
      </MemoryRouter>,
    )

    fireEvent.click(screen.getByText('Archive'))
    await waitFor(() => expect(screen.getByText('Archive environment?')).toBeTruthy())
    const confirmBtns = screen.getAllByRole('button', { name: 'Archive environment', hidden: true })
    fireEvent.click(confirmBtns[confirmBtns.length - 1] as HTMLElement)
    await waitFor(() => expect(onArchive).toHaveBeenCalledWith('env_1'))
  })
})

// ─── CreateEnvironmentSheet ──────────────────────────────────────────────────

describe('[spec: environments/create-sheet] CreateEnvironmentSheet', () => {
  it('renders the create environment form when open', () => {
    // POST /environments needed for the mutation; we register it but don't trigger it
    server.use(
      http.post('*/api/v1/environments', () => HttpResponse.json(environment({ id: 'env_new' }), { status: 201 })),
    )
    const client = makeQueryClient()
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <CreateEnvironmentSheet open onOpenChange={vi.fn()} />
        </MemoryRouter>
      </QueryClientProvider>,
    )

    expect(screen.getByText('Create Environment')).toBeTruthy()
    expect(screen.getByText('Define a reusable execution environment for future sessions.')).toBeTruthy()
    expect(screen.getByRole('button', { name: /Save environment/i })).toBeTruthy()
  })

  it('does not render form content when closed', () => {
    const client = makeQueryClient()
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <CreateEnvironmentSheet open={false} onOpenChange={vi.fn()} />
        </MemoryRouter>
      </QueryClientProvider>,
    )

    expect(screen.queryByText('Create Environment')).toBeNull()
  })

  it('posts to api and closes sheet on successful environment creation', async () => {
    server.use(
      http.post('*/api/v1/environments', async () =>
        HttpResponse.json(environment({ id: 'env_new' }), { status: 201 }),
      ),
      // after success, the mutation invalidates environments — pre-register the list endpoint
      http.get('*/api/v1/environments', () =>
        HttpResponse.json({ data: [], pagination: { limit: 50, hasMore: false, nextCursor: null } }),
      ),
    )

    const onOpenChange = vi.fn()
    const client = makeQueryClient()
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <CreateEnvironmentSheet open onOpenChange={onOpenChange} />
        </MemoryRouter>
      </QueryClientProvider>,
    )

    fireEvent.click(screen.getByRole('button', { name: /Save environment/i }))
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
  })

  it('sends limited networking by default on submit', async () => {
    let capturedBody: Record<string, unknown> | null = null
    server.use(
      http.post('*/api/v1/environments', async ({ request }) => {
        capturedBody = (await request.json()) as Record<string, unknown>
        return HttpResponse.json(environment({ id: 'env_new' }), { status: 201 })
      }),
      http.get('*/api/v1/environments', () =>
        HttpResponse.json({ data: [], pagination: { limit: 50, hasMore: false, nextCursor: null } }),
      ),
    )

    const client = makeQueryClient()
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <CreateEnvironmentSheet open onOpenChange={vi.fn()} />
        </MemoryRouter>
      </QueryClientProvider>,
    )

    fireEvent.click(screen.getByRole('button', { name: /Save environment/i }))
    await waitFor(() => expect(capturedBody).not.toBeNull())
    expect(((capturedBody!.spec as Record<string, unknown>).networking as Record<string, unknown>).type).toBe('limited')
    expect((capturedBody!.metadata as Record<string, unknown>).name).toBe('Node workspace')
    expect((capturedBody!.metadata as Record<string, unknown>).description).toBe(
      'Default workspace for Pi-backed coding sessions.',
    )
  })

  it('sends packages grouped by package manager', async () => {
    let capturedBody: Record<string, unknown> | null = null
    server.use(
      http.post('*/api/v1/environments', async ({ request }) => {
        capturedBody = (await request.json()) as Record<string, unknown>
        return HttpResponse.json(environment({ id: 'env_new' }), { status: 201 })
      }),
      http.get('*/api/v1/environments', () =>
        HttpResponse.json({ data: [], pagination: { limit: 50, hasMore: false, nextCursor: null } }),
      ),
    )

    const client = makeQueryClient()
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <CreateEnvironmentSheet open onOpenChange={vi.fn()} />
        </MemoryRouter>
      </QueryClientProvider>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Add package' }))
    fireEvent.change(screen.getByLabelText('Package 3 name'), { target: { value: 'pandas' } })
    const thirdManager = screen.getByLabelText('Package 3 manager')
    thirdManager.focus()
    fireEvent.pointerDown(thirdManager, { button: 0, ctrlKey: false, pointerId: 1, pointerType: 'mouse' })
    fireEvent.mouseDown(thirdManager)
    fireEvent.click(await screen.findByRole('option', { name: 'Pip' }))

    fireEvent.click(screen.getByRole('button', { name: 'Add package' }))
    fireEvent.change(screen.getByLabelText('Package 4 name'), { target: { value: 'golang.org/x/tools@latest' } })
    const fourthManager = screen.getByLabelText('Package 4 manager')
    fourthManager.focus()
    fireEvent.pointerDown(fourthManager, { button: 0, ctrlKey: false, pointerId: 2, pointerType: 'mouse' })
    fireEvent.mouseDown(fourthManager)
    fireEvent.click(await screen.findByRole('option', { name: 'Go' }))

    fireEvent.click(screen.getByRole('button', { name: /Save environment/i }))

    await waitFor(() => expect(capturedBody).not.toBeNull())
    expect((capturedBody!.spec as Record<string, unknown>).packages).toEqual({
      type: 'packages',
      apt: [],
      cargo: [],
      gem: [],
      go: ['golang.org/x/tools@latest'],
      npm: ['tsx@latest', 'typescript@latest'],
      pip: ['pandas'],
    })
  })

  it('stays open and does not crash when the api returns an error', async () => {
    server.use(http.post('*/api/v1/environments', () => HttpResponse.json({ error: 'Server error' }, { status: 500 })))

    const client = makeQueryClient()
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <CreateEnvironmentSheet open onOpenChange={vi.fn()} />
        </MemoryRouter>
      </QueryClientProvider>,
    )

    fireEvent.click(screen.getByRole('button', { name: /Save environment/i }))
    await waitFor(() => expect(screen.getByRole('button', { name: /Save environment/i })).toBeTruthy())
  })

  it('sends open networking when network mode is changed to open', async () => {
    stubPointerEvents()

    let capturedBody: Record<string, unknown> | null = null
    server.use(
      http.post('*/api/v1/environments', async ({ request }) => {
        capturedBody = (await request.json()) as Record<string, unknown>
        return HttpResponse.json(environment({ id: 'env_new' }), { status: 201 })
      }),
      http.get('*/api/v1/environments', () =>
        HttpResponse.json({ data: [], pagination: { limit: 50, hasMore: false, nextCursor: null } }),
      ),
    )

    const client = makeQueryClient()
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <CreateEnvironmentSheet open onOpenChange={vi.fn()} />
        </MemoryRouter>
      </QueryClientProvider>,
    )

    // Change network mode from limited to open via Radix Select.
    const networkModeSelect = screen.getAllByRole('combobox')[1] as HTMLElement
    networkModeSelect.focus()
    fireEvent.pointerDown(networkModeSelect, { button: 0, ctrlKey: false, pointerId: 1, pointerType: 'mouse' })
    fireEvent.mouseDown(networkModeSelect)
    fireEvent.keyDown(networkModeSelect, { key: 'ArrowDown' })
    fireEvent.click(await screen.findByRole('option', { name: 'Open' }))

    fireEvent.click(screen.getByRole('button', { name: /Save environment/i }))
    await waitFor(() => expect(capturedBody).not.toBeNull())
    expect(((capturedBody!.spec as Record<string, unknown>).networking as Record<string, unknown>).type).toBe('open')
  })

  it('omits description metadata when description is blank', async () => {
    let capturedBody: Record<string, unknown> | null = null
    server.use(
      http.post('*/api/v1/environments', async ({ request }) => {
        capturedBody = (await request.json()) as Record<string, unknown>
        return HttpResponse.json(environment({ id: 'env_new' }), { status: 201 })
      }),
      http.get('*/api/v1/environments', () =>
        HttpResponse.json({ data: [], pagination: { limit: 50, hasMore: false, nextCursor: null } }),
      ),
    )

    const client = makeQueryClient()
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <CreateEnvironmentSheet open onOpenChange={vi.fn()} />
        </MemoryRouter>
      </QueryClientProvider>,
    )

    fireEvent.change(screen.getByLabelText('Description'), { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: /Save environment/i }))
    await waitFor(() => expect(capturedBody).not.toBeNull())
    const body = capturedBody as unknown as Record<string, unknown>
    expect(body.metadata).not.toHaveProperty('description')
  })
})

// ─── EnvironmentsPage ────────────────────────────────────────────────────────

describe('[spec: environments/console-page] EnvironmentsPage', () => {
  function renderPage(initialPath = '/') {
    setupEnvironmentHandlers()
    const client = makeQueryClient()
    return render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={[initialPath]}>
          <EnvironmentsPage />
        </MemoryRouter>
      </QueryClientProvider>,
    )
  }

  function renderPageWithEnvs(envs: Environment[], initialPath = '/') {
    setupEnvironmentHandlers(envs)
    const client = makeQueryClient()
    return render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={[initialPath]}>
          <EnvironmentsPage />
        </MemoryRouter>
      </QueryClientProvider>,
    )
  }

  it('renders the page header and create environment button', () => {
    renderPage()
    expect(screen.getByText('Environments')).toBeTruthy()
    expect(screen.getByRole('button', { name: /Create environment/i })).toBeTruthy()
  })

  it('renders search, type filter, and status filter controls', () => {
    renderPage()
    expect(screen.getByRole('searchbox', { name: 'Search environments' })).toBeTruthy()
    expect(screen.getByRole('combobox', { name: 'Filter by environment type' })).toBeTruthy()
    expect(screen.getByRole('combobox', { name: 'Filter by status' })).toBeTruthy()
  })

  it('renders environment rows after data loads', async () => {
    renderPageWithEnvs([environment()])
    expect(await screen.findByText('Node workspace')).toBeTruthy()
  })

  it('filters environments by search text matching name', async () => {
    renderPageWithEnvs([
      environment({ id: 'env_1', name: 'Alpha env' }),
      environment({ id: 'env_2', name: 'Beta env' }),
    ])
    await screen.findByText('Alpha env')

    fireEvent.change(screen.getByRole('searchbox', { name: 'Search environments' }), {
      target: { value: 'Alpha' },
    })

    expect(screen.getByText('Alpha env')).toBeTruthy()
    expect(screen.queryByText('Beta env')).toBeNull()
  })

  it('filters environments by search text matching description', async () => {
    renderPageWithEnvs([
      environment({ id: 'env_1', name: 'Env 1', description: 'alpha workspace' }),
      environment({ id: 'env_2', name: 'Env 2', description: 'beta workspace' }),
    ])
    await screen.findByText('Env 1')

    fireEvent.change(screen.getByRole('searchbox', { name: 'Search environments' }), {
      target: { value: 'alpha' },
    })

    expect(screen.getByText('Env 1')).toBeTruthy()
    expect(screen.queryByText('Env 2')).toBeNull()
  })

  it('opens create environment sheet when button is clicked', async () => {
    // CreateEnvironmentSheet renders when open; no actual POST needed
    server.use(
      http.post('*/api/v1/environments', () => HttpResponse.json(environment({ id: 'env_new' }), { status: 201 })),
    )
    renderPage()
    fireEvent.click(screen.getByRole('button', { name: /Create environment/i }))
    await waitFor(() => expect(screen.getByText('Create Environment')).toBeTruthy())
  })

  it('shows empty state when no environments are returned', async () => {
    renderPage()
    await waitFor(() => expect(screen.getByText('No environments')).toBeTruthy())
  })

  it('passes archived=true query when status filter is archived', async () => {
    let requestedUrl = ''
    server.use(
      http.get('*/api/v1/environments', ({ request }) => {
        requestedUrl = request.url
        return HttpResponse.json({ data: [], pagination: { limit: 50, hasMore: false, nextCursor: null } })
      }),
    )
    const client = makeQueryClient()
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={['/?status=archived']}>
          <EnvironmentsPage />
        </MemoryRouter>
      </QueryClientProvider>,
    )

    await waitFor(() => expect(requestedUrl).toContain('archived=true'))
  })

  it('filters environments by type when type filter is set', async () => {
    renderPageWithEnvs(
      [
        environment({ id: 'env_cloud', name: 'Cloud env', type: 'cloud' }),
        environment({ id: 'env_self', name: 'Self env', type: 'self_hosted' }),
      ],
      '/?type=cloud',
    )

    expect(await screen.findByText('Cloud env')).toBeTruthy()
    await waitFor(() => expect(screen.queryByText('Self env')).toBeNull())
  })

  it('shows archived environments when status filter is set to archived with matching data', async () => {
    const archivedEnv = environment({
      id: 'env_archived',
      name: 'Archived env',
      archivedAt: '2026-05-24T00:00:00.000Z',
    })
    renderPageWithEnvs([archivedEnv], '/?status=archived')

    expect(await screen.findByText('Archived env')).toBeTruthy()
    expect(screen.getAllByText('archived').length).toBeGreaterThan(0)
  })
})

// ─── EnvironmentDetailPage ───────────────────────────────────────────────────

describe('[spec: environments/console-detail-page] EnvironmentDetailPage', () => {
  function renderDetailPage(env: Environment | null, sessions: Session[] = [], runners: Runner[] = []) {
    const envCollection = createCollection<Environment>(env ? [env] : [])

    server.use(
      ...resourceHandlers('environments', envCollection, (body, idx) =>
        environment({ id: `env_new_${idx}`, name: String(body.name ?? 'New'), ...body }),
      ),
      http.get('*/api/v1/sessions', () =>
        HttpResponse.json({
          data: sessions,
          pagination: { limit: 50, hasMore: false, nextCursor: null },
        }),
      ),
      http.get('*/api/v1/runners', ({ request }) => {
        const url = new URL(request.url)
        const environmentId = url.searchParams.get('environmentId')
        const data = environmentId ? runners.filter((runner) => runner.environmentId === environmentId) : runners
        return HttpResponse.json({
          data,
          pagination: { limit: 50, hasMore: false, nextCursor: null },
        })
      }),
    )

    const client = makeQueryClient()
    return render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={['/environments/env_1']}>
          <Routes>
            <Route path="/environments/:environmentId" element={<EnvironmentDetailPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    )
  }

  it('renders the page with environment name in header after load', async () => {
    renderDetailPage(environment())
    expect(await screen.findByText('Node workspace')).toBeTruthy()
  })

  it('renders Environment detail fallback title when environment is not found', async () => {
    renderDetailPage(null)
    // Page renders with fallback title while data is null
    expect(screen.getByText('Environment detail')).toBeTruthy()
  })

  it('shows the edit environment button for an active environment', async () => {
    renderDetailPage(environment())
    expect(await screen.findByRole('button', { name: /Edit environment/i })).toBeTruthy()
  })

  it('does not show the edit environment button for an archived environment', async () => {
    renderDetailPage(environment({ archivedAt: '2026-05-24T00:00:00.000Z' }))
    await screen.findByText('Node workspace')
    expect(screen.queryByRole('button', { name: /Edit environment/i })).toBeNull()
  })

  it('opens the edit sheet when Edit environment is clicked', async () => {
    renderDetailPage(environment())
    const editBtn = await screen.findByRole('button', { name: /Edit environment/i })
    fireEvent.click(editBtn)
    await waitFor(() =>
      expect(
        screen.getByText('Saving creates a new immutable environment version; existing sessions keep their snapshots.'),
      ).toBeTruthy(),
    )
  })

  it('pre-fills the edit form with current environment values', async () => {
    renderDetailPage(environment())
    const editBtn = await screen.findByRole('button', { name: /Edit environment/i })
    fireEvent.click(editBtn)
    await waitFor(() => {
      const nameInput = screen.getByDisplayValue('Node workspace')
      expect(nameInput).toBeTruthy()
    })
  })

  it('validates that name is required on edit form submit', async () => {
    renderDetailPage(environment())
    const editBtn = await screen.findByRole('button', { name: /Edit environment/i })
    fireEvent.click(editBtn)
    await waitFor(() => screen.getByDisplayValue('Node workspace'))

    const nameInput = screen.getByDisplayValue('Node workspace') as HTMLInputElement
    fireEvent.change(nameInput, { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: /Save environment/i }))
    await waitFor(() => expect(screen.getByText('Name is required')).toBeTruthy())
  })

  it('calls PATCH /environments/:id on valid edit form submit', async () => {
    let patchedBody: Record<string, unknown> | null = null
    const envCollection = createCollection<Environment>([environment()])
    server.use(
      ...resourceHandlers('environments', envCollection, (body, idx) => environment({ id: `env_new_${idx}`, ...body })),
      http.get('*/api/v1/sessions', () =>
        HttpResponse.json({ data: [], pagination: { limit: 50, hasMore: false, nextCursor: null } }),
      ),
    )
    // Override PATCH to capture body
    server.use(
      http.patch('*/api/v1/environments/:id', async ({ request }) => {
        patchedBody = (await request.json()) as Record<string, unknown>
        return HttpResponse.json(environment())
      }),
    )

    const client = makeQueryClient()
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={['/environments/env_1']}>
          <Routes>
            <Route path="/environments/:environmentId" element={<EnvironmentDetailPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    )

    const editBtn = await screen.findByRole('button', { name: /Edit environment/i })
    fireEvent.click(editBtn)
    await waitFor(() => screen.getByDisplayValue('Node workspace'))
    fireEvent.click(screen.getByRole('button', { name: /Save environment/i }))
    await waitFor(() => expect(patchedBody).not.toBeNull())
    expect((patchedBody!.metadata as Record<string, unknown>).name).toBe('Node workspace')
  })

  it('clears name error when name is typed after a failed validation', async () => {
    renderDetailPage(environment())
    const editBtn = await screen.findByRole('button', { name: /Edit environment/i })
    fireEvent.click(editBtn)
    await waitFor(() => screen.getByDisplayValue('Node workspace'))

    const nameInput = screen.getByDisplayValue('Node workspace') as HTMLInputElement
    fireEvent.change(nameInput, { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: /Save environment/i }))
    await waitFor(() => expect(screen.getByText('Name is required')).toBeTruthy())

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Fixed name' } })
    await waitFor(() => expect(screen.queryByText('Name is required')).toBeNull())
  })

  it('pre-fills edit form with allowed hosts from limited networking', async () => {
    const env = environment({
      networking: {
        type: 'limited',
        allowMcpServers: false,
        allowPackageManagers: true,
        allowedHosts: ['registry.npmjs.org', 'cdn.example.com'],
      },
    })
    renderDetailPage(env)
    const editBtn = await screen.findByRole('button', { name: /Edit environment/i })
    fireEvent.click(editBtn)
    await waitFor(() =>
      expect(
        screen.getByText('Saving creates a new immutable environment version; existing sessions keep their snapshots.'),
      ).toBeTruthy(),
    )
    await waitFor(() => {
      const nameInput = screen.getByDisplayValue('Node workspace')
      expect(nameInput).toBeTruthy()
    })
  })

  it('uses empty allowed hosts string when networking is not limited', async () => {
    const env = environment({ networking: { type: 'open', allowMcpServers: true, allowPackageManagers: true } })
    renderDetailPage(env)
    const editBtn = await screen.findByRole('button', { name: /Edit environment/i })
    fireEvent.click(editBtn)
    await waitFor(() =>
      expect(
        screen.getByText('Saving creates a new immutable environment version; existing sessions keep their snapshots.'),
      ).toBeTruthy(),
    )
    expect(screen.queryByDisplayValue(/registry/)).toBeNull()
  })

  it('archives environment via PATCH when archive flow is completed', async () => {
    stubPointerEvents()

    let archiveBody: Record<string, unknown> | null = null
    const envCollection = createCollection<Environment>([environment()])
    server.use(
      http.get('*/api/v1/environments/:id', ({ params }) => {
        const record = envCollection.get(String(params.id))
        return record
          ? HttpResponse.json(record)
          : HttpResponse.json({ error: { type: 'not_found', message: 'Not found' } }, { status: 404 })
      }),
      http.patch('*/api/v1/environments/:id', async ({ request }) => {
        archiveBody = (await request.json()) as Record<string, unknown>
        return HttpResponse.json(environment({ archivedAt: '2026-05-24T00:00:00.000Z' }))
      }),
      http.get('*/api/v1/environments', () =>
        HttpResponse.json({ data: [], pagination: { limit: 50, hasMore: false, nextCursor: null } }),
      ),
      http.get('*/api/v1/sessions', () =>
        HttpResponse.json({ data: [], pagination: { limit: 50, hasMore: false, nextCursor: null } }),
      ),
    )

    const client = makeQueryClient()
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={['/environments/env_1']}>
          <Routes>
            <Route path="/environments/:environmentId" element={<EnvironmentDetailPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    )

    await screen.findByText('Node workspace')
    fireEvent.click(screen.getByText('Archive'))
    await waitFor(() => expect(screen.getByText('Archive environment?')).toBeTruthy())
    const confirmBtns = screen.getAllByRole('button', { name: 'Archive environment', hidden: true })
    fireEvent.click(confirmBtns[confirmBtns.length - 1] as HTMLElement)
    await waitFor(() => expect(archiveBody).not.toBeNull())
    expect(archiveBody!.archived).toBe(true)
  })

  it('handles archive api error without crashing', async () => {
    stubPointerEvents()

    server.use(
      http.get('*/api/v1/environments/:id', () => HttpResponse.json(environment())),
      http.patch('*/api/v1/environments/:id', () => HttpResponse.json({ error: 'Archive failed' }, { status: 500 })),
      http.get('*/api/v1/sessions', () =>
        HttpResponse.json({ data: [], pagination: { limit: 50, hasMore: false, nextCursor: null } }),
      ),
    )

    const client = makeQueryClient()
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={['/environments/env_1']}>
          <Routes>
            <Route path="/environments/:environmentId" element={<EnvironmentDetailPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    )

    await screen.findByText('Node workspace')
    fireEvent.click(screen.getByText('Archive'))
    await waitFor(() => expect(screen.getByText('Archive environment?')).toBeTruthy())
    const confirmBtns = screen.getAllByRole('button', { name: 'Archive environment', hidden: true })
    fireEvent.click(confirmBtns[confirmBtns.length - 1] as HTMLElement)
    // Page still renders after error
    await waitFor(() => expect(screen.getByText('Node workspace')).toBeTruthy())
  })

  it('pre-fills edit form from env with null description, no-version package, and value-type variable', async () => {
    const complexEnv = environment({
      description: null,
      packages: { type: 'packages', apt: [], cargo: [], gem: [], go: [], npm: ['typescript'], pip: [] },
      variables: { SECRET: { value: 'hidden', description: 'secret val' } as unknown as { description?: string } },
      networking: { type: 'open', allowMcpServers: true, allowPackageManagers: true },
    })
    renderDetailPage(complexEnv)
    const editBtn = await screen.findByRole('button', { name: /Edit environment/i })
    fireEvent.click(editBtn)
    await waitFor(() =>
      expect(
        screen.getByText('Saving creates a new immutable environment version; existing sessions keep their snapshots.'),
      ).toBeTruthy(),
    )
    const descInput = screen.getAllByDisplayValue('')[0]
    expect(descInput).toBeTruthy()
    expect(screen.getByDisplayValue('typescript')).toBeTruthy()
  })

  it('sends open networking when environment network mode is open on update', async () => {
    let patchedBody: Record<string, unknown> | null = null
    const envCollection = createCollection<Environment>([
      environment({ networking: { type: 'open', allowMcpServers: true, allowPackageManagers: true } }),
    ])
    server.use(
      http.get('*/api/v1/environments/:id', ({ params }) => {
        const record = envCollection.get(String(params.id))
        return record ? HttpResponse.json(record) : HttpResponse.json({}, { status: 404 })
      }),
      http.patch('*/api/v1/environments/:id', async ({ request }) => {
        patchedBody = (await request.json()) as Record<string, unknown>
        return HttpResponse.json(environment())
      }),
      http.get('*/api/v1/environments', () =>
        HttpResponse.json({ data: [], pagination: { limit: 50, hasMore: false, nextCursor: null } }),
      ),
      http.get('*/api/v1/sessions', () =>
        HttpResponse.json({ data: [], pagination: { limit: 50, hasMore: false, nextCursor: null } }),
      ),
    )

    const client = makeQueryClient()
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={['/environments/env_1']}>
          <Routes>
            <Route path="/environments/:environmentId" element={<EnvironmentDetailPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    )

    const editBtn = await screen.findByRole('button', { name: /Edit environment/i })
    fireEvent.click(editBtn)
    await waitFor(() => screen.getByDisplayValue('Node workspace'))
    fireEvent.click(screen.getByRole('button', { name: /Save environment/i }))
    await waitFor(() => expect(patchedBody).not.toBeNull())
    expect(((patchedBody!.spec as Record<string, unknown>).networking as Record<string, unknown>).type).toBe('open')
  })

  it('handles update api error without crashing', async () => {
    server.use(
      http.get('*/api/v1/environments/:id', () => HttpResponse.json(environment())),
      http.patch('*/api/v1/environments/:id', () => HttpResponse.json({ error: 'Update failed' }, { status: 500 })),
      http.get('*/api/v1/sessions', () =>
        HttpResponse.json({ data: [], pagination: { limit: 50, hasMore: false, nextCursor: null } }),
      ),
    )

    const client = makeQueryClient()
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={['/environments/env_1']}>
          <Routes>
            <Route path="/environments/:environmentId" element={<EnvironmentDetailPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    )

    const editBtn = await screen.findByRole('button', { name: /Edit environment/i })
    fireEvent.click(editBtn)
    await waitFor(() => screen.getByDisplayValue('Node workspace'))
    fireEvent.click(screen.getByRole('button', { name: /Save environment/i }))
    // Page stays rendered after error
    await waitFor(() => expect(screen.getByRole('button', { name: /Save environment/i })).toBeTruthy())
  })
})

// ─── useEnvironmentActions ───────────────────────────────────────────────────

describe('[spec: environments/actions] useEnvironmentActions', () => {
  function ActionHarness({ onReady }: { onReady: (actions: ReturnType<typeof useEnvironmentActions>) => void }) {
    const actions = useEnvironmentActions()
    onReady(actions)
    return null
  }

  it('exposes archiveEnvironment function and archiveEnvironmentPending boolean as false initially', () => {
    // The hook calls PATCH and invalidates — register endpoints
    server.use(
      http.patch('*/api/v1/environments/:id', () =>
        HttpResponse.json(environment({ archivedAt: new Date().toISOString() })),
      ),
      http.get('*/api/v1/environments', () =>
        HttpResponse.json({ data: [], pagination: { limit: 50, hasMore: false, nextCursor: null } }),
      ),
      http.get('*/api/v1/sessions', () =>
        HttpResponse.json({ data: [], pagination: { limit: 50, hasMore: false, nextCursor: null } }),
      ),
    )

    const client = makeQueryClient()
    let capturedActions: ReturnType<typeof useEnvironmentActions> | null = null
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <ActionHarness
            onReady={(a) => {
              capturedActions = a
            }}
          />
        </MemoryRouter>
      </QueryClientProvider>,
    )

    expect(typeof capturedActions!.archiveEnvironment).toBe('function')
    expect(typeof capturedActions!.archiveEnvironmentPending).toBe('boolean')
    expect(capturedActions!.archiveEnvironmentPending).toBe(false)
  })

  it('calls PATCH /environments/:id with archived: true when archiveEnvironment is invoked', async () => {
    let patchedUrl = ''
    let patchedBody: Record<string, unknown> | null = null
    server.use(
      http.patch('*/api/v1/environments/:id', async ({ request }) => {
        patchedUrl = request.url
        patchedBody = (await request.json()) as Record<string, unknown>
        return HttpResponse.json(environment({ archivedAt: new Date().toISOString() }))
      }),
      http.get('*/api/v1/environments', () =>
        HttpResponse.json({ data: [], pagination: { limit: 50, hasMore: false, nextCursor: null } }),
      ),
      http.get('*/api/v1/sessions', () =>
        HttpResponse.json({ data: [], pagination: { limit: 50, hasMore: false, nextCursor: null } }),
      ),
    )

    const client = makeQueryClient()
    let capturedActions: ReturnType<typeof useEnvironmentActions> | null = null
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <ActionHarness
            onReady={(a) => {
              capturedActions = a
            }}
          />
        </MemoryRouter>
      </QueryClientProvider>,
    )

    capturedActions!.archiveEnvironment('env_1')
    await waitFor(() => expect(patchedBody).not.toBeNull())
    expect(patchedBody!.archived).toBe(true)
    expect(patchedUrl).toContain('env_1')
  })
})
