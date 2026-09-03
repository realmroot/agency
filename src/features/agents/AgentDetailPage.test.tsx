/**
 * AgentDetailPage — integration tests via MSW + real api client.
 * Fetches: GET /api/v1/agents/:id, GET /api/v1/agents/:id/versions,
 *           GET /api/v1/sessions, PATCH/DELETE /api/v1/agents/:id
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { beforeEach, describe, expect, it } from 'vitest'
import type { Agent, AgentVersion, Session } from '@/lib/enborrpc'
import { createCollection, HttpResponse, http, server } from '@/test/msw'
import { type AgentOverrides, agent as resourceAgent } from '@/test/resource-fixtures'
import { AgentDetailPage } from './AgentDetailPage'

const now = '2026-05-23T00:00:00.000Z'

function buildAgent(overrides: AgentOverrides = {}): Agent {
  return resourceAgent({
    allowedTools: ['read'],
    createdAt: now,
    updatedAt: now,
    ...overrides,
  })
}

const emptyList = { data: [], pagination: { limit: 50, hasMore: false, nextCursor: null } }

function makeQueryClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
}

beforeEach(() => {
  server.use(
    http.get('*/api/v1/identities', () => HttpResponse.json(emptyList)),
    http.get('*/api/v1/providers/models', () => HttpResponse.json(emptyList)),
  )
})

/** Registers MSW handlers for a single agent detail + versions + sessions. */
function setupAgentHandlers(agent: Agent, versions: AgentVersion[] = [], sessions: Session[] = []) {
  server.use(
    http.get('*/api/v1/agents/:agentId', ({ params }) => {
      if (params.agentId === agent.metadata.uid) return HttpResponse.json(agent)
      return HttpResponse.json({ error: { type: 'not_found', message: 'Not found' } }, { status: 404 })
    }),
    http.get('*/api/v1/agents/:agentId/versions', () =>
      HttpResponse.json({ data: versions, pagination: { limit: 50, hasMore: false, nextCursor: null } }),
    ),
    http.get('*/api/v1/sessions', () =>
      HttpResponse.json({ data: sessions, pagination: { limit: 50, hasMore: false, nextCursor: null } }),
    ),
    http.patch('*/api/v1/agents/:agentId', async ({ params, request }) => {
      const body = (await request.json()) as Record<string, unknown>
      return HttpResponse.json(params.agentId === agent.metadata.uid ? buildAgent({ ...body }) : agent)
    }),
    // CreateSessionSheet (opened from detail page) also fetches agents + environments
    http.get('*/api/v1/environments', () => HttpResponse.json(emptyList)),
  )
}

