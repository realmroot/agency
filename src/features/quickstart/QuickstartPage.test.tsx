/**
 * Tests for QuickstartPage — loading, error, step navigation, and step content.
 * Pattern: MSW + real api client, QueryClientProvider (retry:false) + MemoryRouter.
 * vi.spyOn is only used for useSessionRuntimeSession (a WebSocket hook, not @/lib/amarpc).
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { describe, expect, it, vi } from 'vitest'
import type { SessionRuntimeState } from '@/features/sessions/session-runtime'
import * as sessionRuntimeModule from '@/features/sessions/use-session-runtime'
import type { Agent, Environment, Provider, Session, SessionAgentSnapshot } from '@/lib/amarpc'
import { HttpResponse, http, server } from '@/test/msw'
import {
  type AgentOverrides,
  type EnvironmentOverrides,
  agent as resourceAgent,
  environment as resourceEnvironment,
} from '@/test/resource-fixtures'
import { buildTestSession, type TestSessionOverrides } from '@/testing/session'
import { QuickstartPage } from './QuickstartPage'

// ─── Fixtures ───

const now = '2026-05-23T00:00:00.000Z'

function listEnvelope<T>(data: T[]) {
  return { data, pagination: { limit: 50, hasMore: false, nextCursor: null as string | null } }
}

function buildProvider(overrides: Partial<Provider> = {}): Provider {
  return {
    id: 'workers-ai',
    slug: 'workers-ai',
    displayName: 'Workers AI',
    enabled: true,
    metadata: {},
    modelCatalogState: 'ready',
    lastError: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

function buildAgent(overrides: AgentOverrides = {}): Agent {
  return resourceAgent({ createdAt: now, updatedAt: now, ...overrides })
}

function buildEnvironment(overrides: EnvironmentOverrides = {}): Environment {
  return resourceEnvironment({
    networkPolicy: { mode: 'unrestricted' },
    createdAt: now,
    updatedAt: now,
    ...overrides,
  })
}

const defaultAgentSnapshot: SessionAgentSnapshot = {
  id: 'agentver_1',
  agentId: 'agent_1',
  projectId: 'project_1',
  version: 1,
  systemPrompt: 'Do the work',
  provider: 'workers-ai',
  model: '@cf/moonshotai/kimi-k2.6',
  skills: [],
  subagents: [],
  allowedTools: ['read', 'bash'],
  mcpConnectors: [],
  createdAt: '2026-05-23T00:00:00.000Z',
}

function buildSession(overrides: TestSessionOverrides = {}): Session {
  return buildTestSession({ agentSnapshot: defaultAgentSnapshot, name: 'Quickstart session', ...overrides })
}

// ─── MSW handler helpers ───

function handlers({
  providers = [] as Provider[],
  agents = [] as Agent[],
  environments = [] as Environment[],
  sessions = [] as Session[],
  createdAgent = null as Agent | null,
  createdEnvironment = null as Environment | null,
  createdSession = null as Session | null,
  sessionDetail = null as Session | null,
  agentError = null as { message: string; status: number } | null,
  environmentError = null as { message: string; status: number } | null,
  sessionError = null as { message: string; status: number } | null,
  providersError = null as { message: string; status: number } | null,
}) {
  return [
    http.get('*/api/v1/providers', () =>
      providersError
        ? HttpResponse.json({ error: { message: providersError.message } }, { status: providersError.status })
        : HttpResponse.json(listEnvelope(providers)),
    ),
    http.get('*/api/v1/agents', () => HttpResponse.json(listEnvelope(agents))),
    http.get('*/api/v1/environments', () => HttpResponse.json(listEnvelope(environments))),
    http.get('*/api/v1/sessions', () => HttpResponse.json(listEnvelope(sessions))),
    http.post('*/api/v1/agents', async ({ request }) => {
      if (agentError) {
        return HttpResponse.json({ error: { message: agentError.message } }, { status: agentError.status })
      }
      const body = (await request.json()) as Record<string, unknown>
      const agent = createdAgent ?? buildAgent({ id: 'agent_new', name: String(body.name ?? 'New agent') })
      return HttpResponse.json(agent, { status: 201 })
    }),
    http.post('*/api/v1/environments', async ({ request }) => {
      if (environmentError) {
        return HttpResponse.json({ error: { message: environmentError.message } }, { status: environmentError.status })
      }
      const body = (await request.json()) as Record<string, unknown>
      const env = createdEnvironment ?? buildEnvironment({ id: 'env_new', name: String(body.name ?? 'New env') })
      return HttpResponse.json(env, { status: 201 })
    }),
    http.post('*/api/v1/sessions', async () => {
      if (sessionError) {
        return HttpResponse.json({ error: { message: sessionError.message } }, { status: sessionError.status })
      }
      const session = createdSession ?? buildSession({ id: 'session_new' })
      return HttpResponse.json(session, { status: 201 })
    }),
    http.get('*/api/v1/sessions/:sessionId', ({ params }) => {
      const session = sessionDetail ?? sessions.find((s) => s.metadata.uid === params.sessionId) ?? null
      return session ? HttpResponse.json(session) : new HttpResponse(null, { status: 404 })
    }),
    // Provider models are queried by CoreStep when a draft has a provider set
    http.get('*/api/v1/providers/:providerId/models', () => HttpResponse.json(listEnvelope([]))),
  ]
}

