import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Connector } from '@/lib/enborrpc'
import { McpConnectorPage } from './McpConnectorPage'
import { McpPage } from './McpPage'
import { McpView } from './McpView'

vi.mock('@/components/ui/select', async () => {
  const React = await import('react')
  return {
    Select: ({
      value,
      onValueChange,
      children,
    }: {
      value: string
      onValueChange: (value: string) => void
      children: React.ReactNode
    }) =>
      React.createElement(
        'select',
        { value, onChange: (event: React.ChangeEvent<HTMLSelectElement>) => onValueChange(event.target.value) },
        children,
      ),
    SelectTrigger: () => null,
    SelectValue: () => null,
    SelectContent: ({ children }: { children: React.ReactNode }) => React.createElement(React.Fragment, null, children),
    SelectGroup: ({ children }: { children: React.ReactNode }) => React.createElement(React.Fragment, null, children),
    SelectItem: ({ value, children }: { value: string; children: React.ReactNode }) =>
      React.createElement('option', { value }, children),
  }
})

function connector(overrides: Partial<Connector> = {}): Connector {
  return {
    id: 'github',
    name: 'GitHub',
    description: 'Repository MCP server.',
    category: 'development',
    trustLevel: 'verified',
    capabilities: ['repositories'],
    supportedAuthModes: ['vault_credential'],
    setupRequirements: ['github_token'],
    tools: [
      {
        name: 'repo.read',
        description: 'Read repository metadata.',
        inputSchema: {},
        approvalMode: 'project_policy',
        policyMetadata: {},
      },
    ],
    metadata: {},
    availability: 'available',
    createdAt: '2025-01-01T00:00:00.000Z',
    updatedAt: '2025-01-01T00:00:00.000Z',
    ...overrides,
  }
}

function page<T>(data: T[]) {
  return { data, pagination: { limit: 50, nextCursor: null, hasMore: false } }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

function mockJson(routes: Record<string, unknown>) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.pathname : input.url
      const path = url.startsWith('http') ? new URL(url).pathname : url.split('?')[0]!
      const body = routes[path]
      return new Response(JSON.stringify(body ?? { error: { message: 'Not found' } }), {
        status: body ? 200 : 404,
        headers: { 'Content-Type': 'application/json' },
      })
    }),
  )
}

function mockResponse(status: number, body: unknown) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })),
  )
}

function pagination<T>(items: T[]) {
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
    previous: () => undefined,
    next: () => undefined,
    setPage: () => undefined,
    viewportRef: { current: null },
  }
}

function makeQueryClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
}

function withQueryClient(children: ReactNode) {
  return <QueryClientProvider client={makeQueryClient()}>{children}</QueryClientProvider>
}

async function renderMcpPageAndSelect(index: number, value: string) {
  mockJson({ '/api/v1/connectors': page([connector()]) })
  render(
    withQueryClient(
      <MemoryRouter initialEntries={['/settings/mcp']}>
        <Routes>
          <Route path="/settings/mcp" element={<McpPage />} />
        </Routes>
      </MemoryRouter>,
    ),
  )
  await waitFor(() => expect(screen.getByText('GitHub')).toBeTruthy())
  fireEvent.change(screen.getAllByRole('combobox')[index]!, { target: { value } })
}