function renderDetailPage(agentId = 'agent_1') {
  const client = makeQueryClient()
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[`/agents/${agentId}`]}>
        <Routes>
          <Route path="/agents/:agentId" element={<AgentDetailPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('[spec: agents/console-detail] AgentDetailPage', () => {
  it('renders detail page with agent data from API', async () => {
    setupAgentHandlers(buildAgent())
    renderDetailPage()
    expect(await screen.findByText('Coding agent')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Edit agent' })).toBeInTheDocument()
  })

  it('shows Create session button for a live agent', async () => {
    setupAgentHandlers(buildAgent())
    renderDetailPage()
    expect(await screen.findByRole('button', { name: 'Create session' })).toBeInTheDocument()
  })

  it('renders fallback title when agent is loading', () => {
    server.use(
      http.get('*/api/v1/agents/:agentId', () => new Promise(() => {})),
      http.get('*/api/v1/agents/:agentId/versions', () => new Promise(() => {})),
      http.get('*/api/v1/sessions', () => HttpResponse.json(emptyList)),
    )
    renderDetailPage()
    expect(screen.getByText('Agent detail')).toBeInTheDocument()
  })

  it('handles missing agentId param gracefully', () => {
    server.use(http.get('*/api/v1/sessions', () => HttpResponse.json(emptyList)))
    const client = makeQueryClient()
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={['/agents']}>
          <Routes>
            <Route path="/agents" element={<AgentDetailPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    )
    expect(screen.getByText('Agent detail')).toBeInTheDocument()
  })

  it('opens edit sheet when Edit agent button is clicked', async () => {
    setupAgentHandlers(buildAgent())
    renderDetailPage()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Edit agent' })).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: 'Edit agent' }))
    await waitFor(() => expect(screen.getByText('Edit Agent')).toBeInTheDocument())
  })

  it('calls updateAgent API when edit form is submitted', async () => {
    const agent = buildAgent()
    const agentsColl = createCollection([agent])
    server.use(
      http.get('*/api/v1/agents/:agentId', () => HttpResponse.json(agent)),
      http.get('*/api/v1/agents/:agentId/versions', () => HttpResponse.json(emptyList)),
      http.get('*/api/v1/sessions', () => HttpResponse.json(emptyList)),
      http.patch('*/api/v1/agents/:agentId', async ({ request }) => {
        const body = (await request.json()) as Record<string, unknown>
        const updated = { ...agent, ...body }
        agentsColl.put(updated as Agent)
        return HttpResponse.json(updated)
      }),
      http.get('*/api/v1/environments', () => HttpResponse.json(emptyList)),
    )
    renderDetailPage()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Edit agent' })).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: 'Edit agent' }))
    await waitFor(() => expect(screen.getByText('Edit Agent')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    // Expect the sheet closes (Edit Agent text gone) after success
    await waitFor(() => expect(screen.queryByText('Edit Agent')).toBeNull())
  })

  it('shows error in edit form when updateAgent fails', async () => {
    setupAgentHandlers(buildAgent())
    server.use(
      http.patch('*/api/v1/agents/:agentId', () =>
        HttpResponse.json({ error: { type: 'server_error', message: 'Update failed' } }, { status: 500 }),
      ),
    )
    renderDetailPage()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Edit agent' })).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: 'Edit agent' }))
    await waitFor(() => expect(screen.getByText('Edit Agent')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    expect(await screen.findByText('Update failed')).toBeInTheDocument()
  })

  it('shows Saving agent label when updateAgent is pending', async () => {
    setupAgentHandlers(buildAgent())
    server.use(http.patch('*/api/v1/agents/:agentId', () => new Promise(() => {})))
    renderDetailPage()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Edit agent' })).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: 'Edit agent' }))
    await waitFor(() => expect(screen.getByText('Edit Agent')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Saving agent' })).toBeInTheDocument())
  })

  it('renders agent with description in page header', async () => {
    setupAgentHandlers(buildAgent({ description: 'Does useful things' }))
    renderDetailPage()
    await waitFor(() => expect(screen.getByText(/Does useful things/)).toBeInTheDocument())
  })

  it('handles nullable systemPrompt, provider, and model in agentToForm', async () => {
    const agent = buildAgent({
      systemPrompt: null as unknown as string,
      provider: null as unknown as string,
      model: null as unknown as string,
    })
    setupAgentHandlers(agent)
    renderDetailPage()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Edit agent' })).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: 'Edit agent' }))
    await waitFor(() => expect(screen.getByText('Edit Agent')).toBeInTheDocument())
    // Just check it doesn't crash — form opens with empty string fallbacks
    expect(screen.getByText('Edit Agent')).toBeInTheDocument()
  })

  it('opens CreateSessionSheet when Create session button is clicked', async () => {
    const agent = buildAgent()
    server.use(
      http.get('*/api/v1/agents/:agentId', () => HttpResponse.json(agent)),
      http.get('*/api/v1/agents/:agentId/versions', () => HttpResponse.json(emptyList)),
      http.get('*/api/v1/sessions', () => HttpResponse.json(emptyList)),
      http.patch('*/api/v1/agents/:agentId', async ({ request }) => {
        const body = (await request.json()) as Record<string, unknown>
        return HttpResponse.json({ ...agent, ...body })
      }),
      http.get('*/api/v1/agents', () => HttpResponse.json(emptyList)),
      http.get('*/api/v1/environments', () => HttpResponse.json(emptyList)),
    )
    renderDetailPage()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Create session' })).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: 'Create session' }))
    await waitFor(() => expect(screen.getByText('Create Session')).toBeInTheDocument())
  })

  it('closes CreateSessionSheet via Escape key', async () => {
    const agent = buildAgent()
    server.use(
      http.get('*/api/v1/agents/:agentId', () => HttpResponse.json(agent)),
      http.get('*/api/v1/agents/:agentId/versions', () => HttpResponse.json(emptyList)),
      http.get('*/api/v1/sessions', () => HttpResponse.json(emptyList)),
      http.patch('*/api/v1/agents/:agentId', async ({ request }) => {
        const body = (await request.json()) as Record<string, unknown>
        return HttpResponse.json({ ...agent, ...body })
      }),
      http.get('*/api/v1/agents', () => HttpResponse.json(emptyList)),
      http.get('*/api/v1/environments', () => HttpResponse.json(emptyList)),
    )
    renderDetailPage()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Create session' })).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: 'Create session' }))
    await waitFor(() => expect(screen.getByText('Create Session')).toBeInTheDocument())
    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByText('Create Session')).toBeNull())
  })
})
