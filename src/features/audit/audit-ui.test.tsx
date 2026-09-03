import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { describe, expect, it, vi } from 'vitest'
import type { ClientPagination } from '@/console/use-client-pagination'
import type { AuditRecord } from '@/lib/enborrpc'
import { createCollection, HttpResponse, http, server } from '@/test/msw'
import { AuditPage } from './AuditPage'
import { AuditRecordPage } from './AuditRecordPage'
import { AuditView } from './AuditView'

function buildRecord(overrides: Partial<AuditRecord> = {}): AuditRecord {
  return {
    id: 'audit_1',
    projectId: 'project_1',
    actorUserId: 'user_1',
    controllerUserId: null,
    actorType: 'user',
    action: 'access_rule.create',
    resourceType: 'access_rule',
    resourceId: 'access_1',
    outcome: 'success',
    requestId: 'req_1',
    correlationId: 'corr_1',
    sessionId: null,
    policyCategory: null,
    metadata: { source: 'console' },
    before: {},
    after: { effect: 'deny' },
    createdAt: '2026-05-23T00:00:00.000Z',
    ...overrides,
  }
}

function pagination(records: AuditRecord[]): ClientPagination<AuditRecord> {
  return {
    items: records,
    page: 1,
    pageCount: 1,
    pageSize: 10,
    total: records.length,
    start: records.length === 0 ? 0 : 1,
    end: records.length,
    canPrevious: false,
    canNext: false,
    viewportRef: { current: null },
    previous: vi.fn(),
    next: vi.fn(),
  }
}

// ─── AuditView ───────────────────────────────────────────────────────────────

describe('[spec: audit/console-list] AuditView', () => {
  it('renders one row per record with action, outcome, resource, actor, policy, and request', () => {
    const records = [
      buildRecord(),
      buildRecord({
        id: 'audit_2',
        action: 'policy.evaluate',
        outcome: 'denied',
        resourceType: 'provider',
        resourceId: 'workers-ai',
        policyCategory: 'provider',
      }),
    ]
    render(
      <MemoryRouter>
        <AuditView records={records} pagination={pagination(records)} />
      </MemoryRouter>,
    )

    const table = screen.getByRole('table')
    expect(within(table).getAllByRole('row')).toHaveLength(3)
    expect(screen.getByText('access_rule.create')).toBeInTheDocument()
    expect(screen.getByText('policy.evaluate')).toBeInTheDocument()
    expect(screen.getByText('denied')).toBeInTheDocument()
    expect(screen.getByText('access_rule / access_1')).toBeInTheDocument()
  })

  it('shows an empty state when no records match', () => {
    render(
      <MemoryRouter>
        <AuditView records={[]} pagination={pagination([])} />
      </MemoryRouter>,
    )

    expect(screen.getByText('No audit records')).toBeInTheDocument()
  })

  it('renders None when resourceId is null', () => {
    const records = [buildRecord({ resourceId: null })]
    render(
      <MemoryRouter>
        <AuditView records={records} pagination={pagination(records)} />
      </MemoryRouter>,
    )

    expect(screen.getByText('access_rule / None')).toBeInTheDocument()
  })

  it('renders actor type when actorUserId is null', () => {
    const records = [buildRecord({ actorUserId: null })]
    render(
      <MemoryRouter>
        <AuditView records={records} pagination={pagination(records)} />
      </MemoryRouter>,
    )

    expect(screen.getByText('user')).toBeInTheDocument()
  })

  it('renders None for missing optional fields', () => {
    const records = [
      buildRecord({
        requestId: null,
        policyCategory: null,
      }),
    ]
    render(
      <MemoryRouter>
        <AuditView records={records} pagination={pagination(records)} />
      </MemoryRouter>,
    )

    expect(screen.getAllByText('None').length).toBeGreaterThan(0)
  })
})

// ─── AuditRecordPage ─────────────────────────────────────────────────────────