describe('MCP catalog UI', () => {
  it('renders connector catalog rows', () => {
    render(
      <MemoryRouter>
        <McpView connectors={[connector()]} connectorPagination={pagination([connector()])} />
      </MemoryRouter>,
    )

    expect(screen.getByText('MCP connectors')).toBeTruthy()
    expect(screen.getByText('GitHub')).toBeTruthy()
    expect(screen.getByText('repositories')).toBeTruthy()
    expect(screen.queryByText('Connections')).toBeNull()
  })

  it('renders empty and unavailable connector states', () => {
    render(
      <MemoryRouter>
        <McpView connectors={[]} connectorPagination={pagination([])} />
      </MemoryRouter>,
    )
    expect(screen.getByText('No MCP connectors match the current catalog filters.')).toBeTruthy()

    render(
      <MemoryRouter>
        <McpView
          connectors={[connector({ availability: 'unavailable' })]}
          connectorPagination={pagination([connector({ availability: 'unavailable' })])}
        />
      </MemoryRouter>,
    )
    expect(screen.getAllByText('Connector is unavailable on this platform.').length).toBeGreaterThan(0)
  })

  it('renders connectors without auth or setup requirements', () => {
    render(
      <MemoryRouter>
        <McpView
          connectors={[connector({ supportedAuthModes: [], setupRequirements: [], capabilities: [] })]}
          connectorPagination={pagination([
            connector({ supportedAuthModes: [], setupRequirements: [], capabilities: [] }),
          ])}
        />
      </MemoryRouter>,
    )
    expect(screen.getByRole('button', { name: 'None' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'None · Setup: None' })).toBeTruthy()
  })

  it('loads the catalog page without querying project connection resources', async () => {
    mockJson({ '/api/v1/connectors': page([connector()]) })

    render(
      withQueryClient(
        <MemoryRouter initialEntries={['/settings/mcp']}>
          <Routes>
            <Route path="/settings/mcp" element={<McpPage />} />
          </Routes>
        </MemoryRouter>,
      ),
    )

    await waitFor(() => expect(screen.getByText('GitHub')).toBeTruthy())
    fireEvent.change(screen.getByLabelText('Search connectors'), { target: { value: 'git' } })
    expect(screen.queryByText('No project MCP connection resources exist.')).toBeNull()
  })

  it('clears URL-backed search filters', async () => {
    mockJson({ '/api/v1/connectors': page([connector()]) })

    render(
      withQueryClient(
        <MemoryRouter initialEntries={['/settings/mcp?search=GitHub']}>
          <Routes>
            <Route path="/settings/mcp" element={<McpPage />} />
          </Routes>
        </MemoryRouter>,
      ),
    )

    await waitFor(() => expect(screen.getByText('GitHub')).toBeTruthy())
    fireEvent.change(screen.getByLabelText('Search connectors'), { target: { value: '' } })
    expect(screen.queryByText('No project MCP connection resources exist.')).toBeNull()
  })

  it.each([
    [0, 'development'],
    [1, 'verified'],
    [2, 'repositories'],
  ])('updates URL-backed facet filter %i', async (index, value) => {
    await renderMcpPageAndSelect(index, value)
    expect(screen.queryByText('No project MCP connection resources exist.')).toBeNull()
  })

  it('shows catalog loading and error states', async () => {
    let resolveFetch: (response: Response) => void = () => undefined
    vi.stubGlobal(
      'fetch',
      vi.fn(
        () =>
          new Promise<Response>((resolve) => {
            resolveFetch = resolve
          }),
      ),
    )
    const loading = render(
      withQueryClient(
        <MemoryRouter initialEntries={['/settings/mcp']}>
          <Routes>
            <Route path="/settings/mcp" element={<McpPage />} />
          </Routes>
        </MemoryRouter>,
      ),
    )
    expect(screen.getByText('Loading MCP')).toBeTruthy()
    resolveFetch(new Response(JSON.stringify(page([])), { headers: { 'Content-Type': 'application/json' } }))
    loading.unmount()

    mockResponse(500, { error: { message: 'Catalog down' } })
    render(
      withQueryClient(
        <MemoryRouter initialEntries={['/settings/mcp']}>
          <Routes>
            <Route path="/settings/mcp" element={<McpPage />} />
          </Routes>
        </MemoryRouter>,
      ),
    )
    await waitFor(() => expect(screen.getByText('MCP unavailable')).toBeTruthy())
  })

  it('renders connector detail from the catalog', async () => {
    mockJson({ '/api/v1/connectors/github': connector() })

    render(
      withQueryClient(
        <MemoryRouter initialEntries={['/settings/mcp/github']}>
          <Routes>
            <Route path="/settings/mcp/:connectorId" element={<McpConnectorPage />} />
          </Routes>
        </MemoryRouter>,
      ),
    )

    await waitFor(() => expect(screen.getByText('Repository MCP server.')).toBeTruthy())
    expect(screen.getByText('repo.read')).toBeTruthy()
    expect(screen.queryByText('Connect')).toBeNull()
    expect(screen.queryByText('Disconnect')).toBeNull()
  })

  it('renders connector detail variants', async () => {
    mockJson({
      '/api/v1/connectors/linear': connector({
        id: 'linear',
        capabilities: [],
        supportedAuthModes: [],
        setupRequirements: [],
        tools: [],
      }),
    })

    render(
      withQueryClient(
        <MemoryRouter initialEntries={['/settings/mcp/linear']}>
          <Routes>
            <Route path="/settings/mcp/:connectorId" element={<McpConnectorPage />} />
          </Routes>
        </MemoryRouter>,
      ),
    )

    await waitFor(() => expect(screen.getByText('Connect the connector; no credential is required.')).toBeTruthy())
    expect(screen.getByText('This connector does not declare catalog tools.')).toBeTruthy()
  })

  it('renders connector detail fallbacks for credential setup and tool descriptions', async () => {
    mockJson({
      '/api/v1/connectors/github': connector({
        capabilities: [],
        setupRequirements: [],
        tools: [
          {
            name: 'repo.read',
            description: undefined as never,
            approvalMode: 'project_policy',
            inputSchema: {},
            policyMetadata: {},
          },
        ],
      }),
    })

    render(
      withQueryClient(
        <MemoryRouter initialEntries={['/settings/mcp/github']}>
          <Routes>
            <Route path="/settings/mcp/:connectorId" element={<McpConnectorPage />} />
          </Routes>
        </MemoryRouter>,
      ),
    )

    await waitFor(() => expect(screen.getAllByText('vault_credential')).toHaveLength(2))
    expect(screen.getByText('No description (approval: project_policy)')).toBeTruthy()
    expect(screen.getByText('None')).toBeTruthy()
  })

  it('renders unavailable connector detail and missing route params', async () => {
    mockJson({ '/api/v1/connectors/github': connector({ availability: 'unavailable' }) })
    const unavailable = render(
      withQueryClient(
        <MemoryRouter initialEntries={['/settings/mcp/github']}>
          <Routes>
            <Route path="/settings/mcp/:connectorId" element={<McpConnectorPage />} />
          </Routes>
        </MemoryRouter>,
      ),
    )
    await waitFor(() => expect(screen.getByText('Connector is unavailable on this platform.')).toBeTruthy())
    unavailable.unmount()

    mockJson({})
    render(
      withQueryClient(
        <MemoryRouter initialEntries={['/settings/mcp']}>
          <Routes>
            <Route path="/settings/mcp" element={<McpConnectorPage />} />
          </Routes>
        </MemoryRouter>,
      ),
    )
    expect(screen.getByText('Loading connector')).toBeTruthy()
  })

  it('renders connector loading, not-found, and error states', async () => {
    let resolveFetch: (response: Response) => void = () => undefined
    vi.stubGlobal(
      'fetch',
      vi.fn(
        () =>
          new Promise<Response>((resolve) => {
            resolveFetch = resolve
          }),
      ),
    )
    const loading = render(
      withQueryClient(
        <MemoryRouter initialEntries={['/settings/mcp/github']}>
          <Routes>
            <Route path="/settings/mcp/:connectorId" element={<McpConnectorPage />} />
          </Routes>
        </MemoryRouter>,
      ),
    )
    expect(screen.getByText('Loading connector')).toBeTruthy()
    resolveFetch(new Response(JSON.stringify(connector()), { headers: { 'Content-Type': 'application/json' } }))
    loading.unmount()

    mockResponse(404, { error: { message: 'not found' } })
    const notFound = render(
      withQueryClient(
        <MemoryRouter initialEntries={['/settings/mcp/missing']}>
          <Routes>
            <Route path="/settings/mcp/:connectorId" element={<McpConnectorPage />} />
          </Routes>
        </MemoryRouter>,
      ),
    )
    await waitFor(() => expect(screen.getByText('Connector not found')).toBeTruthy())
    notFound.unmount()

    mockResponse(500, { error: { message: 'catalog failed' } })
    render(
      withQueryClient(
        <MemoryRouter initialEntries={['/settings/mcp/github']}>
          <Routes>
            <Route path="/settings/mcp/:connectorId" element={<McpConnectorPage />} />
          </Routes>
        </MemoryRouter>,
      ),
    )
    await waitFor(() => expect(screen.getByText('Connector unavailable')).toBeTruthy())
  })
})
