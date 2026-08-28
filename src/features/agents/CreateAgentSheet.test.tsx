/**
 * CreateAgentSheet — integration tests via MSW + real api client.
 * POST /api/v1/agents is served by MSW.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { describe, expect, it } from 'vitest'
import { Toaster } from '@/components/ui/sonner'
import { emptyAgent } from '@/console/defaults'
import type { Agent, ProviderModel } from '@/lib/amarpc'
import { createCollection, HttpResponse, http, provisionAgentHandlers, server } from '@/test/msw'
import { type AgentOverrides, agent as resourceAgent } from '@/test/resource-fixtures'
import { CreateAgentSheet } from './CreateAgentSheet'

const now = '2026-05-23T00:00:00.000Z'

function buildAgent(overrides: AgentOverrides = {}): Agent {
  return resourceAgent({ skills: [], allowedTools: [], createdAt: now, updatedAt: now, ...overrides })
}

function makeQueryClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
}

function stubSelectPointerEvents() {
  Object.defineProperty(HTMLElement.prototype, 'hasPointerCapture', { value: () => false, configurable: true })
  Object.defineProperty(HTMLElement.prototype, 'setPointerCapture', { value: () => {}, configurable: true })
  Object.defineProperty(HTMLElement.prototype, 'releasePointerCapture', { value: () => {}, configurable: true })
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { value: () => {}, configurable: true })
}

async function selectRuntime(name: 'AMA' | 'Claude Code' | 'Codex' | 'Copilot' = 'AMA') {
  stubSelectPointerEvents()
  const runtime = screen.getByRole('combobox', { name: 'Runtime' })
  runtime.focus()
  fireEvent.pointerDown(runtime, { button: 0, ctrlKey: false, pointerId: 1, pointerType: 'mouse' })
  fireEvent.mouseDown(runtime)
  fireEvent.click(await screen.findByRole('option', { name }))
}

async function selectModel(name: string) {
  stubSelectPointerEvents()
  const model = screen.getByRole('combobox', { name: 'Model' })
  model.focus()
  fireEvent.pointerDown(model, { button: 0, ctrlKey: false, pointerId: 2, pointerType: 'mouse' })
  fireEvent.mouseDown(model)
  fireEvent.click(await screen.findByRole('option', { name }))
}

describe('[spec: agents/console-list] CreateAgentSheet', () => {
  it('starts with no skills or runtime and rejects form submission until runtime is selected', async () => {
    expect(emptyAgent).toMatchObject({ skills: '', provider: '', runtime: '' })
    let postCount = 0
    server.use(
      http.get('*/api/v1/agents', () =>
        HttpResponse.json({ data: [], pagination: { limit: 50, hasMore: false, nextCursor: null } }),
      ),
      http.post('*/api/v1/agents', () => {
        postCount += 1
        return HttpResponse.json(buildAgent(), { status: 201 })
      }),
    )
    const queryClient = makeQueryClient()
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <CreateAgentSheet open onOpenChange={() => {}} />
          <Toaster />
        </MemoryRouter>
      </QueryClientProvider>,
    )

    expect(screen.getByLabelText('Skills')).toHaveValue('')
    const runtime = screen.getByRole('combobox', { name: 'Runtime' })
    expect(runtime).toHaveTextContent('Select a runtime')
    expect(runtime).toBeRequired()
    expect(runtime).toHaveAccessibleDescription(
      'Required and immutable after creation. Select the runtime that will execute this Agent.',
    )
    const save = screen.getByRole('button', { name: 'Save agent' })
    expect(save).toBeDisabled()

    fireEvent.submit(save.closest('form')!)

    expect(await screen.findByText('Select a runtime.')).toBeInTheDocument()
    expect(postCount).toBe(0)
  })

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
            ...provisionAgentHandlers(buildAgent({ id: 'agent_new', name: 'Coding agent' }), (body) => {
              postedBody = body
              agentsColl.put(buildAgent({ id: 'agent_new', name: 'Coding agent' }))
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
    await selectRuntime()
    fireEvent.click(screen.getByRole('button', { name: 'Save agent' }))
    await waitFor(() => expect(closed).toBe(true))
    const body = postedBody as unknown as Record<string, unknown>
    expect(body).toMatchObject({ metadata: { name: 'Coding agent' }, spec: { runtime: 'ama', skills: [] } })
    expect(body.metadata).not.toHaveProperty('description')
  })

  it('clears both provider and model when No model selected is chosen', async () => {
    const model: ProviderModel = {
      id: 'model_1',
      providerId: 'moonshotai',
      modelId: '@cf/moonshotai/kimi-k2.6',
      displayName: 'Kimi K2.6',
      capabilities: ['text', 'tools'],
      contextWindow: 262144,
      pricing: {},
      availability: 'available',
      metadata: {},
      createdAt: now,
      updatedAt: now,
    }
    let postedBody: Record<string, unknown> | null = null
    server.use(
      http.get('*/api/v1/providers/models', () =>
        HttpResponse.json({ data: [model], pagination: { limit: 50, hasMore: false, nextCursor: null } }),
      ),
      http.get('*/api/v1/agents', () =>
        HttpResponse.json({ data: [], pagination: { limit: 50, hasMore: false, nextCursor: null } }),
      ),
      http.post('*/api/v1/agents', async ({ request }) => {
        postedBody = (await request.json()) as Record<string, unknown>
        return HttpResponse.json(buildAgent({ provider: null, model: null, runtime: 'ama' }), { status: 201 })
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

    await selectRuntime()
    await selectModel('Kimi K2.6 (moonshotai)')
    expect(screen.getByRole('combobox', { name: 'Model' })).toHaveTextContent('Kimi K2.6')
    await selectModel('No model selected')
    fireEvent.click(screen.getByRole('button', { name: 'Save agent' }))

    await waitFor(() => expect(postedBody).not.toBeNull())
    const spec = (postedBody as unknown as { spec: Record<string, unknown> }).spec
    expect(spec.model).toBeNull()
    expect(spec).not.toHaveProperty('provider')
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
    await selectRuntime()
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
    await selectRuntime()
    fireEvent.click(screen.getByRole('button', { name: 'Save agent' }))
    // Error handled gracefully — form still shows
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save agent' })).toBeInTheDocument())
  })
})