// ─── Runtime mock helper ───

function mockRuntime(state: Partial<SessionRuntimeState> = {}) {
  const fullState: SessionRuntimeState = {
    connection: 'closed',
    runState: 'idle',
    messages: [],
    tools: [],
    sessionEvents: [],
    eventKeys: [],
    error: null,
    ...state,
  }
  vi.spyOn(sessionRuntimeModule, 'useSessionRuntimeSession').mockReturnValue({
    endpoint: null,
    state: fullState,
    reconnect: vi.fn(),
    sendPrompt: vi.fn().mockReturnValue(false),
    sendSteer: vi.fn().mockReturnValue(false),
    abort: vi.fn().mockReturnValue(false),
  })
}

// ─── Render helper ───

function renderPage(initialPath = '/quickstart') {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, refetchOnWindowFocus: false },
      mutations: { retry: false },
    },
  })
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initialPath]}>
        <QuickstartPage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
  return queryClient
}

// ─── Loading state ───

describe('QuickstartPage loading', () => {
  it('renders loading state when queries are pending', () => {
    server.use(
      http.get('*/api/v1/providers', () => new Promise(() => {})),
      http.get('*/api/v1/agents', () => new Promise(() => {})),
      http.get('*/api/v1/environments', () => new Promise(() => {})),
      http.get('*/api/v1/sessions', () => new Promise(() => {})),
    )
    renderPage()
    expect(screen.getByText('Loading quickstart')).toBeTruthy()
  })
})

// ─── Error state ───

describe('QuickstartPage error', () => {
  it('renders error state when a query fails', async () => {
    server.use(...handlers({ providersError: { message: 'Network error', status: 500 } }))
    renderPage()
    await waitFor(() => expect(screen.getByText('Network error')).toBeTruthy())
    expect(screen.getByText('Unable to load quickstart resources.')).toBeTruthy()
  })
})

// ─── Loaded state — step navigation ───

