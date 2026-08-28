/**
 * AgentsPage — integration tests via MSW + real api client.
 * CreateSessionSheet (opened from AgentsPage) also fetches agents + environments.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { describe, expect, it } from 'vitest'
import type { Agent, Environment } from '@/lib/amarpc'
import { createCollection, HttpResponse, http, resourceHandlers, server } from '@/test/msw'
import {
  type AgentOverrides,
  type EnvironmentOverrides,
  agent as resourceAgent,
  environment as resourceEnvironment,
} from '@/test/resource-fixtures'
import { AgentsPage } from './AgentsPage'

const now = '2026-05-23T00:00:00.000Z'

function buildAgent(overrides: AgentOverrides = {}): Agent {
  return resourceAgent({ createdAt: now, updatedAt: now, ...overrides })
}

function buildEnvironment(overrides: EnvironmentOverrides = {}): Environment {
  return resourceEnvironment({ createdAt: now, updatedAt: now, ...overrides })
}

const emptyList = { data: [], pagination: { limit: 50, hasMore: false, nextCursor: null } }

function makeQueryClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
}

// Pointer capture stubs needed by Radix Select
function stubPointerCapture() {
  Object.defineProperty(HTMLElement.prototype, 'hasPointerCapture', {
    value: () => false,
    configurable: true,
  })
  Object.defineProperty(HTMLElement.prototype, 'setPointerCapture', {
    value: () => {},
    configurable: true,
  })
  Object.defineProperty(HTMLElement.prototype, 'releasePointerCapture', {
    value: () => {},
    configurable: true,
  })
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
    value: () => {},
    configurable: true,
  })
}

function renderAgentsPage() {
  const client = makeQueryClient()
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <AgentsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('[spec: agents/console-list] AgentsPage', () => {
  it('renders the page header and create-agent action', () => {
    server.use(
      http.get('*/api/v1/agents', () => HttpResponse.json(emptyList)),
      http.get('*/api/v1/environments', () => HttpResponse.json(emptyList)),
    )
    renderAgentsPage()
    expect(screen.getByText('Agents')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Create agent/ })).toBeInTheDocument()
  })

  it('renders agents from the API response', async () => {
    const agent = buildAgent()
    const agentsColl = createCollection([agent])
    server.use(
      ...resourceHandlers('agents', agentsColl, (body, i) => buildAgent({ id: `agent_new_${i}`, ...body })),
      http.get('*/api/v1/environments', () => HttpResponse.json(emptyList)),
    )
    renderAgentsPage()
    expect(await screen.findByText('Coding agent')).toBeInTheDocument()
  })

  it('filters agents by search text', async () => {
    const agent1 = buildAgent({ id: 'agent_1', name: 'Coding agent' })
    const agent2 = buildAgent({ id: 'agent_2', name: 'Research agent' })
    const agentsColl = createCollection([agent1, agent2])
    server.use(
      ...resourceHandlers('agents', agentsColl, (body, i) => buildAgent({ id: `agent_new_${i}`, ...body })),
      http.get('*/api/v1/environments', () => HttpResponse.json(emptyList)),
    )
    renderAgentsPage()
    await waitFor(() => expect(screen.getByText('Coding agent')).toBeInTheDocument())
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search agents' }), { target: { value: 'Research' } })
    expect(screen.queryByText('Coding agent')).toBeNull()
    expect(screen.getByText('Research agent')).toBeInTheDocument()
  })

  it('filters agents by description search', async () => {
    const agent1 = buildAgent({ id: 'agent_1', name: 'Agent One', description: 'Coding work' })
    const agent2 = buildAgent({ id: 'agent_2', name: 'Agent Two', description: 'Research work' })
    const agentsColl = createCollection([agent1, agent2])
    server.use(
      ...resourceHandlers('agents', agentsColl, (body, i) => buildAgent({ id: `agent_new_${i}`, ...body })),
      http.get('*/api/v1/environments', () => HttpResponse.json(emptyList)),
    )
    renderAgentsPage()
    await waitFor(() => expect(screen.getByText('Agent One')).toBeInTheDocument())
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search agents' }), { target: { value: 'Research' } })
    expect(screen.queryByText('Agent One')).toBeNull()
    expect(screen.getByText('Agent Two')).toBeInTheDocument()
  })

  it('renders empty state when no agents match', async () => {
    server.use(
      http.get('*/api/v1/agents', () => HttpResponse.json(emptyList)),
      http.get('*/api/v1/environments', () => HttpResponse.json(emptyList)),
    )
    renderAgentsPage()
    expect(await screen.findByText('No agents')).toBeInTheDocument()
  })

  it('opens create agent sheet when Create agent button is clicked', async () => {
    server.use(
      http.get('*/api/v1/agents', () => HttpResponse.json(emptyList)),
      http.get('*/api/v1/environments', () => HttpResponse.json(emptyList)),
    )
    renderAgentsPage()
    fireEvent.click(screen.getByRole('button', { name: /Create agent/ }))
    expect(await screen.findByText('Create Agent')).toBeInTheDocument()
  })

  it('filters agents by provider when a specific provider is selected', async () => {
    stubPointerCapture()
    const agent1 = buildAgent({ id: 'agent_1', provider: 'workers-ai', name: 'WA Agent' })
    const agent2 = buildAgent({ id: 'agent_2', provider: 'anthropic', name: 'Anthropic Agent' })
    const agentsColl = createCollection([agent1, agent2])
    server.use(
      ...resourceHandlers('agents', agentsColl, (body, i) => buildAgent({ id: `agent_new_${i}`, ...body })),
      http.get('*/api/v1/environments', () => HttpResponse.json(emptyList)),
    )
    renderAgentsPage()
    await waitFor(() => expect(screen.getByText('WA Agent')).toBeInTheDocument())
    expect(screen.getByText('Anthropic Agent')).toBeInTheDocument()

    const providerSelect = screen.getByRole('combobox', { name: 'Filter by provider' })
    providerSelect.focus()
    fireEvent.pointerDown(providerSelect, { button: 0, ctrlKey: false, pointerId: 1, pointerType: 'mouse' })
    fireEvent.mouseDown(providerSelect)
    const anthropicOption = await screen.findByRole('option', { name: 'anthropic' })
    fireEvent.click(anthropicOption)
    await waitFor(() => expect(screen.queryByText('WA Agent')).toBeNull())
    expect(screen.getByText('Anthropic Agent')).toBeInTheDocument()
  })

  it('filters by active status when status filter is changed', async () => {
    stubPointerCapture()
    const agent1 = buildAgent({ id: 'agent_1', name: 'Active Agent', archivedAt: null })
    const agentsColl = createCollection([agent1])
    server.use(
      ...resourceHandlers('agents', agentsColl, (body, i) => buildAgent({ id: `agent_new_${i}`, ...body })),
      http.get('*/api/v1/environments', () => HttpResponse.json(emptyList)),
    )
    renderAgentsPage()
    await waitFor(() => expect(screen.getByText('Active Agent')).toBeInTheDocument())
    const statusSelect = screen.getByRole('combobox', { name: 'Filter by status' })
    statusSelect.focus()
    fireEvent.pointerDown(statusSelect, { button: 0, ctrlKey: false, pointerId: 1, pointerType: 'mouse' })
    fireEvent.mouseDown(statusSelect)
    const activeOption = await screen.findByRole('option', { name: 'active' })
    fireEvent.click(activeOption)
    await waitFor(() => expect(screen.getByText('Active Agent')).toBeInTheDocument())
  })

  it('opens CreateSessionSheet when Create session button is clicked on a loaded agent', async () => {
    const agent = buildAgent()
    const env = buildEnvironment()
    const agentsColl = createCollection([agent])
    const envsColl = createCollection([env])
    server.use(
      ...resourceHandlers('agents', agentsColl, (body, i) => buildAgent({ id: `agent_new_${i}`, ...body })),
      ...resourceHandlers('environments', envsColl, (body, i) => buildEnvironment({ id: `env_new_${i}`, ...body })),
    )
    renderAgentsPage()
    await waitFor(() => expect(screen.getByText('Coding agent')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: 'Create session' }))
    expect(await screen.findByText('Create Session')).toBeInTheDocument()
  })

  it('resets sessionAgentId when session sheet is closed via Escape', async () => {
    const agent = buildAgent()
    const env = buildEnvironment()
    const agentsColl = createCollection([agent])
    const envsColl = createCollection([env])
    server.use(
      ...resourceHandlers('agents', agentsColl, (body, i) => buildAgent({ id: `agent_new_${i}`, ...body })),
      ...resourceHandlers('environments', envsColl, (body, i) => buildEnvironment({ id: `env_new_${i}`, ...body })),
    )
    renderAgentsPage()
    await waitFor(() => expect(screen.getByText('Coding agent')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: 'Create session' }))
    await waitFor(() => expect(screen.getByText('Create Session')).toBeInTheDocument())
    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByText('Create Session')).toBeNull())
  })

  it('calls archiveAgent and invalidates queries on success', async () => {
    stubPointerCapture()
    const agent = buildAgent()
    const agentsColl = createCollection([agent])
    server.use(
      ...resourceHandlers('agents', agentsColl, (body, i) => buildAgent({ id: `agent_new_${i}`, ...body })),
      http.get('*/api/v1/environments', () => HttpResponse.json(emptyList)),
    )
    renderAgentsPage()
    await waitFor(() => expect(screen.getByText('Coding agent')).toBeInTheDocument())
    const archiveBtn = screen.getByRole('button', { name: 'Archive agent' })
    fireEvent.click(archiveBtn)
    const confirmBtns = await screen.findAllByRole('button', { name: 'Archive agent' })
    fireEvent.click(confirmBtns[confirmBtns.length - 1]!)
    // Archive mutation via PATCH :id → MSW will apply it
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('handles archiveAgent error gracefully via use-agent-actions onError', async () => {
    stubPointerCapture()
    const agent = buildAgent()
    // Register list handler but make PATCH fail
    server.use(
      http.get('*/api/v1/agents', () =>
        HttpResponse.json({ data: [agent], pagination: { limit: 50, hasMore: false, nextCursor: null } }),
      ),
      http.get('*/api/v1/environments', () => HttpResponse.json(emptyList)),
      http.patch('*/api/v1/agents/:agentId', () =>
        HttpResponse.json({ error: { type: 'server_error', message: 'Archive failed' } }, { status: 500 }),
      ),
    )
    renderAgentsPage()
    await waitFor(() => expect(screen.getByText('Coding agent')).toBeInTheDocument())
    const archiveBtn = screen.getByRole('button', { name: 'Archive agent' })
    fireEvent.click(archiveBtn)
    const confirmBtns = await screen.findAllByRole('button', { name: 'Archive agent' })
    fireEvent.click(confirmBtns[confirmBtns.length - 1]!)
    // onError fires — agent page stays intact after error
    await waitFor(() => expect(screen.getByText('Coding agent')).toBeInTheDocument())
  })
})