describe('[spec: audit/console-detail] AuditRecordPage', () => {
  function makeClient() {
    return new QueryClient({ defaultOptions: { queries: { retry: false } } })
  }

  function renderRecordPage(recordId = 'audit_1') {
    return render(
      <QueryClientProvider client={makeClient()}>
        <MemoryRouter initialEntries={[`/audit/${recordId}`]}>
          <Routes>
            <Route path="/audit/:recordId" element={<AuditRecordPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    )
  }

  it('renders actor, correlation, resource link, and before/after change', async () => {
    const record = buildRecord({
      action: 'vault.credential.update',
      resourceType: 'vault',
      resourceId: 'vault_1',
      before: { name: 'Workers token' },
      after: { name: 'Workers token v2' },
    })
    server.use(http.get('*/api/v1/audit-records/audit_1', () => HttpResponse.json(record)))

    renderRecordPage()

    expect(await screen.findByRole('heading', { name: 'vault.credential.update' })).toBeInTheDocument()
    expect(screen.getByText('user_1')).toBeInTheDocument()
    expect(screen.getByText('corr_1')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Open vault' })).toBeInTheDocument()
    await waitFor(() => expect(screen.getByText(/Workers token v2/)).toBeInTheDocument())
  })

  it('renders resource type without a link when resource type has no route', async () => {
    const record = buildRecord({
      action: 'unknown_resource.update',
      resourceType: 'access_rule',
      resourceId: 'rule_1',
    })
    server.use(http.get('*/api/v1/audit-records/audit_1', () => HttpResponse.json(record)))

    renderRecordPage()

    expect(await screen.findByRole('heading', { name: 'unknown_resource.update' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /^Open / })).toBeNull()
  })

  it('renders without a resource link when resourceId is null', async () => {
    const record = buildRecord({
      action: 'provider.create',
      resourceType: 'provider',
      resourceId: null,
    })
    server.use(http.get('*/api/v1/audit-records/audit_1', () => HttpResponse.json(record)))

    renderRecordPage()

    expect(await screen.findByRole('heading', { name: 'provider.create' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /^Open / })).toBeNull()
  })

  it('shows loading state while the query is pending', () => {
    // MSW never responds — keeps query in pending state
    server.use(http.get('*/api/v1/audit-records/audit_1', () => new Promise(() => {})))

    renderRecordPage()

    expect(screen.getByText('Loading audit record')).toBeInTheDocument()
  })

  it('shows error state when the query fails', async () => {
    server.use(
      http.get('*/api/v1/audit-records/audit_1', () =>
        HttpResponse.json({ error: { type: 'not_found', message: 'Not found' } }, { status: 404 }),
      ),
    )

    renderRecordPage()

    expect(await screen.findByText('Audit record unavailable')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Back to audit log' })).toBeInTheDocument()
  })

  it('renders agent and environment resource links', async () => {
    const agentRecord = buildRecord({
      action: 'agent.update',
      resourceType: 'agent',
      resourceId: 'agent_1',
    })
    server.use(http.get('*/api/v1/audit-records/audit_1', () => HttpResponse.json(agentRecord)))

    renderRecordPage()

    expect(await screen.findByRole('link', { name: 'Open agent' })).toBeInTheDocument()
  })

  it('renders None for null optional record fields and falls back to actorType when actorUserId is null', async () => {
    const record = buildRecord({
      action: 'session.close',
      actorUserId: null,
      requestId: null,
      correlationId: null,
      sessionId: null,
      policyCategory: null,
      projectId: null,
    })
    server.use(http.get('*/api/v1/audit-records/audit_1', () => HttpResponse.json(record)))

    renderRecordPage()

    expect(await screen.findByRole('heading', { name: 'session.close' })).toBeInTheDocument()
    expect(screen.getAllByText('user').length).toBeGreaterThan(0)
    expect(screen.getAllByText('None').length).toBeGreaterThan(0)
  })
})

// ─── AuditPage ───────────────────────────────────────────────────────────────

describe('[spec: audit/console-list] AuditPage', () => {
  function makeAuditPageSetup(seedRecords: AuditRecord[] = []) {
    const records = createCollection<AuditRecord>(seedRecords)
    server.use(
      http.get('*/api/v1/audit-records', () =>
        HttpResponse.json({ data: records.list(), pagination: { limit: 50, hasMore: false, nextCursor: null } }),
      ),
    )
    return records
  }

  function renderAuditPage(initialSearch = '') {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    return render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={[`/audit${initialSearch}`]}>
          <Routes>
            <Route path="/audit" element={<AuditPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    )
  }

  it('renders the page header and all filter inputs', async () => {
    makeAuditPageSetup([])
    renderAuditPage()

    expect(screen.getByText('Audit')).toBeInTheDocument()
    expect(screen.getByLabelText('Filter by action')).toBeInTheDocument()
    expect(screen.getByLabelText('Filter by resource type')).toBeInTheDocument()
    expect(screen.getByLabelText('Filter by actor')).toBeInTheDocument()
    expect(screen.getByLabelText('Audit from')).toBeInTheDocument()
    expect(screen.getByLabelText('Audit to')).toBeInTheDocument()
  })

  it('shows empty state when api returns no records', async () => {
    makeAuditPageSetup([])
    renderAuditPage()

    expect(await screen.findByText('No audit records')).toBeInTheDocument()
  })

  it('updates action filter input when user types', async () => {
    makeAuditPageSetup([])
    renderAuditPage()

    const actionInput = screen.getByLabelText('Filter by action')
    fireEvent.change(actionInput, { target: { value: 'agent.create' } })
    expect((actionInput as HTMLInputElement).value).toBe('agent.create')
  })

  it('updates resource type filter when user types', async () => {
    makeAuditPageSetup([])
    renderAuditPage()

    const resourceTypeInput = screen.getByLabelText('Filter by resource type')
    fireEvent.change(resourceTypeInput, { target: { value: 'vault' } })
    expect((resourceTypeInput as HTMLInputElement).value).toBe('vault')
  })

  it('updates actor filter when user types', async () => {
    makeAuditPageSetup([])
    renderAuditPage()

    const actorInput = screen.getByLabelText('Filter by actor')
    fireEvent.change(actorInput, { target: { value: 'user_abc' } })
    expect((actorInput as HTMLInputElement).value).toBe('user_abc')
  })

  it('updates date range filters when user types', async () => {
    makeAuditPageSetup([])
    renderAuditPage()

    const fromInput = screen.getByLabelText('Audit from')
    const toInput = screen.getByLabelText('Audit to')
    fireEvent.change(fromInput, { target: { value: '2026-01-01T00:00' } })
    fireEvent.change(toInput, { target: { value: '2026-06-01T00:00' } })
    expect((fromInput as HTMLInputElement).value).toBe('2026-01-01T00:00')
    expect((toInput as HTMLInputElement).value).toBe('2026-06-01T00:00')
  })

  it('renders with pre-existing URL filters applied', async () => {
    makeAuditPageSetup([])
    renderAuditPage('?action=agent.create&outcome=success')

    const actionInput = screen.getByLabelText('Filter by action')
    expect((actionInput as HTMLInputElement).value).toBe('agent.create')
  })

  it('renders records returned by the api', async () => {
    makeAuditPageSetup([buildRecord({ id: 'audit_10', action: 'session.create', outcome: 'success' })])
    renderAuditPage()

    expect(await screen.findByText('session.create')).toBeInTheDocument()
  })

  it('passes date range from URL params to the query', async () => {
    let capturedUrl: URL | null = null
    server.use(
      http.get('*/api/v1/audit-records', ({ request }) => {
        capturedUrl = new URL(request.url)
        return HttpResponse.json({ data: [], pagination: { limit: 50, hasMore: false, nextCursor: null } })
      }),
    )
    renderAuditPage('?createdFrom=2026-01-01T00%3A00&createdTo=2026-06-01T00%3A00')

    await waitFor(() => expect(capturedUrl).not.toBeNull())
    expect(capturedUrl!.searchParams.get('from')).toBeTruthy()
    expect(capturedUrl!.searchParams.get('to')).toBeTruthy()
  })

  it('passes projectId from URL param to the query', async () => {
    let capturedUrl: URL | null = null
    server.use(
      http.get('*/api/v1/audit-records', ({ request }) => {
        capturedUrl = new URL(request.url)
        return HttpResponse.json({ data: [], pagination: { limit: 50, hasMore: false, nextCursor: null } })
      }),
    )
    renderAuditPage('?projectId=project_abc')

    await waitFor(() => expect(capturedUrl?.searchParams.get('projectId')).toBe('project_abc'))
  })
})
