import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { toast } from 'sonner'
import { describe, expect, it, vi } from 'vitest'
import type { Identity } from '@/lib/amarpc'
import { HttpResponse, http, server } from '@/test/msw'
import { CreateIdentitySheet } from './CreateIdentitySheet'
import { IdentitiesPage } from './IdentitiesPage'
import { IdentityDetailPage } from './IdentityDetailPage'

const now = '2026-08-28T00:00:00.000Z'

function identity(overrides: Partial<Identity> = {}): Identity {
  return {
    metadata: {
      uid: 'identity_codex',
      projectId: 'project_1',
      name: 'Codex operator',
      description: 'Runtime-specific Realmroot identity',
      labels: {},
      annotations: {},
      createdBy: 'user_1',
      createdAt: now,
      updatedAt: now,
      archivedAt: null,
    },
    spec: { username: 'codex-operator', runtime: 'codex' },
    status: {
      phase: 'active',
      state: 'active',
      failureCode: null,
      boundAgentId: null,
      descriptor: {
        identityId: 'identity_codex',
        agentId: 'realmroot_agent_1',
        issuer: 'https://id.realmroot.dev/api/auth',
        subject: 'agent:realmroot_agent_1',
        username: 'codex-operator',
        runtime: 'codex',
      },
    },
    ...overrides,
  }
}

function identityInState(state: 'provisioning' | 'error', overrides: Partial<Identity> = {}): Identity {
  const fixture = identity(overrides)
  Object.assign(fixture.status, {
    phase: state,
    state,
    failureCode: state === 'error' ? 'authorization_failed' : null,
  })
  return fixture
}

const list = (data: Identity[]) => ({
  data,
  pagination: { limit: 50, hasMore: false, nextCursor: null },
})

function client() {
  return new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
}