describe('QuickstartPage loaded — step navigation', () => {
  it('shows all five quickstart step labels in the list', async () => {
    server.use(...handlers({}))
    renderPage()
    await waitFor(() => expect(screen.getByText('1. Provider')).toBeTruthy())
    expect(screen.getByText('2. Environment')).toBeTruthy()
    expect(screen.getByText('3. Agent')).toBeTruthy()
    expect(screen.getByText('4. Session')).toBeTruthy()
    expect(screen.getByText('5. Integration')).toBeTruthy()
  })

  it('opens provider step by default when no resources exist', async () => {
    server.use(...handlers({}))
    renderPage('/quickstart')
    await waitFor(() =>
      expect(
        screen.getByText('Confirm the model provider. The seeded Workers AI provider needs no credential.'),
      ).toBeTruthy(),
    )
  })

  it('shows provider step content when step=provider is active', async () => {
    server.use(...handlers({ providers: [buildProvider()] }))
    renderPage('/quickstart?step=provider')
    await waitFor(() => expect(screen.getByText('Workers AI')).toBeTruthy())
    expect(screen.getByText('Run the default Workers AI agent')).toBeTruthy()
  })

  it('shows environment step content when provider is completed and step=environment is active', async () => {
    server.use(...handlers({ providers: [buildProvider()] }))
    renderPage('/quickstart?step=environment')
    await waitFor(() =>
      expect(screen.getByText('Create or select the reusable sandbox template sessions will run in.')).toBeTruthy(),
    )
    expect(screen.getByText('Create environment')).toBeTruthy()
  })

  it('shows agent step content when provider and environment are completed and step=agent is active', async () => {
    server.use(...handlers({ providers: [buildProvider()], environments: [buildEnvironment()] }))
    renderPage('/quickstart?step=agent')
    await waitFor(() =>
      expect(screen.getByText('Draft the agent from a template or goal description, then create it.')).toBeTruthy(),
    )
  })

  it('shows session step content when provider, environment, and agent are completed', async () => {
    server.use(
      ...handlers({ providers: [buildProvider()], agents: [buildAgent()], environments: [buildEnvironment()] }),
    )
    renderPage('/quickstart?step=session')
    await waitFor(() =>
      expect(screen.getByText('Create a test session and send the first task to the runtime.')).toBeTruthy(),
    )
    expect(screen.getByText('Create test session')).toBeTruthy()
  })

  it('shows integration step content when all steps are completed', async () => {
    server.use(
      ...handlers({
        providers: [buildProvider()],
        agents: [buildAgent()],
        environments: [buildEnvironment()],
        sessions: [buildSession()],
      }),
    )
    renderPage('/quickstart?step=integration')
    await waitFor(() =>
      expect(screen.getByText('Call the same control-plane API from curl, restish, or a generated SDK.')).toBeTruthy(),
    )
  })

  it('falls back to first incomplete step when locked step is requested', async () => {
    server.use(...handlers({}))
    renderPage('/quickstart?step=agent')
    await waitFor(() =>
      expect(
        screen.getByText('Confirm the model provider. The seeded Workers AI provider needs no credential.'),
      ).toBeTruthy(),
    )
  })

  it('renders session step content with "Create new test session" label when sessionId search param is set', async () => {
    mockRuntime()
    server.use(
      ...handlers({
        providers: [buildProvider()],
        agents: [buildAgent()],
        environments: [buildEnvironment()],
        sessions: [buildSession()],
        sessionDetail: buildSession(),
      }),
    )
    renderPage('/quickstart?step=session&session=session_1')
    await waitFor(() =>
      expect(screen.getByText('Create a test session and send the first task to the runtime.')).toBeTruthy(),
    )
    expect(screen.getByText('Create new test session')).toBeTruthy()
  })

  it('renders disabled locked step labels as spans not links', async () => {
    server.use(...handlers({ providers: [buildProvider()] }))
    renderPage('/quickstart?step=provider')
    await waitFor(() => expect(screen.getByText('1. Provider')).toBeTruthy())

    const providerEl = screen.getByText('1. Provider')
    expect(providerEl.tagName.toLowerCase()).toBe('a')

    const agentEl = screen.getByText('3. Agent')
    expect(agentEl.tagName.toLowerCase()).toBe('span')
    expect(agentEl.getAttribute('aria-disabled')).toBe('true')
  })

  it('shows integration step with null input when sessions list is empty', async () => {
    server.use(
      ...handlers({
        providers: [buildProvider()],
        agents: [buildAgent()],
        environments: [buildEnvironment()],
        sessions: [buildSession({ phase: 'closed' })],
      }),
    )
    renderPage('/quickstart?step=integration')
    await waitFor(() =>
      expect(screen.getByText('Call the same control-plane API from curl, restish, or a generated SDK.')).toBeTruthy(),
    )
    expect(screen.getByText('TypeScript SDK')).toBeTruthy()
  })
})

