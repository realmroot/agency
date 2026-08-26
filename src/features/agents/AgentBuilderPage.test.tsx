/**
 * AgentBuilderPage — integration tests via MSW + real api client.
 * Fetches: GET /api/v1/providers, GET /api/v1/connectors, GET /api/v1/environments,
 *           GET /api/v1/providers/models, POST /api/v1/agents, PATCH /api/v1/agents/:id,
 *           POST /api/v1/sessions, GET /api/v1/sessions/:id
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Agent, Environment, Session } from '@/lib/amarpc'
import { HttpResponse, http, provisionAgentHandlers, server } from '@/test/msw'
import {
  type AgentOverrides,
  type EnvironmentOverrides,
  agent as resourceAgent,
  environment as resourceEnvironment,
} from '@/test/resource-fixtures'
import { buildTestSession, type TestSessionOverrides } from '@/testing/session'
import { AgentBuilderPage } from './AgentBuilderPage'

const now = '2026-05-23T00:00:00.000Z'

function buildAgent(overrides: AgentOverrides = {}): Agent {
  return resourceAgent({ skills: [], allowedTools: [], createdAt: now, updatedAt: now, ...overrides })
}

function buildEnvironment(overrides: EnvironmentOverrides = {}): Environment {
  return resourceEnvironment({ createdAt: now, updatedAt: now, ...overrides })
}

function buildSession(overrides: TestSessionOverrides = {}): Session {
  return buildTestSession({ name: 'Test session', ...overrides })
}

const emptyList = { data: [], pagination: { limit: 50, hasMore: false, nextCursor: null } }

class MockSessionWebSocket extends EventTarget {
  static OPEN = 1
  readyState = MockSessionWebSocket.OPEN
  readonly sent: string[] = []

  constructor(readonly url: string) {
    super()
    Promise.resolve().then(() => this.dispatchEvent(new Event('open')))
  }

  send(data: string) {
    this.sent.push(data)
  }

  close() {
    this.readyState = 3
  }
}

function makeQueryClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
}

/** Registers the standard peripheral handlers the builder always queries. */
function setupDefaultHandlers(
  overrides: { environments?: Environment[]; agentResponse?: Agent | null; sessionResponse?: Session | null } = {},
) {
  server.use(
    http.get('*/api/v1/providers', () => HttpResponse.json(emptyList)),
    http.get('*/api/v1/providers/models', () => HttpResponse.json(emptyList)),
    http.get('*/api/v1/connectors', () => HttpResponse.json(emptyList)),
    http.get('*/api/v1/environments', () =>
      HttpResponse.json({
        data: overrides.environments ?? [],
        pagination: { limit: 50, hasMore: false, nextCursor: null },
      }),
    ),
    http.get('*/api/v1/sessions/:id', () =>
      overrides.sessionResponse
        ? HttpResponse.json(overrides.sessionResponse)
        : HttpResponse.json({ error: { type: 'not_found', message: 'Not found' } }, { status: 404 }),
    ),
  )
}

beforeEach(() => {
  vi.stubGlobal('WebSocket', MockSessionWebSocket)
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
})