describe('[spec: identities/console] Identity console', () => {
  it('creates a Codex Identity with an idempotency key', async () => {
    let postedBody: Record<string, unknown> | null = null
    let idempotencyKey: string | null = null
    let finishRequest!: () => void
    const pendingRequest = new Promise<void>((resolve) => {
      finishRequest = resolve
    })
    server.use(
      http.post('*/api/v1/identities', async ({ request }) => {
        postedBody = (await request.json()) as Record<string, unknown>
        idempotencyKey = request.headers.get('idempotency-key')
        await pendingRequest
        return HttpResponse.json(identity(), { status: 201 })
      }),
    )
    const onOpenChange = () => {}
    render(
      <QueryClientProvider client={client()}>
        <MemoryRouter>
          <CreateIdentitySheet open onOpenChange={onOpenChange} />
        </MemoryRouter>
      </QueryClientProvider>,
    )

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Codex operator' } })
    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'codex-operator' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create identity' }))

    await waitFor(() => expect(postedBody).not.toBeNull())
    expect(screen.getByRole('button', { name: 'Creating identity…' })).toBeDisabled()
    expect(postedBody).toEqual({
      metadata: { name: 'Codex operator' },
      spec: { username: 'codex-operator', runtime: 'codex' },
    })
    expect(idempotencyKey).toMatch(/^[0-9a-f-]{36}$/i)
    finishRequest()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Create identity' })).toBeDisabled())
  })

  it('submits optional description and a changed runtime, then resets and closes', async () => {
    Element.prototype.scrollIntoView = vi.fn()
    let postedBody: Record<string, unknown> | null = null
    const onOpenChange = vi.fn()
    server.use(
      http.post('*/api/v1/identities', async ({ request }) => {
        postedBody = (await request.json()) as Record<string, unknown>
        return HttpResponse.json(identity({ spec: { username: 'reviewer', runtime: 'copilot' } }), { status: 201 })
      }),
    )
    render(
      <QueryClientProvider client={client()}>
        <MemoryRouter>
          <CreateIdentitySheet open onOpenChange={onOpenChange} />
        </MemoryRouter>
      </QueryClientProvider>,
    )

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Copilot reviewer' } })
    fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'Reviews pull requests' } })
    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'reviewer' } })
    fireEvent.click(screen.getByRole('combobox'))
    fireEvent.click(await screen.findByRole('option', { name: 'Copilot' }))
    fireEvent.click(screen.getByRole('button', { name: 'Create identity' }))

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
    expect(postedBody).toEqual({
      metadata: { name: 'Copilot reviewer', description: 'Reviews pull requests' },
      spec: { username: 'reviewer', runtime: 'copilot' },
    })
  })

  it('reports provisioning errors and keeps the Sheet open for retry', async () => {
    const onOpenChange = vi.fn()
    const errorToast = vi.spyOn(toast, 'error')
    server.use(
      http.post('*/api/v1/identities', () =>
        HttpResponse.json(
          { error: { type: 'identity_provisioning_in_progress', message: 'Still provisioning' } },
          { status: 409 },
        ),
      ),
    )
    render(
      <QueryClientProvider client={client()}>
        <MemoryRouter>
          <CreateIdentitySheet open onOpenChange={onOpenChange} />
        </MemoryRouter>
      </QueryClientProvider>,
    )
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Retry me' } })
    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'retry-me' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create identity' }))

    await waitFor(() => expect(errorToast).toHaveBeenCalled())
    expect(onOpenChange).not.toHaveBeenCalledWith(false)
  })

  it('lists Identity-safe metadata and opens the create Sheet', async () => {
    server.use(http.get('*/api/v1/identities', () => HttpResponse.json(list([identity()]))))
    render(
      <QueryClientProvider client={client()}>
        <MemoryRouter>
          <IdentitiesPage />
        </MemoryRouter>
      </QueryClientProvider>,
    )

    expect(await screen.findByRole('link', { name: 'Codex operator' })).toBeTruthy()
    expect(screen.getByText('codex')).toBeTruthy()
    expect(screen.getByRole('columnheader', { name: 'Assigned agent' })).toBeTruthy()
    expect(screen.getByText('Unassigned')).toBeTruthy()
    expect(screen.queryByText(/private_key|access_token|state\.json/i)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Create identity' }))
    expect(await screen.findByRole('heading', { name: 'Create Identity' })).toBeTruthy()
  })

  it('shows plain-language provisioning and error statuses', async () => {
    server.use(
      http.get('*/api/v1/identities', () =>
        HttpResponse.json(
          list([
            identityInState('provisioning', {
              metadata: { ...identity().metadata, uid: 'identity_creating', name: 'Creating operator' },
            }),
            identityInState('error', {
              metadata: { ...identity().metadata, uid: 'identity_error', name: 'Attention operator' },
            }),
          ]),
        ),
      ),
    )
    render(
      <QueryClientProvider client={client()}>
        <MemoryRouter>
          <IdentitiesPage />
        </MemoryRouter>
      </QueryClientProvider>,
    )

    expect(await screen.findByText('Creating')).toBeTruthy()
    expect(screen.getByText('Needs attention')).toHaveAttribute('data-variant', 'destructive')
    expect(screen.queryByText('provisioning')).toBeNull()
    expect(screen.queryByText('error')).toBeNull()
  })

  it('archives an unbound Identity only after destructive confirmation', async () => {
    let patchBody: Record<string, unknown> | null = null
    server.use(
      http.get('*/api/v1/identities', () => HttpResponse.json(list([identity()]))),
      http.patch('*/api/v1/identities/:identityId', async ({ request }) => {
        patchBody = (await request.json()) as Record<string, unknown>
        return HttpResponse.json(identity({ metadata: { ...identity().metadata, archivedAt: now } }))
      }),
    )
    render(
      <QueryClientProvider client={client()}>
        <MemoryRouter>
          <IdentitiesPage />
        </MemoryRouter>
      </QueryClientProvider>,
    )

    fireEvent.click(await screen.findByRole('button', { name: 'Archive identity' }))
    const dialog = await screen.findByRole('alertdialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Archive identity' }))

    await waitFor(() => expect(patchBody).toEqual({ archived: true }))
  })

  it('reports an archive conflict from the list page', async () => {
    const errorToast = vi.spyOn(toast, 'error')
    server.use(
      http.get('*/api/v1/identities', () => HttpResponse.json(list([identity()]))),
      http.patch('*/api/v1/identities/:identityId', () =>
        HttpResponse.json({ error: { type: 'identity_in_use', message: 'Identity is in use' } }, { status: 409 }),
      ),
    )
    render(
      <QueryClientProvider client={client()}>
        <MemoryRouter>
          <IdentitiesPage />
        </MemoryRouter>
      </QueryClientProvider>,
    )
    fireEvent.click(await screen.findByRole('button', { name: 'Archive identity' }))
    fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Archive identity' }))
    await waitFor(() => expect(errorToast).toHaveBeenCalled())
  })

  it('renders the empty list and archived/bound rows without archive actions', async () => {
    const queryClient = client()
    server.use(http.get('*/api/v1/identities', () => HttpResponse.json(list([]))))
    const rendered = render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <IdentitiesPage />
        </MemoryRouter>
      </QueryClientProvider>,
    )
    expect(await screen.findByText('No identities')).toBeTruthy()

    rendered.unmount()
    server.use(
      http.get('*/api/v1/identities', () =>
        HttpResponse.json(
          list([
            identity({
              metadata: { ...identity().metadata, archivedAt: now, description: null },
              status: { ...identity().status, boundAgentId: 'agent_bound' },
            }),
          ]),
        ),
      ),
    )
    render(
      <QueryClientProvider client={client()}>
        <MemoryRouter>
          <IdentitiesPage />
        </MemoryRouter>
      </QueryClientProvider>,
    )
    expect(await screen.findByText('Assigned')).toBeTruthy()
    expect(screen.getByText('Archived')).toHaveAttribute('data-variant', 'secondary')
    expect(screen.queryByText('agent_bound')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Archive identity' })).toBeNull()
  })

  it('shows immutable username and Runtime metadata without credential state', async () => {
    server.use(
      http.get('*/api/v1/identities/:identityId', () =>
        HttpResponse.json(identity({ status: { ...identity().status, boundAgentId: 'agent_bound_internal_1' } })),
      ),
    )
    render(
      <QueryClientProvider client={client()}>
        <MemoryRouter initialEntries={['/identities/identity_codex']}>
          <Routes>
            <Route path="/identities/:identityId" element={<IdentityDetailPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    )

    expect(await screen.findByText('Codex operator')).toBeTruthy()
    expect(screen.getByText('The username and runtime cannot be changed after creation.')).toBeTruthy()
    expect(screen.getByText('Username')).toBeTruthy()
    expect(screen.getByText('Assigned agent')).toBeTruthy()
    expect(screen.getByText('Status')).toBeTruthy()
    expect(screen.getAllByText('Active').length).toBeGreaterThan(0)
    expect(screen.getByText('Assigned')).toBeTruthy()
    expect(screen.queryByText('agent_bound_internal_1')).toBeNull()
    expect(screen.queryByText('realmroot_agent_1')).toBeNull()
    expect(screen.queryByText('External ID')).toBeNull()
    expect(screen.getByText('codex')).toBeTruthy()
    expect(screen.queryByText(/private_key|access_token|credentialRef/i)).toBeNull()
  })

  it('shows not found when no Identity route parameter is available', async () => {
    render(
      <QueryClientProvider client={client()}>
        <MemoryRouter>
          <IdentityDetailPage />
        </MemoryRouter>
      </QueryClientProvider>,
    )
    expect(await screen.findByText('Identity not found')).toBeTruthy()
  })
})