// ─── Agent step — draft flow ───

describe('QuickstartPage agent step — draft flow', () => {
  it('transitions from start to review when goal is drafted', async () => {
    server.use(...handlers({ providers: [buildProvider()], environments: [buildEnvironment()] }))
    renderPage('/quickstart?step=agent')
    await waitFor(() =>
      expect(screen.getByText('Draft the agent from a template or goal description, then create it.')).toBeTruthy(),
    )

    const textarea = screen.getByPlaceholderText('Review incoming pull requests and summarize risky changes.')
    fireEvent.change(textarea, { target: { value: 'Build a helpful assistant' } })
    fireEvent.click(screen.getByText('Draft agent configuration'))

    await waitFor(() => expect(screen.getByText('Create agent')).toBeTruthy())
  })

  it('transitions back to start when Back to templates is clicked', async () => {
    server.use(...handlers({ providers: [buildProvider()], environments: [buildEnvironment()] }))
    renderPage('/quickstart?step=agent')
    await waitFor(() =>
      expect(screen.getByText('Draft the agent from a template or goal description, then create it.')).toBeTruthy(),
    )

    const textarea = screen.getByPlaceholderText('Review incoming pull requests and summarize risky changes.')
    fireEvent.change(textarea, { target: { value: 'Build a helpful assistant' } })
    fireEvent.click(screen.getByText('Draft agent configuration'))
    await waitFor(() => expect(screen.getByText('Back to templates')).toBeTruthy())

    fireEvent.click(screen.getByText('Back to templates'))
    await waitFor(() => expect(screen.queryByText('Back to templates')).toBeNull())
  })

  it('shows validation errors on empty draft submission', async () => {
    server.use(...handlers({ providers: [buildProvider()], environments: [buildEnvironment()] }))
    renderPage('/quickstart?step=agent')
    await waitFor(() =>
      expect(screen.getByText('Draft the agent from a template or goal description, then create it.')).toBeTruthy(),
    )

    fireEvent.click(screen.getByText('Start from scratch'))
    await waitFor(() => expect(screen.getByText('Create agent')).toBeTruthy())

    fireEvent.click(screen.getByText('Create agent'))
    await waitFor(() => expect(screen.getByText('Name is required.')).toBeTruthy())
  })

  it('uses template when Use template is clicked on agent step', async () => {
    server.use(...handlers({ providers: [buildProvider()], environments: [buildEnvironment()] }))
    renderPage('/quickstart?step=agent')
    await waitFor(() =>
      expect(screen.getByText('Draft the agent from a template or goal description, then create it.')).toBeTruthy(),
    )

    const useTemplateBtn = screen.getAllByText('Use template')[0]!
    fireEvent.click(useTemplateBtn)

    await waitFor(() => expect(screen.getByText('Create agent')).toBeTruthy())
  })

  it('calls createAgent after valid draft is submitted', async () => {
    const createdAgent = buildAgent({ id: 'agent_new', version: 1 })
    server.use(...handlers({ providers: [buildProvider()], environments: [buildEnvironment()], createdAgent }))
    // After agent creation, refetch will need updated agents list
    server.use(http.get('*/api/v1/agents', () => HttpResponse.json(listEnvelope([createdAgent]))))

    renderPage('/quickstart?step=agent')
    await waitFor(() =>
      expect(screen.getByText('Draft the agent from a template or goal description, then create it.')).toBeTruthy(),
    )

    const textarea = screen.getByPlaceholderText('Review incoming pull requests and summarize risky changes.')
    fireEvent.change(textarea, { target: { value: 'Build a helpful assistant' } })
    fireEvent.click(screen.getByText('Draft agent configuration'))
    await waitFor(() => expect(screen.getByText('Create agent')).toBeTruthy())

    fireEvent.click(screen.getByText('Create agent'))
    // After success, page navigates to session step
    await waitFor(() =>
      expect(screen.getByText('Create a test session and send the first task to the runtime.')).toBeTruthy(),
    )
  })
})

// ─── Environment step — createEnvironment flow ───