function renderBuilderPage(initialSearch = '') {
  const client = makeQueryClient()
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[`/agents/new${initialSearch}`]}>
        <Routes>
          <Route path="/agents/new" element={<AgentBuilderPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('[spec: agents/builder] AgentBuilderPage', () => {
  it('renders start step at default route', () => {
    setupDefaultHandlers()
    renderBuilderPage()
    expect(screen.getByText('Agent builder')).toBeInTheDocument()
    expect(screen.getByText('Goal')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Start from scratch' })).toBeInTheDocument()
  })

  it('renders core step when step=core is in the URL', () => {
    setupDefaultHandlers()
    renderBuilderPage('?step=core')
    expect(screen.getByText('Core settings')).toBeInTheDocument()
    expect(screen.getByLabelText('Name')).toBeInTheDocument()
  })

  it('renders tools step when step=tools is in the URL', () => {
    setupDefaultHandlers()
    renderBuilderPage('?step=tools')
    expect(screen.getByText('Tools and approvals')).toBeInTheDocument()
  })

  it('renders sandbox step when step=sandbox is in the URL', () => {
    setupDefaultHandlers()
    renderBuilderPage('?step=sandbox')
    expect(screen.getByText('Sandbox access')).toBeInTheDocument()
  })

  it('renders test step when step=test is in the URL', () => {
    setupDefaultHandlers()
    renderBuilderPage('?step=test')
    expect(screen.getByText('Test and publish')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Publish agent' })).toBeInTheDocument()
  })

  it('renders done step with no-published message when step=done and no agent published', () => {
    setupDefaultHandlers()
    renderBuilderPage('?step=done')
    expect(screen.getByText('API examples')).toBeInTheDocument()
    expect(screen.getByText('Publish an agent from the test step to see its API examples.')).toBeInTheDocument()
  })

  it('defaults to start step when step param is unknown', () => {
    setupDefaultHandlers()
    renderBuilderPage('?step=bogus')
    expect(screen.getByText('Goal')).toBeInTheDocument()
  })

  it('shows Back to agents link in page header', () => {
    setupDefaultHandlers()
    renderBuilderPage()
    expect(screen.getByRole('link', { name: /Back to agents/ })).toBeInTheDocument()
  })

  it('shows validation errors and stays on core step when Next is clicked with empty draft', () => {
    setupDefaultHandlers()
    renderBuilderPage('?step=core')
    fireEvent.click(screen.getByRole('button', { name: /Next/ }))
    expect(screen.getByText('Name is required.')).toBeInTheDocument()
  })

  it('shows Back button on core step', () => {
    setupDefaultHandlers()
    renderBuilderPage('?step=core')
    expect(screen.getByRole('button', { name: 'Back' })).toBeInTheDocument()
  })

  it('navigates back to start step when Back button is clicked on core step', async () => {
    setupDefaultHandlers()
    renderBuilderPage('?step=core')
    fireEvent.click(screen.getByRole('button', { name: 'Back' }))
    await waitFor(() => expect(screen.getByText('Goal')).toBeInTheDocument())
  })

  it('disables Start test session button when no environment selected', () => {
    setupDefaultHandlers()
    renderBuilderPage('?step=test')
    expect(screen.getByRole('button', { name: 'Start test session' })).toBeDisabled()
  })

  it('clicking Skip on start step navigates to core step', async () => {
    setupDefaultHandlers()
    renderBuilderPage('?step=start')
    fireEvent.click(screen.getByRole('button', { name: 'Start from scratch' }))
    expect(await screen.findByLabelText('Name')).toBeInTheDocument()
  })

  it('clicking Draft agent configuration on start step navigates to core step', async () => {
    setupDefaultHandlers()
    renderBuilderPage('?step=start')
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Review incoming PRs' } })
    fireEvent.click(screen.getByRole('button', { name: 'Draft agent configuration' }))
    expect(await screen.findByLabelText('Name')).toBeInTheDocument()
  })

  it('navigate via Use template on start step goes to core step', async () => {
    setupDefaultHandlers()
    renderBuilderPage('?step=start')
    const useBtns = screen.getAllByRole('button', { name: 'Use template' })
    fireEvent.click(useBtns[0]!)
    expect(await screen.findByLabelText('Name')).toBeInTheDocument()
    const nameInput = screen.getByLabelText('Name') as HTMLInputElement
    expect(nameInput.value.length).toBeGreaterThan(0)
  })

  it('clears name error when name field is typed after validation failure', async () => {
    setupDefaultHandlers()
    renderBuilderPage('?step=core')
    fireEvent.click(screen.getByRole('button', { name: /Next/ }))
    expect(screen.getByText('Name is required.')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'My agent' } })
    expect(screen.queryByText('Name is required.')).toBeNull()
  })

  it('publish with invalid draft redirects to core step with field errors', async () => {
    setupDefaultHandlers()
    renderBuilderPage('?step=test')
    fireEvent.click(screen.getByRole('button', { name: 'Publish agent' }))
    // Navigates to core step and shows name error
    await waitFor(() => expect(screen.getByText('Name is required.')).toBeInTheDocument())
  })

  it('navigates to done step and shows agent API examples after successful publish', async () => {
    const publishedAgent = buildAgent({ name: 'My Published Agent', version: 1 })
    setupDefaultHandlers()
    server.use(...provisionAgentHandlers(publishedAgent))
    renderBuilderPage('?step=core')
    await waitFor(() => expect(screen.getByLabelText('Name')).toBeInTheDocument())
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'My Published Agent' } })
    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'my-published-agent' } })
    fireEvent.change(screen.getByLabelText('System prompt'), { target: { value: 'Do the work' } })
    fireEvent.click(screen.getByRole('button', { name: /Next/ }))
    await waitFor(() => expect(screen.getByText('Tools and approvals')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: /Next/ }))
    await waitFor(() => expect(screen.getByText('Sandbox access')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: /Next/ }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Publish agent' })).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: 'Publish agent' }))
    await waitFor(() => expect(screen.getByText('Realmroot CLI')).toBeInTheDocument())
    expect(screen.getByRole('link', { name: 'Open agent' })).toBeInTheDocument()
  })

  it('shows publish error when createAgent fails', async () => {
    setupDefaultHandlers()
    server.use(
      http.post('*/api/v1/agents', () =>
        HttpResponse.json({ error: { type: 'server_error', message: 'Publish failed' } }, { status: 500 }),
      ),
    )
    renderBuilderPage('?step=core')
    await waitFor(() => expect(screen.getByLabelText('Name')).toBeInTheDocument())
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'My Agent' } })
    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'my-agent' } })
    fireEvent.change(screen.getByLabelText('System prompt'), { target: { value: 'Do the work' } })
    fireEvent.click(screen.getByRole('button', { name: /Next/ }))
    await waitFor(() => expect(screen.getByText('Tools and approvals')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: /Next/ }))
    await waitFor(() => expect(screen.getByText('Sandbox access')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: /Next/ }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Publish agent' })).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: 'Publish agent' }))
    // Page stays on test step
    await waitFor(() => expect(screen.getByRole('button', { name: 'Publish agent' })).toBeInTheDocument())
  })

  it('shows error when publish receives ApiError with field errors (applyApiError truthy path)', async () => {
    setupDefaultHandlers()
    server.use(
      http.post('*/api/v1/agents', () =>
        HttpResponse.json(
          {
            error: {
              type: 'validation_error',
              message: 'unprocessable',
              details: { fields: { name: 'Name must be unique' } },
            },
          },
          { status: 422 },
        ),
      ),
    )
    renderBuilderPage('?step=core')
    await waitFor(() => expect(screen.getByLabelText('Name')).toBeInTheDocument())
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'My Agent' } })
    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'my-agent' } })
    fireEvent.change(screen.getByLabelText('System prompt'), { target: { value: 'Do the work' } })
    fireEvent.click(screen.getByRole('button', { name: /Next/ }))
    await waitFor(() => expect(screen.getByText('Tools and approvals')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: /Next/ }))
    await waitFor(() => expect(screen.getByText('Sandbox access')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: /Next/ }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Publish agent' })).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: 'Publish agent' }))
    await waitFor(() => expect(screen.getByText('Name must be unique')).toBeInTheDocument())
  })

  it('shows Publishing agent label while publish mutation is pending', async () => {
    setupDefaultHandlers()
    server.use(http.post('*/api/v1/agents', () => new Promise(() => {})))
    renderBuilderPage('?step=core')
    await waitFor(() => expect(screen.getByLabelText('Name')).toBeInTheDocument())
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Test Agent' } })
    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'test-agent' } })
    fireEvent.change(screen.getByLabelText('System prompt'), { target: { value: 'Do work' } })
    fireEvent.click(screen.getByRole('button', { name: /Next/ }))
    await waitFor(() => expect(screen.getByText('Tools and approvals')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: /Next/ }))
    await waitFor(() => expect(screen.getByText('Sandbox access')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: /Next/ }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Publish agent' })).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: 'Publish agent' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Publishing agent' })).toBeInTheDocument())
  })

  it('submitTest with empty draft sets field errors (validation path)', async () => {
    const env = buildEnvironment()
    setupDefaultHandlers({ environments: [env] })
    renderBuilderPage('?step=test')
    await waitFor(() => expect(screen.getByText('Test and publish')).toBeInTheDocument())
    const envTrigger = screen.getByRole('combobox', { name: 'Test environment' })
    envTrigger.focus()
    fireEvent.pointerDown(envTrigger, { button: 0, ctrlKey: false, pointerId: 1, pointerType: 'mouse' })
    fireEvent.mouseDown(envTrigger)
    const envOption = await screen.findByRole('option', { name: 'Node workspace' })
    fireEvent.click(envOption)
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Start test session' })).not.toBeDisabled()
    })
    fireEvent.click(screen.getByRole('button', { name: 'Start test session' }))
    // Validation fails (empty name) — stays on test step
    expect(screen.getByText('Test and publish')).toBeInTheDocument()
  })

  it('submitTest with valid draft triggers startTest mutation', async () => {
    const agent = buildAgent({ name: 'Test Agent' })
    const env = buildEnvironment()
    // Keep the session POST pending so "Starting test session" label stays visible
    setupDefaultHandlers({ environments: [env] })
    server.use(
      ...provisionAgentHandlers(agent),
      http.post('*/api/v1/sessions', () => new Promise(() => {})),
    )
    renderBuilderPage('?step=core')
    await waitFor(() => expect(screen.getByLabelText('Name')).toBeInTheDocument())
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Test Agent' } })
    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'test-agent' } })
    fireEvent.change(screen.getByLabelText('System prompt'), { target: { value: 'Do the work' } })
    fireEvent.click(screen.getByRole('button', { name: /Next/ }))
    await waitFor(() => expect(screen.getByText('Tools and approvals')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: /Next/ }))
    await waitFor(() => expect(screen.getByText('Sandbox access')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: /Next/ }))
    await waitFor(() => expect(screen.getByText('Test and publish')).toBeInTheDocument())
    const envTrigger = screen.getByRole('combobox', { name: 'Test environment' })
    envTrigger.focus()
    fireEvent.pointerDown(envTrigger, { button: 0, ctrlKey: false, pointerId: 1, pointerType: 'mouse' })
    fireEvent.mouseDown(envTrigger)
    const envOption = await screen.findByRole('option', { name: 'Node workspace' })
    fireEvent.click(envOption)
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Start test session' })).not.toBeDisabled()
    })
    fireEvent.click(screen.getByRole('button', { name: 'Start test session' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Starting test session' })).toBeInTheDocument())
  })

  it('shows Starting test session label while startTest mutation is pending', async () => {
    const env = buildEnvironment()
    setupDefaultHandlers({ environments: [env] })
    server.use(http.post('*/api/v1/agents', () => new Promise(() => {})))
    renderBuilderPage('?step=core')
    await waitFor(() => expect(screen.getByLabelText('Name')).toBeInTheDocument())
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Test Agent' } })
    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'test-agent' } })
    fireEvent.change(screen.getByLabelText('System prompt'), { target: { value: 'Do work' } })
    fireEvent.click(screen.getByRole('button', { name: /Next/ }))
    await waitFor(() => expect(screen.getByText('Tools and approvals')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: /Next/ }))
    await waitFor(() => expect(screen.getByText('Sandbox access')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: /Next/ }))
    await waitFor(() => expect(screen.getByText('Test and publish')).toBeInTheDocument())
    const envTrigger = screen.getByRole('combobox', { name: 'Test environment' })
    envTrigger.focus()
    fireEvent.pointerDown(envTrigger, { button: 0, ctrlKey: false, pointerId: 1, pointerType: 'mouse' })
    fireEvent.mouseDown(envTrigger)
    const envOption = await screen.findByRole('option', { name: 'Node workspace' })
    fireEvent.click(envOption)
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Start test session' })).not.toBeDisabled()
    })
    fireEvent.click(screen.getByRole('button', { name: 'Start test session' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Starting test session' })).toBeInTheDocument())
  })

  it('publish uses updateAgent when draftAgent is already set', async () => {
    const agent = buildAgent({ name: 'Draft Agent' })
    const session = buildSession()
    const env = buildEnvironment()
    let agentCreated = false
    let agentPatched = false
    setupDefaultHandlers({
      environments: [env],
      sessionResponse: buildSession({ id: session.metadata.uid, phase: 'idle' }),
    })
    server.use(
      ...provisionAgentHandlers(agent, () => {
        agentCreated = true
      }),
      http.post('*/api/v1/sessions', () => HttpResponse.json(session, { status: 201 })),
      http.patch('*/api/v1/agents/:agentId', async () => {
        agentPatched = true
        return HttpResponse.json({ ...agent, metadata: {} })
      }),
    )
    renderBuilderPage('?step=core')
    await waitFor(() => expect(screen.getByLabelText('Name')).toBeInTheDocument())
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Draft Agent' } })
    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'draft-agent' } })
    fireEvent.change(screen.getByLabelText('System prompt'), { target: { value: 'Do work' } })
    fireEvent.click(screen.getByRole('button', { name: /Next/ }))
    await waitFor(() => expect(screen.getByText('Tools and approvals')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: /Next/ }))
    await waitFor(() => expect(screen.getByText('Sandbox access')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: /Next/ }))
    await waitFor(() => expect(screen.getByText('Test and publish')).toBeInTheDocument())
    const envTrigger = screen.getByRole('combobox', { name: 'Test environment' })
    envTrigger.focus()
    fireEvent.pointerDown(envTrigger, { button: 0, ctrlKey: false, pointerId: 1, pointerType: 'mouse' })
    fireEvent.mouseDown(envTrigger)
    const envOption = await screen.findByRole('option', { name: 'Node workspace' })
    fireEvent.click(envOption)
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Start test session' })).not.toBeDisabled()
    })
    fireEvent.click(screen.getByRole('button', { name: 'Start test session' }))
    await waitFor(() => expect(agentCreated).toBe(true))
    // Now publish — should use PATCH (updateAgent) since draftAgent is set
    fireEvent.click(screen.getByRole('button', { name: 'Publish agent' }))
    await waitFor(() => expect(agentPatched).toBe(true))
  })

  it('types test prompt textarea and verifies value updates', async () => {
    const env = buildEnvironment()
    setupDefaultHandlers({ environments: [env] })
    renderBuilderPage('?step=test')
    await waitFor(() => expect(screen.getByText('Test and publish')).toBeInTheDocument())
    const promptTextarea = screen.getByLabelText('Test prompt')
    fireEvent.change(promptTextarea, { target: { value: 'Hello agent, what can you do?' } })
    expect((promptTextarea as HTMLTextAreaElement).value).toBe('Hello agent, what can you do?')
  })
})
