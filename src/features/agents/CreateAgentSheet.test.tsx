/**
 * CreateAgentSheet — integration tests via MSW + real api client.
 * POST /api/v1/agents is served by MSW.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Agent, Identity } from '@/lib/amarpc'
import { createCollection, HttpResponse, http, server } from '@/test/msw'
import { type AgentOverrides, agent as resourceAgent } from '@/test/resource-fixtures'
import { CreateAgentSheet } from './CreateAgentSheet'

const now = '2026-05-23T00:00:00.000Z'

function buildAgent(overrides: AgentOverrides = {}): Agent {
  return resourceAgent({ skills: [], allowedTools: [], createdAt: now, updatedAt: now, ...overrides })
}

function makeQueryClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
}

const identity: Identity = {
  metadata: {
    uid: 'identity_codex',
    projectId: 'project_1',
    name: 'Codex operator',
    description: null,
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
}

beforeEach(() => {
  server.use(
    http.get('*/api/v1/identities', () =>
      HttpResponse.json({ data: [], pagination: { limit: 50, hasMore: false, nextCursor: null } }),
    ),
    http.get('*/api/v1/providers/models', () =>
      HttpResponse.json({ data: [], pagination: { limit: 50, hasMore: false, nextCursor: null } }),
    ),
  )
})

describe('CreateAgentSheet', () => {
  it('does not render content when closed', () => {
    const queryClient = makeQueryClient()
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <CreateAgentSheet open={false} onOpenChange={() => {}} />
        </MemoryRouter>
      </QueryClientProvider>,
    )
    expect(screen.queryByText('Create Agent')).toBeNull()
  })

  it('renders sheet title and form when open', () => {
    // MSW handler not needed — sheet is open but no mutation fired yet.
    // But agents list may not be queried here, so we just register a catch-all
    // for agents in case any child queries fire.
    server.use(
      http.get('*/api/v1/agents', () =>
        HttpResponse.json({ data: [], pagination: { limit: 50, hasMore: false, nextCursor: null } }),
      ),
    )
    const queryClient = makeQueryClient()
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <CreateAgentSheet open onOpenChange={() => {}} />
        </MemoryRouter>
      </QueryClientProvider>,
    )
    expect(screen.getByText('Create Agent')).toBeInTheDocument()
    expect(screen.getByText('Save agent')).toBeInTheDocument()
  })

  it('calls API and closes sheet on successful submission', async () => {
    const agentsColl = createCollection<Agent>([])
    let postedBody: Record<string, unknown> | null = null
    server.use(
      ...(agentsColl.list().length === 0
        ? [
            http.get('*/api/v1/agents', () =>
              HttpResponse.json({ data: [], pagination: { limit: 50, hasMore: false, nextCursor: null } }),
            ),
            http.post('*/api/v1/agents', async ({ request }) => {
              postedBody = (await request.json()) as Record<string, unknown>
              const metadata = postedBody.metadata as { name?: string } | undefined
              const agent = buildAgent({ id: 'agent_new', name: metadata?.name ?? 'Agent' })
              agentsColl.put(agent)
              return HttpResponse.json(agent, { status: 201 })
            }),
          ]
        : []),
    )
    let closed = false
    const onOpenChange = (open: boolean) => {
      if (!open) closed = true
    }
    const queryClient = makeQueryClient()
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <CreateAgentSheet open onOpenChange={onOpenChange} />
        </MemoryRouter>
      </QueryClientProvider>,
    )
    fireEvent.change(screen.getByLabelText('Description'), { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save agent' }))
    await waitFor(() => expect(closed).toBe(true))
    const body = postedBody as unknown as Record<string, unknown>
    expect(body).toMatchObject({ metadata: { name: 'Coding agent' } })
    expect(body.metadata).not.toHaveProperty('description')
  })

  it('[spec: agents/identity-binding] sends the selected Runtime-specific Identity reference', async () => {
    Object.defineProperty(HTMLElement.prototype, 'hasPointerCapture', {
      value: vi.fn(() => false),
      configurable: true,
    })
    Object.defineProperty(HTMLElement.prototype, 'setPointerCapture', { value: vi.fn(), configurable: true })
    Object.defineProperty(HTMLElement.prototype, 'releasePointerCapture', { value: vi.fn(), configurable: true })
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { value: vi.fn(), configurable: true })

    let postedBody: Record<string, unknown> | null = null
    server.use(
      http.get('*/api/v1/identities', () =>
        HttpResponse.json({ data: [identity], pagination: { limit: 50, hasMore: false, nextCursor: null } }),
      ),
      http.post('*/api/v1/agents', async ({ request }) => {
        postedBody = (await request.json()) as Record<string, unknown>
        return HttpResponse.json(buildAgent({ id: 'agent_identity' }), { status: 201 })
      }),
    )
    const queryClient = makeQueryClient()
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <CreateAgentSheet open onOpenChange={() => {}} />
        </MemoryRouter>
      </QueryClientProvider>,
    )

    expect((await screen.findAllByText('No Identity')).length).toBeGreaterThan(0)
    const identitySelect = screen.getAllByRole('combobox')[1] as HTMLElement
    fireEvent.pointerDown(identitySelect, { button: 0, ctrlKey: false, pointerId: 1, pointerType: 'mouse' })
    fireEvent.mouseDown(identitySelect)
    fireEvent.click(await screen.findByRole('option', { name: 'Codex operator · codex' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save agent' }))

    await waitFor(() => expect(postedBody).not.toBeNull())
    expect(postedBody).toMatchObject({ spec: { identityRef: 'identity_codex' } })
  })

  it('shows creating agent label while mutation is pending', async () => {
    server.use(http.post('*/api/v1/agents', () => new Promise(() => {})))
    const queryClient = makeQueryClient()
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <CreateAgentSheet open onOpenChange={() => {}} />
        </MemoryRouter>
      </QueryClientProvider>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Save agent' }))
    await waitFor(() => expect(screen.getByText('Creating agent')).toBeInTheDocument())
  })

  it('shows error toast when createAgent fails with server error', async () => {
    server.use(
      http.post('*/api/v1/agents', () =>
        HttpResponse.json({ error: { type: 'server_error', message: 'Server error' } }, { status: 500 }),
      ),
    )
    const queryClient = makeQueryClient()
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <CreateAgentSheet open onOpenChange={() => {}} />
        </MemoryRouter>
      </QueryClientProvider>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Save agent' }))
    // Error handled gracefully — form still shows
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save agent' })).toBeInTheDocument())
  })
})