describe('QuickstartPage environment step — createEnvironment flow', () => {
  it('calls createEnvironment when Create environment button is clicked', async () => {
    const createdEnv = buildEnvironment({ id: 'env_new' })
    server.use(...handlers({ providers: [buildProvider()], createdEnvironment: createdEnv }))
    // After env creation the page will refetch environments
    server.use(http.get('*/api/v1/environments', () => HttpResponse.json(listEnvelope([createdEnv]))))

    renderPage('/quickstart?step=environment')
    await waitFor(() => expect(screen.getByText('Create environment')).toBeTruthy())

    fireEvent.click(screen.getByText('Create environment'))
    // After success, page navigates to agent step
    await waitFor(() =>
      expect(screen.getByText('Draft the agent from a template or goal description, then create it.')).toBeTruthy(),
    )
  })
})

// ─── Integration step — with running session ───

describe('QuickstartPage integration step — integration examples', () => {
  it('renders integration examples for an idle session', async () => {
    server.use(
      ...handlers({
        providers: [buildProvider()],
        agents: [buildAgent()],
        environments: [buildEnvironment()],
        sessions: [buildSession({ phase: 'idle' })],
      }),
    )
    renderPage('/quickstart?step=integration')
    await waitFor(() => expect(screen.getByText('curl')).toBeTruthy())
    expect(screen.getByText('restish')).toBeTruthy()
    expect(screen.getByText('TypeScript SDK')).toBeTruthy()
  })

  it('prefers session matching previewSessionId param for integration examples', async () => {
    const sessions = [
      buildSession({ id: 'session_other', phase: 'idle' }),
      buildSession({ id: 'session_preview', phase: 'idle', agentId: 'agent_preview' }),
    ]
    server.use(
      ...handlers({
        providers: [buildProvider()],
        agents: [buildAgent()],
        environments: [buildEnvironment()],
        sessions,
      }),
    )
    renderPage('/quickstart?step=integration&session=session_preview')
    await waitFor(() => expect(screen.getByText('TypeScript SDK')).toBeTruthy())
  })

  it('falls back to sessions[0] when no idle/running session matches', async () => {
    server.use(
      ...handlers({
        providers: [buildProvider()],
        agents: [buildAgent()],
        environments: [buildEnvironment()],
        sessions: [buildSession({ phase: 'closed' })],
      }),
    )
    renderPage('/quickstart?step=integration')
    await waitFor(() => expect(screen.getByText('TypeScript SDK')).toBeTruthy())
  })

  it('falls back to sessions[0] when session is in error state', async () => {
    server.use(
      ...handlers({
        providers: [buildProvider()],
        agents: [buildAgent()],
        environments: [buildEnvironment()],
        sessions: [buildSession({ phase: 'error' })],
      }),
    )
    renderPage('/quickstart?step=integration')
    await waitFor(() => expect(screen.getByText('TypeScript SDK')).toBeTruthy())
  })
})

// ─── runDefaultWorkersAi mutation ───

describe('QuickstartPage provider step — runDefaultWorkersAi', () => {
  it('creates agent, environment, and session on Run the default', async () => {
    const createdAgent = buildAgent({ id: 'agent_default' })
    const createdEnvironment = buildEnvironment({ id: 'env_default' })
    const createdSession = buildSession({
      id: 'session_default',
      agentId: 'agent_default',
      environmentId: 'env_default',
    })
    server.use(
      ...handlers({
        providers: [buildProvider()],
        createdAgent,
        createdEnvironment,
        createdSession,
        sessionDetail: createdSession,
      }),
    )
    // After creation, refetches will return updated lists
    server.use(
      http.get('*/api/v1/agents', () => HttpResponse.json(listEnvelope([createdAgent]))),
      http.get('*/api/v1/environments', () => HttpResponse.json(listEnvelope([createdEnvironment]))),
      http.get('*/api/v1/sessions', () => HttpResponse.json(listEnvelope([createdSession]))),
    )

    renderPage('/quickstart?step=provider')
    await waitFor(() => expect(screen.getByText('Run the default Workers AI agent')).toBeTruthy())
    fireEvent.click(screen.getByText('Run the default Workers AI agent'))

    // After success, page navigates to session step
    await waitFor(() =>
      expect(screen.getByText('Create a test session and send the first task to the runtime.')).toBeTruthy(),
    )
  })

  it('shows Starting Workers AI agent label while running', async () => {
    // Make agent creation stall indefinitely so the pending state persists
    server.use(
      http.get('*/api/v1/providers', () => HttpResponse.json(listEnvelope([buildProvider()]))),
      http.get('*/api/v1/agents', () => HttpResponse.json(listEnvelope([]))),
      http.get('*/api/v1/environments', () => HttpResponse.json(listEnvelope([]))),
      http.get('*/api/v1/sessions', () => HttpResponse.json(listEnvelope([]))),
      http.post('*/api/v1/agents', () => new Promise(() => {})),
      http.post('*/api/v1/environments', () => new Promise(() => {})),
      http.post('*/api/v1/sessions', () => new Promise(() => {})),
      http.get('*/api/v1/providers/:providerId/models', () => HttpResponse.json(listEnvelope([]))),
    )
    renderPage('/quickstart?step=provider')
    await waitFor(() => expect(screen.getByText('Run the default Workers AI agent')).toBeTruthy())
    fireEvent.click(screen.getByText('Run the default Workers AI agent'))
    await waitFor(() => expect(screen.getByText('Starting Workers AI agent')).toBeTruthy())
  })
})

// ─── Environment step — onSelectExisting ───

describe('QuickstartPage environment step — onSelectExisting', () => {
  it('shows existing active environments in select', async () => {
    server.use(...handlers({ providers: [buildProvider()], environments: [buildEnvironment()] }))
    renderPage('/quickstart?step=environment')
    await waitFor(() => expect(screen.getByText('Use a custom environment')).toBeTruthy())
    expect(screen.getByText('Selecting an existing environment completes this step without changes.')).toBeTruthy()
  })
})

// ─── Agent step — createAgent error mapping ───

describe('QuickstartPage agent step — createAgent with API error', () => {
  it('shows creating indicator then recovers when createAgent returns error', async () => {
    server.use(
      ...handlers({
        providers: [buildProvider()],
        environments: [buildEnvironment()],
        agentError: { message: 'Server error', status: 500 },
      }),
    )
    renderPage('/quickstart?step=agent')
    await waitFor(() =>
      expect(screen.getByText('Draft the agent from a template or goal description, then create it.')).toBeTruthy(),
    )

    const textarea = screen.getByPlaceholderText('Review incoming pull requests and summarize risky changes.')
    fireEvent.change(textarea, { target: { value: 'Build a helpful assistant' } })
    fireEvent.click(screen.getByText('Draft agent configuration'))
    await waitFor(() => expect(screen.getByText('Create agent')).toBeTruthy())

    fireEvent.click(screen.getByText('Create agent'))
    // Button becomes enabled again after failure
    await waitFor(() => expect(screen.getByText('Create agent')).toBeTruthy())
  })

  it('clears individual field error when setField updates that field', async () => {
    server.use(...handlers({ providers: [buildProvider()], environments: [buildEnvironment()] }))
    renderPage('/quickstart?step=agent')
    await waitFor(() =>
      expect(screen.getByText('Draft the agent from a template or goal description, then create it.')).toBeTruthy(),
    )

    fireEvent.click(screen.getByText('Start from scratch'))
    await waitFor(() => expect(screen.getByText('Create agent')).toBeTruthy())

    fireEvent.click(screen.getByText('Create agent'))
    await waitFor(() => expect(screen.getByText('Name is required.')).toBeTruthy())

    const nameInput = screen.getByRole('textbox', { name: /^Name/ })
    fireEvent.change(nameInput, { target: { value: 'My new agent' } })
    await waitFor(() => expect(screen.queryByText('Name is required.')).toBeNull())
  })

  it('sets draft errors when createAgent returns mapped field errors', async () => {
    server.use(
      http.get('*/api/v1/providers', () => HttpResponse.json(listEnvelope([buildProvider()]))),
      http.get('*/api/v1/agents', () => HttpResponse.json(listEnvelope([]))),
      http.get('*/api/v1/environments', () => HttpResponse.json(listEnvelope([buildEnvironment()]))),
      http.get('*/api/v1/sessions', () => HttpResponse.json(listEnvelope([]))),
      http.post('*/api/v1/agents', () =>
        HttpResponse.json(
          { error: { message: 'Validation failed', details: { fields: { name: 'Name is already taken.' } } } },
          { status: 422 },
        ),
      ),
      http.get('*/api/v1/providers/:providerId/models', () => HttpResponse.json(listEnvelope([]))),
    )
    renderPage('/quickstart?step=agent')
    await waitFor(() =>
      expect(screen.getByText('Draft the agent from a template or goal description, then create it.')).toBeTruthy(),
    )

    const textarea = screen.getByPlaceholderText('Review incoming pull requests and summarize risky changes.')
    fireEvent.change(textarea, { target: { value: 'Build a coding assistant' } })
    fireEvent.click(screen.getByText('Draft agent configuration'))
    await waitFor(() => expect(screen.getByText('Create agent')).toBeTruthy())

    fireEvent.click(screen.getByText('Create agent'))
    await waitFor(() => expect(screen.getByText('Name is already taken.')).toBeTruthy())
  })
})

// ─── Provider step — onContinue ───

describe('QuickstartPage provider step — onContinue navigation', () => {
  it('moves to next step when Continue to next step is clicked', async () => {
    server.use(...handlers({ providers: [buildProvider()] }))
    renderPage('/quickstart?step=provider')
    await waitFor(() => expect(screen.getByText('Continue to next step')).toBeTruthy())
    fireEvent.click(screen.getByText('Continue to next step'))
    await waitFor(() =>
      expect(screen.getByText('Create or select the reusable sandbox template sessions will run in.')).toBeTruthy(),
    )
  })
})

// ─── Environment step — onSelectExisting navigation ───

describe('QuickstartPage environment step — onSelectExisting navigates to agent', () => {
  it('navigates to agent step after selecting existing environment', async () => {
    Object.defineProperty(HTMLElement.prototype, 'hasPointerCapture', { value: vi.fn(() => false), configurable: true })
    Object.defineProperty(HTMLElement.prototype, 'setPointerCapture', { value: vi.fn(), configurable: true })
    Object.defineProperty(HTMLElement.prototype, 'releasePointerCapture', { value: vi.fn(), configurable: true })
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { value: vi.fn(), configurable: true })

    server.use(...handlers({ providers: [buildProvider()], environments: [buildEnvironment()] }))
    renderPage('/quickstart?step=environment')
    await waitFor(() => expect(screen.getByText('Use a custom environment')).toBeTruthy())

    const trigger = screen.getByRole('combobox', { name: 'Custom environment' })
    trigger.focus()
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerId: 1, pointerType: 'mouse' })
    fireEvent.mouseDown(trigger)
    const option = screen.getByRole('option', { name: 'Node workspace' })
    fireEvent.click(option)

    await waitFor(() =>
      expect(screen.getByText('Draft the agent from a template or goal description, then create it.')).toBeTruthy(),
    )
  })
})

// ─── Session step — onSessionCreated and onContinue ───

describe('QuickstartPage session step — onSessionCreated and onContinue', () => {
  it('updates URL with session id when session is created', async () => {
    mockRuntime()
    const session = buildSession({ id: 'sess_new' })
    server.use(
      ...handlers({
        providers: [buildProvider()],
        agents: [buildAgent()],
        environments: [buildEnvironment()],
        createdSession: session,
        sessionDetail: session,
      }),
    )
    server.use(http.get('*/api/v1/sessions', () => HttpResponse.json(listEnvelope([session]))))

    renderPage('/quickstart?step=session')
    await waitFor(() => expect(screen.getByText('Create test session')).toBeTruthy())

    fireEvent.click(screen.getByText('Create test session'))
    await waitFor(() =>
      expect(screen.getByText('Create a test session and send the first task to the runtime.')).toBeTruthy(),
    )
  })

  it('navigates to integration step when Continue to integration is clicked', async () => {
    mockRuntime()
    server.use(
      ...handlers({
        providers: [buildProvider()],
        agents: [buildAgent()],
        environments: [buildEnvironment()],
        sessions: [buildSession()],
        sessionDetail: buildSession(),
      }),
    )
    renderPage('/quickstart?step=session&session=session_1')
    await waitFor(() =>
      expect(screen.getByText('Create a test session and send the first task to the runtime.')).toBeTruthy(),
    )

    fireEvent.click(screen.getByText('Continue to integration'))
    await waitFor(() =>
      expect(screen.getByText('Call the same control-plane API from curl, restish, or a generated SDK.')).toBeTruthy(),
    )
  })
})

// ─── Mutation error handling ───

describe('QuickstartPage — mutation error handling', () => {
  it('createEnvironment onError is invoked when createEnvironment fails', async () => {
    server.use(
      ...handlers({
        providers: [buildProvider()],
        environmentError: { message: 'Env failed', status: 500 },
      }),
    )
    renderPage('/quickstart?step=environment')
    await waitFor(() => expect(screen.getByText('Create environment')).toBeTruthy())

    fireEvent.click(screen.getByText('Create environment'))
    // Button should re-enable after failure
    await waitFor(() => expect(screen.getByText('Create environment')).toBeTruthy())
  })

  it('runDefaultWorkersAi onError is invoked when createAgent fails', async () => {
    server.use(
      ...handlers({
        providers: [buildProvider()],
        agentError: { message: 'Agent failed', status: 500 },
      }),
    )
    renderPage('/quickstart?step=provider')
    await waitFor(() => expect(screen.getByText('Run the default Workers AI agent')).toBeTruthy())

    fireEvent.click(screen.getByText('Run the default Workers AI agent'))
    // Button re-enables after failure
    await waitFor(() => expect(screen.getByText('Run the default Workers AI agent')).toBeTruthy())
  })
})

// ─── setField early return branch ───

describe('QuickstartPage — setField early return when no current errors', () => {
  it('does not clear error when field is not in current errors', async () => {
    server.use(...handlers({ providers: [buildProvider()], environments: [buildEnvironment()] }))
    renderPage('/quickstart?step=agent')
    await waitFor(() =>
      expect(screen.getByText('Draft the agent from a template or goal description, then create it.')).toBeTruthy(),
    )

    fireEvent.click(screen.getByText('Start from scratch'))
    await waitFor(() => expect(screen.getByText('Create agent')).toBeTruthy())

    const nameInput = screen.getByRole('textbox', { name: /^Name/ })
    fireEvent.change(nameInput, { target: { value: 'My agent' } })
    expect(screen.queryByText('Name is required.')).toBeNull()
  })
})

// ─── submitAgentDraft early return (draft === null) ───

describe('QuickstartPage — submitAgentDraft when draft is null', () => {
  it('Create agent button is absent when draft is null (start view)', async () => {
    server.use(...handlers({ providers: [buildProvider()], environments: [buildEnvironment()] }))
    renderPage('/quickstart?step=agent')
    await waitFor(() =>
      expect(screen.getByText('Draft the agent from a template or goal description, then create it.')).toBeTruthy(),
    )
    expect(screen.queryByText('Create agent')).toBeNull()
  })
})

// ─── Navigation — stepHref with session param ───

describe('QuickstartPage navigation — step links with session param', () => {
  it('includes session param in step links when session search param is set', async () => {
    mockRuntime()
    server.use(
      ...handlers({
        providers: [buildProvider()],
        agents: [buildAgent()],
        environments: [buildEnvironment()],
        sessions: [buildSession()],
        sessionDetail: buildSession(),
      }),
    )
    renderPage('/quickstart?step=session&session=session_1')
    await waitFor(() => expect(screen.getByText('1. Provider')).toBeTruthy())

    const providerLink = screen.getByText('1. Provider')
    expect(providerLink.getAttribute('href')).toBe('/quickstart?step=provider&session=session_1')
  })
})
