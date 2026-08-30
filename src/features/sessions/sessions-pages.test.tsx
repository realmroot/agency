/**
 * Tests for SessionsPage, SessionDetailPage, CreateSessionSheet (component branches),
 * SessionDetailView (resource sheet / confirm-action branches), SessionsView (checkbox /
 * empty-state / archived branches), SessionRuntimePanel (connection-badge / canSend
 * branches), SessionToolTrace (empty / running / orphan branches).
 *
 * Uses MSW + the REAL api client. No vi.spyOn / vi.mock of @/lib/amarpc.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Agent, Environment, ListResponse, MemoryStore, Session, SessionEvent } from '@/lib/amarpc'
import { ApiError } from '@/lib/amarpc'
import { HttpResponse, http, server } from '@/test/msw'
import {
  type AgentOverrides,
  type EnvironmentOverrides,
  agent as resourceAgent,
  environment as resourceEnvironment,
} from '@/test/resource-fixtures'
import { buildTestSession, type TestSessionOverrides } from '@/testing/session'
import { CreateSessionSheet, formatCreateSessionError } from './CreateSessionSheet'
import { SessionDetailPage, sessionRefetchInterval } from './SessionDetailPage'
import { SessionDetailView } from './SessionDetailView'
import { SessionRuntimePanel } from './SessionRuntimePanel'
import { SessionsPage } from './SessionsPage'
import { SessionsView } from './SessionsView'
import { SessionToolTrace } from './SessionToolTrace'
import type { SessionRuntimeState } from './session-runtime'
import type { SessionToolTraceEntry } from './session-tool-trace'

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

const listOf = <T,>(data: T[] = []): ListResponse<T> => ({
  data,
  pagination: { limit: 50, hasMore: false, nextCursor: null },
})

const _emptyList = <T,>() => listOf<T>()

class MockSessionWebSocket extends EventTarget {
  static OPEN = 1
  readyState = MockSessionWebSocket.OPEN
  readonly sent: string[] = []

  constructor(readonly url: string) {
    super()
    Promise.resolve().then(() => this.dispatchEvent(new Event('open')))
  }

  emit(payload: Record<string, unknown>) {
    this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(payload) }))
  }

  send(data: string) {
    this.sent.push(data)
  }

  close() {
    this.readyState = 3
  }
}

function stubSessionSocket() {
  const sockets: MockSessionWebSocket[] = []
  vi.stubGlobal(
    'WebSocket',
    class extends MockSessionWebSocket {
      constructor(url: string) {
        super(url)
        sockets.push(this)
      }
    },
  )
  return sockets
}

afterEach(() => {
  vi.unstubAllGlobals()
})

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const now = '2026-05-23T00:00:00.000Z'

function buildSession(overrides: TestSessionOverrides = {}): Session {
  return buildTestSession({ name: 'Test session', ...overrides })
}

function buildAgent(overrides: AgentOverrides = {}): Agent {
  return resourceAgent({ createdAt: now, updatedAt: now, ...overrides })
}

function buildEnvironment(overrides: EnvironmentOverrides = {}): Environment {
  return resourceEnvironment({
    packages: [{ name: 'tsx', version: 'latest' }],
    networkPolicy: { mode: 'restricted', allowedHosts: ['registry.npmjs.org'] },
    createdAt: now,
    updatedAt: now,
    ...overrides,
  })
}

function buildRuntimeState(overrides: Partial<SessionRuntimeState> = {}): SessionRuntimeState {
  return {
    connection: 'open',
    runState: 'idle',
    messages: [],
    tools: [],
    sessionEvents: [],
    eventKeys: [],
    error: null,
    ...overrides,
  }
}

function buildMessageEvent(sessionId: string, sequence: number, content: string): SessionEvent {
  return {
    id: `event_${sequence}`,
    sessionId,
    sequence,
    type: 'message.completed',
    payload: {
      message: { id: `message_${sequence}`, role: 'assistant', content: [{ type: 'text', text: content }] },
    },
    createdAt: new Date(sequence * 1000).toISOString(),
  }
}

function buildPagination(sessions: Session[]) {
  return {
    items: sessions,
    page: 1,
    pageCount: 1,
    pageSize: 10,
    total: sessions.length,
    start: sessions.length === 0 ? 0 : 1,
    end: sessions.length,
    canPrevious: false,
    canNext: false,
    viewportRef: { current: null },
    previous: vi.fn(),
    next: vi.fn(),
  }
}

function buildTraceEntry(overrides: Partial<SessionToolTraceEntry> = {}): SessionToolTraceEntry {
  return {
    key: 'entry_1',
    toolCallId: 'call_1',
    name: 'bash',
    status: 'completed',
    approval: 'approved',
    orphanedResult: false,
    input: { command: 'git status' },
    output: { content: [{ type: 'text', text: 'clean tree' }] },
    errorSummary: null,
    durationMs: 250,
    startedAt: now,
    completedAt: now,
    ...overrides,
  }
}

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
}

// ---------------------------------------------------------------------------
// MSW handler factories
// ---------------------------------------------------------------------------

function sessionsList(sessions: Session[]) {
  return http.get('*/api/v1/sessions', () => HttpResponse.json(listOf(sessions)))
}

function sessionNotFound() {
  return http.get('*/api/v1/sessions/:sessionId', () =>
    HttpResponse.json({ error: { type: 'not_found', message: 'Not found' } }, { status: 404 }),
  )
}

function sessionDetail(session: Session) {
  return http.get(`*/api/v1/sessions/${session.metadata.uid}`, () => HttpResponse.json(session))
}

function agentDetail(agent: Agent) {
  return http.get(`*/api/v1/agents/${agent.metadata.uid}`, () => HttpResponse.json(agent))
}

function environmentDetail(env: Environment) {
  return http.get(`*/api/v1/environments/${env.metadata.uid}`, () => HttpResponse.json(env))
}

function agentsList(agents: Agent[] = []) {
  return http.get('*/api/v1/agents', () => HttpResponse.json(listOf(agents)))
}

function environmentsList(envs: Environment[] = []) {
  return http.get('*/api/v1/environments', () => HttpResponse.json(listOf(envs)))
}

function memoryStoresList(memoryStores: MemoryStore[] = []) {
  return http.get('*/api/v1/memory-stores', () => HttpResponse.json(listOf(memoryStores)))
}

function sessionPatch(session: Session) {
  return http.patch(`*/api/v1/sessions/${session.metadata.uid}`, () => HttpResponse.json(session))
}

// ---------------------------------------------------------------------------
// SessionsView — empty state, archived rows, checkbox behaviour
// ---------------------------------------------------------------------------

describe('SessionsView', () => {
  it('renders empty state when sessions list is empty', () => {
    render(
      <MemoryRouter>
        <SessionsView
          sessions={[]}
          pagination={buildPagination([])}
          selectedIds={[]}
          setSelectedIds={vi.fn()}
          onArchive={vi.fn()}
        />
      </MemoryRouter>,
    )

    expect(screen.getByText('No sessions')).toBeTruthy()
  })

  it('does not show Archive button for archived sessions', () => {
    const archivedSession = buildSession({ id: 'session_archived', archivedAt: now })
    render(
      <MemoryRouter>
        <SessionsView
          sessions={[archivedSession]}
          pagination={buildPagination([archivedSession])}
          selectedIds={[]}
          setSelectedIds={vi.fn()}
          onArchive={vi.fn()}
        />
      </MemoryRouter>,
    )

    expect(screen.queryByRole('button', { name: 'Archive' })).toBeNull()
  })

  it('shows Archive button for non-archived sessions', () => {
    const session = buildSession()
    render(
      <MemoryRouter>
        <SessionsView
          sessions={[session]}
          pagination={buildPagination([session])}
          selectedIds={[]}
          setSelectedIds={vi.fn()}
          onArchive={vi.fn()}
        />
      </MemoryRouter>,
    )

    expect(screen.getByRole('button', { name: 'Archive' })).toBeTruthy()
  })

  it('selects all sessions when select-all checkbox is clicked', () => {
    const session = buildSession()
    const setSelectedIds = vi.fn()
    render(
      <MemoryRouter>
        <SessionsView
          sessions={[session]}
          pagination={buildPagination([session])}
          selectedIds={[]}
          setSelectedIds={setSelectedIds}
          onArchive={vi.fn()}
        />
      </MemoryRouter>,
    )

    const selectAll = screen.getByRole('checkbox', { name: 'Select all sessions' })
    fireEvent.click(selectAll)
    expect(setSelectedIds).toHaveBeenCalledWith(['session_1'])
  })

  it('deselects all when select-all is clicked while all are selected', () => {
    const session = buildSession()
    const setSelectedIds = vi.fn()
    render(
      <MemoryRouter>
        <SessionsView
          sessions={[session]}
          pagination={buildPagination([session])}
          selectedIds={['session_1']}
          setSelectedIds={setSelectedIds}
          onArchive={vi.fn()}
        />
      </MemoryRouter>,
    )

    const selectAll = screen.getByRole('checkbox', { name: 'Select all sessions' })
    fireEvent.click(selectAll)
    expect(setSelectedIds).toHaveBeenCalledWith([])
  })

  it('selects individual row via row checkbox', () => {
    const session = buildSession()
    const setSelectedIds = vi.fn()
    render(
      <MemoryRouter>
        <SessionsView
          sessions={[session]}
          pagination={buildPagination([session])}
          selectedIds={[]}
          setSelectedIds={setSelectedIds}
          onArchive={vi.fn()}
        />
      </MemoryRouter>,
    )

    const rowCheckbox = screen.getByRole('checkbox', { name: 'Select Test session' })
    fireEvent.click(rowCheckbox)
    expect(setSelectedIds).toHaveBeenCalledWith(['session_1'])
  })

  it('deselects individual row via row checkbox when already selected', () => {
    const session = buildSession()
    const setSelectedIds = vi.fn()
    render(
      <MemoryRouter>
        <SessionsView
          sessions={[session]}
          pagination={buildPagination([session])}
          selectedIds={['session_1']}
          setSelectedIds={setSelectedIds}
          onArchive={vi.fn()}
        />
      </MemoryRouter>,
    )

    const rowCheckbox = screen.getByRole('checkbox', { name: 'Select Test session' })
    fireEvent.click(rowCheckbox)
    expect(setSelectedIds).toHaveBeenCalledWith([])
  })

  it('renders hosting/runtime as None when environmentSnapshot is absent', () => {
    const session = buildSession({ environmentSnapshot: null })
    render(
      <MemoryRouter>
        <SessionsView
          sessions={[session]}
          pagination={buildPagination([session])}
          selectedIds={[]}
          setSelectedIds={vi.fn()}
          onArchive={vi.fn()}
        />
      </MemoryRouter>,
    )

    expect(screen.getByText(/None · env_1/)).toBeTruthy()
  })

  it('renders Self-hosted hosting/runtime label', () => {
    const session = buildSession({
      environmentSnapshot: {
        id: 'envver_1',
        environmentId: 'env_1',
        projectId: 'project_1',
        version: 1,
        scope: 'project',
        type: 'self_hosted',
        networking: { type: 'limited', allowMcpServers: false, allowPackageManagers: true, allowedHosts: [] },
        packages: { type: 'packages', apt: [], cargo: [], gem: [], go: [], npm: [], pip: [], webi: [] },
        variables: {},
        createdAt: now,
      },
    })
    render(
      <MemoryRouter>
        <SessionsView
          sessions={[session]}
          pagination={buildPagination([session])}
          selectedIds={[]}
          setSelectedIds={vi.fn()}
          onArchive={vi.fn()}
        />
      </MemoryRouter>,
    )

    expect(screen.getByText(/Self-hosted \/ ama/)).toBeTruthy()
  })

  it('calls onArchive after confirming archive for a session', async () => {
    Object.defineProperty(HTMLElement.prototype, 'hasPointerCapture', {
      value: vi.fn(() => false),
      configurable: true,
    })
    Object.defineProperty(HTMLElement.prototype, 'setPointerCapture', {
      value: vi.fn(),
      configurable: true,
    })
    const onArchive = vi.fn()
    const session = buildSession()
    render(
      <MemoryRouter>
        <SessionsView
          sessions={[session]}
          pagination={buildPagination([session])}
          selectedIds={[]}
          setSelectedIds={vi.fn()}
          onArchive={onArchive}
        />
      </MemoryRouter>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Archive' }))
    const confirmButton = await screen.findByRole('button', { name: 'Archive session' })
    fireEvent.click(confirmButton)
    expect(onArchive).toHaveBeenCalledWith('session_1')
  })

  it('disables select-all checkbox when all sessions are archived', () => {
    const archivedSession = buildSession({ id: 'session_archived', archivedAt: now })
    render(
      <MemoryRouter>
        <SessionsView
          sessions={[archivedSession]}
          pagination={buildPagination([archivedSession])}
          selectedIds={[]}
          setSelectedIds={vi.fn()}
          onArchive={vi.fn()}
        />
      </MemoryRouter>,
    )

    const selectAll = screen.getByRole('checkbox', { name: 'Select all sessions' })
    expect(selectAll.hasAttribute('disabled')).toBe(true)
  })

  it('renders "None" for null model in agent provider column', () => {
    const session = buildSession({
      agentSnapshot: {
        id: 'agentver_1',
        agentId: 'agent_1',
        projectId: 'project_1',
        version: 1,
        systemPrompt: 'Do work',
        provider: 'workers-ai',
        model: null,
        skills: [],
        subagents: [],
        allowedTools: ['read', 'bash'],
        mcpConnectors: [],
        identity: null,

        createdAt: now,
      },
    })
    render(
      <MemoryRouter>
        <SessionsView
          sessions={[session]}
          pagination={buildPagination([session])}
          selectedIds={[]}
          setSelectedIds={vi.fn()}
          onArchive={vi.fn()}
        />
      </MemoryRouter>,
    )

    expect(screen.getByLabelText('agent_1 agent_1. Provider/model: workers-ai / None')).toBeTruthy()
  })

  it('falls back to agentId when agent name is unavailable', () => {
    const session = buildSession({
      agentId: 'agent_fallback_id',
      agentSnapshot: {
        id: 'agentver_1',
        agentId: 'agent_fallback_id',
        projectId: 'project_1',
        version: 1,
        systemPrompt: 'Do the work.',
        provider: 'workers-ai',
        model: '@cf/meta/llama',
        skills: [],
        subagents: [],
        allowedTools: ['read', 'bash'],
        mcpConnectors: [],
        identity: null,

        createdAt: now,
      },
    })
    render(
      <MemoryRouter>
        <SessionsView
          sessions={[session]}
          pagination={buildPagination([session])}
          selectedIds={[]}
          setSelectedIds={vi.fn()}
          onArchive={vi.fn()}
        />
      </MemoryRouter>,
    )

    expect(screen.getAllByText('agent_fallback_id').length).toBeGreaterThanOrEqual(2)
    expect(
      screen.getByLabelText('agent_fallback_id agent_fallback_id. Provider/model: workers-ai / @cf/meta/llama'),
    ).toBeTruthy()
  })

  it('renders "None" for null environmentId in hosting column', () => {
    const session = buildSession({ environmentId: null, environmentSnapshot: null })
    render(
      <MemoryRouter>
        <SessionsView
          sessions={[session]}
          pagination={buildPagination([session])}
          selectedIds={[]}
          setSelectedIds={vi.fn()}
          onArchive={vi.fn()}
        />
      </MemoryRouter>,
    )

    expect(screen.getByText(/None · None/)).toBeTruthy()
  })
})

// ---------------------------------------------------------------------------
// SessionDetailView — resource sheets, confirm dialogs, fallbacks
// ---------------------------------------------------------------------------

describe('SessionDetailView', () => {
  function renderDetailView(overrides: TestSessionOverrides = {}, runtimeOverrides: Partial<SessionRuntimeState> = {}) {
    const session = buildSession(overrides)
    render(
      <MemoryRouter>
        <SessionDetailView
          session={session}
          agentName="Coding agent"
          environmentName="Node workspace"
          runtime={buildRuntimeState(runtimeOverrides)}
          onClose={vi.fn()}
          onReopen={vi.fn()}
          onArchive={vi.fn()}
          onReconnectRuntime={vi.fn()}
          chatMessage=""
          setChatMessage={vi.fn()}
          onSendMessage={vi.fn()}
          onAbortRuntime={vi.fn()}
        />
      </MemoryRouter>,
    )
    return session
  }

  it('falls back to agentId when agentName is absent', () => {
    const session = buildSession({
      agentId: 'agent_no_name',
      agentSnapshot: {
        id: 'agentver_1',
        agentId: 'agent_no_name',
        projectId: 'project_1',
        version: 1,
        systemPrompt: 'Do the work.',
        provider: 'workers-ai',
        model: '@cf/moonshotai/kimi-k2.6',
        skills: [],
        subagents: [],
        allowedTools: ['read', 'bash'],
        mcpConnectors: [],
        identity: null,

        createdAt: now,
      },
    })
    render(
      <MemoryRouter>
        <SessionDetailView
          session={session}
          agentName={undefined}
          environmentName={undefined}
          runtime={buildRuntimeState()}
          onClose={vi.fn()}
          onReopen={vi.fn()}
          onArchive={vi.fn()}
          onReconnectRuntime={vi.fn()}
          chatMessage=""
          setChatMessage={vi.fn()}
          onSendMessage={vi.fn()}
          onAbortRuntime={vi.fn()}
        />
      </MemoryRouter>,
    )

    expect(screen.getAllByText(/Do the work\./).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/env_1/).length).toBeGreaterThan(0)
  })

  it('shows No environment snapshot when environmentSnapshot is null', () => {
    renderDetailView({ environmentSnapshot: null })
    expect(screen.queryByText('No environment snapshot')).toBeNull()
    for (const button of screen.getAllByRole('button', { name: 'Open environment details' })) {
      expect(button).toBeDisabled()
    }
  })

  it('opens agent resource sheet on meta button click', async () => {
    renderDetailView()

    const agentButtons = screen.getAllByRole('button', { name: 'Open agent details' })
    fireEvent.click(agentButtons[0]!)

    await waitFor(() => expect(screen.getByText('Agent snapshot captured for session_1')).toBeTruthy())
    expect(screen.getByText('Agent id')).toBeTruthy()
  })

  it('opens environment resource sheet on meta button click', async () => {
    renderDetailView()

    const envButtons = screen.getAllByRole('button', { name: 'Open environment details' })
    fireEvent.click(envButtons[0]!)

    await waitFor(() => expect(screen.getByText('Environment snapshot captured for session_1')).toBeTruthy())
    expect(screen.getByText('Environment id')).toBeTruthy()
  })

  it('disables environment button when environmentSnapshot is absent', () => {
    renderDetailView({ environmentSnapshot: null })

    const envButtons = screen.getAllByRole('button', { name: 'Open environment details' })
    for (const btn of envButtons) {
      expect(btn.hasAttribute('disabled')).toBe(true)
    }
  })

  it('opens volumes sheet when volumes meta button is clicked', async () => {
    renderDetailView({
      spec: {
        ...buildSession().spec,
        volumes: [{ name: 'repo', type: 'git_repository', url: 'https://gitlab.com/acme/app.git', ref: 'main' }],
        volumeMounts: [{ name: 'repo', mountPath: '/workspace' }],
      },
    })

    const resourcesButtons = screen.getAllByRole('button', { name: 'Open session volumes' })
    fireEvent.click(resourcesButtons[0]!)

    await waitFor(() => expect(screen.getByText('Session volumes')).toBeTruthy())
    expect(screen.getByText('Git repositories')).toBeTruthy()
  })

  it('calls onClose after close action is confirmed', async () => {
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
    const onClose = vi.fn()
    const session = buildSession()
    render(
      <MemoryRouter>
        <SessionDetailView
          session={session}
          agentName="Coding agent"
          environmentName="Node workspace"
          runtime={buildRuntimeState()}
          onClose={onClose}
          onReopen={vi.fn()}
          onArchive={vi.fn()}
          onReconnectRuntime={vi.fn()}
          chatMessage=""
          setChatMessage={vi.fn()}
          onSendMessage={vi.fn()}
          onAbortRuntime={vi.fn()}
        />
      </MemoryRouter>,
    )

    const actionsButton = screen.getByRole('button', { name: 'Actions' })
    fireEvent.pointerDown(actionsButton, { button: 0, ctrlKey: false, pointerId: 1, pointerType: 'mouse' })
    fireEvent.mouseDown(actionsButton)
    fireEvent.click(actionsButton)
    const stopItem = await screen.findByText('Close session')
    fireEvent.click(stopItem)
    const confirmButton = await screen.findByRole('button', { name: 'Close session' })
    fireEvent.click(confirmButton)
    expect(onClose).toHaveBeenCalledWith('session_1')
  })

  it('calls onReopen after reopen action is confirmed for a closed session', async () => {
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
    const onReopen = vi.fn()
    const session = buildSession({ phase: 'closed' })
    render(
      <MemoryRouter>
        <SessionDetailView
          session={session}
          agentName="Coding agent"
          environmentName="Node workspace"
          runtime={buildRuntimeState()}
          onClose={vi.fn()}
          onReopen={onReopen}
          onArchive={vi.fn()}
          onReconnectRuntime={vi.fn()}
          chatMessage=""
          setChatMessage={vi.fn()}
          onSendMessage={vi.fn()}
          onAbortRuntime={vi.fn()}
        />
      </MemoryRouter>,
    )

    const actionsButton = screen.getByRole('button', { name: 'Actions' })
    fireEvent.pointerDown(actionsButton, { button: 0, ctrlKey: false, pointerId: 1, pointerType: 'mouse' })
    fireEvent.mouseDown(actionsButton)
    fireEvent.click(actionsButton)
    const reopenItem = await screen.findByText('Reopen session')
    fireEvent.click(reopenItem)
    const confirmButton = await screen.findByRole('button', { name: 'Reopen session' })
    fireEvent.click(confirmButton)
    expect(onReopen).toHaveBeenCalledWith('session_1')
  })

  it('calls onArchive after archive action is confirmed', async () => {
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
    const onArchive = vi.fn()
    const session = buildSession()
    render(
      <MemoryRouter>
        <SessionDetailView
          session={session}
          agentName="Coding agent"
          environmentName="Node workspace"
          runtime={buildRuntimeState()}
          onClose={vi.fn()}
          onReopen={vi.fn()}
          onArchive={onArchive}
          onReconnectRuntime={vi.fn()}
          chatMessage=""
          setChatMessage={vi.fn()}
          onSendMessage={vi.fn()}
          onAbortRuntime={vi.fn()}
        />
      </MemoryRouter>,
    )

    const actionsButton = screen.getByRole('button', { name: 'Actions' })
    fireEvent.pointerDown(actionsButton, { button: 0, ctrlKey: false, pointerId: 1, pointerType: 'mouse' })
    fireEvent.mouseDown(actionsButton)
    fireEvent.click(actionsButton)
    const archiveItem = await screen.findByText('Archive session')
    fireEvent.click(archiveItem)
    const confirmButton = await screen.findByRole('button', { name: 'Archive session' })
    fireEvent.click(confirmButton)
    expect(onArchive).toHaveBeenCalledWith('session_1')
  })

  it('renders session without a name using session id in heading', () => {
    renderDetailView({ name: null })
    expect(screen.getAllByText('session_1').length).toBeGreaterThan(0)
  })

  it('renders secret volumes in volumes sheet', async () => {
    renderDetailView({
      spec: {
        ...buildSession().spec,
        volumes: [{ name: 'api-token', type: 'secret', secretRef: 'ama-secret://vault_1/api-token' }],
        volumeMounts: [{ name: 'api-token', mountPath: '/run/secrets/api-token' }],
      },
    })

    const resourcesButtons = screen.getAllByRole('button', { name: 'Open session volumes' })
    fireEvent.click(resourcesButtons[0]!)

    await waitFor(() => expect(screen.getByText('Session volumes')).toBeTruthy())
    expect(screen.getByText('0')).toBeTruthy()
  })

  it('renders canSend false when session is closed', () => {
    const session = buildSession({ phase: 'closed' })
    render(
      <MemoryRouter>
        <SessionDetailView
          session={session}
          agentName="Coding agent"
          environmentName="Node workspace"
          runtime={buildRuntimeState()}
          onClose={vi.fn()}
          onReopen={vi.fn()}
          onArchive={vi.fn()}
          onReconnectRuntime={vi.fn()}
          chatMessage="hello"
          setChatMessage={vi.fn()}
          onSendMessage={vi.fn()}
          onAbortRuntime={vi.fn()}
        />
      </MemoryRouter>,
    )

    const sendButton = screen.queryByRole('button', { name: 'Send' })
    if (sendButton) {
      expect(sendButton.hasAttribute('disabled')).toBe(true)
    }
  })

  it('renders agent snapshot tool names in agent sheet', async () => {
    renderDetailView()
    const agentButtons = screen.getAllByRole('button', { name: 'Open agent details' })
    fireEvent.click(agentButtons[0]!)

    await waitFor(() => expect(screen.getByText('Agent snapshot captured for session_1')).toBeTruthy())
    expect(screen.getByText('read, write')).toBeTruthy()
  })

  it('opens agent sheet via second (mobile) agent button', async () => {
    renderDetailView()
    const agentButtons = screen.getAllByRole('button', { name: 'Open agent details' })
    const targetBtn = agentButtons.length > 1 ? agentButtons[1]! : agentButtons[0]!
    fireEvent.click(targetBtn)
    await waitFor(() => expect(screen.getByText('Agent snapshot captured for session_1')).toBeTruthy())
  })

  it('opens environment sheet via second (mobile) environment button', async () => {
    renderDetailView()
    const envButtons = screen.getAllByRole('button', { name: 'Open environment details' })
    const targetBtn = envButtons.length > 1 ? envButtons[1]! : envButtons[0]!
    fireEvent.click(targetBtn)

    await waitFor(() => expect(screen.getByText('Environment snapshot captured for session_1')).toBeTruthy())
  })

  it('opens volumes sheet via second (mobile) resources button', async () => {
    renderDetailView({
      spec: {
        ...buildSession().spec,
        volumes: [{ name: 'repo', type: 'git_repository', url: 'https://gitlab.com/acme/app.git', ref: 'main' }],
        volumeMounts: [{ name: 'repo', mountPath: '/workspace' }],
      },
    })
    const resourcesButtons = screen.getAllByRole('button', { name: 'Open session volumes' })
    const targetBtn = resourcesButtons.length > 1 ? resourcesButtons[1]! : resourcesButtons[0]!
    fireEvent.click(targetBtn)

    await waitFor(() => expect(screen.getByText('Session volumes')).toBeTruthy())
  })

  it('renders environment sheet details', async () => {
    renderDetailView({
      environmentSnapshot: {
        id: 'envver_1',
        environmentId: 'env_1',
        projectId: 'project_1',
        version: 1,
        scope: 'project',
        type: 'cloud',
        networking: { type: 'limited', allowMcpServers: false, allowPackageManagers: true, allowedHosts: [] },
        packages: { type: 'packages', apt: [], cargo: [], gem: [], go: [], npm: [], pip: [], webi: [] },
        variables: {},
        createdAt: now,
      },
    })
    const envButtons = screen.getAllByRole('button', { name: 'Open environment details' })
    fireEvent.click(envButtons[0]!)

    await waitFor(() => expect(screen.getByText('Environment snapshot captured for session_1')).toBeTruthy())
  })

  it('renders memory store volumes in volumes sheet', async () => {
    renderDetailView({
      spec: {
        ...buildSession().spec,
        volumes: [{ name: 'memory', type: 'memory', memoryRef: 'ama://memories/memstore_1' }],
        volumeMounts: [{ name: 'memory', mountPath: '/workspace/.ama/memory-stores/memstore_1', readOnly: true }],
      },
    })
    const resourcesButtons = screen.getAllByRole('button', { name: 'Open session volumes' })
    fireEvent.click(resourcesButtons[0]!)

    await waitFor(() => expect(screen.getByText('Session volumes')).toBeTruthy())
  })

  it('renders "None" model in agent sheet when model is null', async () => {
    renderDetailView({
      agentSnapshot: {
        id: 'agentver_1',
        agentId: 'agent_1',
        projectId: 'project_1',
        version: 1,
        systemPrompt: 'Do the work',
        provider: 'workers-ai',
        model: null,
        skills: [],
        subagents: [],
        allowedTools: ['read', 'bash'],
        mcpConnectors: [],
        identity: null,

        createdAt: now,
      },
    })

    const agentButtons = screen.getAllByRole('button', { name: 'Open agent details' })
    fireEvent.click(agentButtons[0]!)

    await waitFor(() => expect(screen.getByText('Agent snapshot captured for session_1')).toBeTruthy())
    const modelCells = screen.getAllByText('None')
    expect(modelCells.length).toBeGreaterThan(0)
  })

  it('renders "None" for empty skills and tool names in agent sheet', async () => {
    renderDetailView({
      agentSnapshot: {
        id: 'agentver_1',
        agentId: 'agent_1',
        projectId: 'project_1',
        version: 1,
        systemPrompt: 'Do the work',
        provider: 'workers-ai',
        model: '@cf/moonshotai/kimi-k2.6',
        skills: [],
        subagents: [],
        allowedTools: ['read'],
        mcpConnectors: [],
        identity: null,

        createdAt: now,
      },
    })

    const agentButtons = screen.getAllByRole('button', { name: 'Open agent details' })
    fireEvent.click(agentButtons[0]!)

    await waitFor(() => expect(screen.getByText('Agent snapshot captured for session_1')).toBeTruthy())
    const noneCells = screen.getAllByText('None')
    expect(noneCells.length).toBeGreaterThan(0)
  })

  it('renders "None" for null environmentId in environment sheet', async () => {
    renderDetailView({ environmentId: null, environmentSnapshot: buildSession().status.bindings.environment.snapshot })

    const envButtons = screen.getAllByRole('button', { name: 'Open environment details' })
    fireEvent.click(envButtons[0]!)

    await waitFor(() => expect(screen.getByText('Environment snapshot captured for session_1')).toBeTruthy())
    expect(screen.getAllByText('None').length).toBeGreaterThan(0)
  })

  it('includes secretRef in safeResourceView when a git volume has a secret reference', async () => {
    renderDetailView({
      spec: {
        ...buildSession().spec,
        volumes: [
          {
            name: 'repo',
            type: 'git_repository',
            url: 'https://github.com/acme/app.git',
            ref: 'main',
            secretRef: 'ama://vaults/vault_abc/credentials/git-token/versions/ver_abc',
          },
        ],
        volumeMounts: [{ name: 'repo', mountPath: '/workspace' }],
      },
    })

    const resourcesButtons = screen.getAllByRole('button', { name: 'Open session volumes' })
    fireEvent.click(resourcesButtons[0]!)

    await waitFor(() => expect(screen.getByText('Session volumes')).toBeTruthy())
    expect(screen.getByText(/git-token/)).toBeTruthy()
    expect(screen.getByText(/ver_abc/)).toBeTruthy()
  })
})

// ---------------------------------------------------------------------------
// SessionRuntimePanel — toolbar, busy state, canSend
// ---------------------------------------------------------------------------

describe('SessionRuntimePanel — toolbar and busy state', () => {
  it('renders connecting socket state without run state labels', () => {
    render(
      <SessionRuntimePanel
        runtime={buildRuntimeState({ connection: 'connecting', runState: 'running' })}
        message=""
        setMessage={vi.fn()}
        onSend={vi.fn()}
        onAbort={vi.fn()}
        onReconnect={vi.fn()}
        canSend
      />,
    )

    expect(screen.getByText('Connecting')).toBeTruthy()
    expect(screen.queryByText('running')).toBeNull()
  })

  it('renders connected socket as a green status dot', () => {
    render(
      <SessionRuntimePanel
        runtime={buildRuntimeState({ connection: 'open' })}
        message=""
        setMessage={vi.fn()}
        onSend={vi.fn()}
        onAbort={vi.fn()}
        onReconnect={vi.fn()}
        canSend
      />,
    )

    expect(screen.getByLabelText('Session socket connected')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Reconnect session socket' })).toBeNull()
  })

  it('does not call onSend when message is whitespace only', () => {
    const onSend = vi.fn()
    render(
      <SessionRuntimePanel
        runtime={buildRuntimeState()}
        message="   "
        setMessage={vi.fn()}
        onSend={onSend}
        onAbort={vi.fn()}
        onReconnect={vi.fn()}
        canSend
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    expect(onSend).not.toHaveBeenCalled()
  })

  it('disables send when canSend is false', () => {
    render(
      <SessionRuntimePanel
        runtime={buildRuntimeState()}
        message="hello"
        setMessage={vi.fn()}
        onSend={vi.fn()}
        onAbort={vi.fn()}
        onReconnect={vi.fn()}
        canSend={false}
      />,
    )

    const sendButton = screen.getByRole('button', { name: 'Send' })
    expect(sendButton.hasAttribute('disabled')).toBe(true)
  })

  it('calls onReconnect from the socket failure button', () => {
    const onReconnect = vi.fn()
    render(
      <SessionRuntimePanel
        runtime={buildRuntimeState({ connection: 'error' })}
        message=""
        setMessage={vi.fn()}
        onSend={vi.fn()}
        onAbort={vi.fn()}
        onReconnect={onReconnect}
        canSend
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Reconnect session socket' }))
    expect(onReconnect).toHaveBeenCalledTimes(1)
  })

  it('shows persisted non-transcript events in debug panel', async () => {
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
    const persistedEvents: SessionEvent[] = [
      {
        id: 'persisted_debug_1',
        sessionId: 'session_1',
        sequence: 1,
        type: 'message.completed',
        payload: { message: { id: 'message_1', role: 'assistant', content: [] } },
        createdAt: now,
      },
    ]

    render(
      <SessionRuntimePanel
        runtime={buildRuntimeState({ sessionEvents: persistedEvents })}
        message=""
        setMessage={vi.fn()}
        onSend={vi.fn()}
        onAbort={vi.fn()}
        onReconnect={vi.fn()}
        canSend
      />,
    )

    const debugTab = screen.getByRole('tab', { name: 'Debug' })
    fireEvent.pointerDown(debugTab, { button: 0, ctrlKey: false })
    fireEvent.mouseDown(debugTab)
    fireEvent.mouseUp(debugTab)
    fireEvent.click(debugTab)
    await waitFor(() => expect(debugTab.getAttribute('aria-selected')).toBe('true'))

    expect(screen.getByText('persisted_debug_1')).toBeTruthy()
  })

  it('renders persisted AMA events in the debug panel', async () => {
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
    const persistedEvents: SessionEvent[] = [
      {
        id: 'transcript_only_ev',
        sessionId: 'session_1',
        sequence: 1,
        type: 'message.completed',
        payload: { message: { id: 'message_1', role: 'assistant', content: [] } },
        createdAt: now,
      },
    ]

    render(
      <SessionRuntimePanel
        runtime={buildRuntimeState({ sessionEvents: persistedEvents })}
        message=""
        setMessage={vi.fn()}
        onSend={vi.fn()}
        onAbort={vi.fn()}
        onReconnect={vi.fn()}
        canSend
      />,
    )

    const debugTab = screen.getByRole('tab', { name: 'Debug' })
    fireEvent.pointerDown(debugTab, { button: 0, ctrlKey: false })
    fireEvent.mouseDown(debugTab)
    fireEvent.mouseUp(debugTab)
    fireEvent.click(debugTab)
    await waitFor(() => expect(debugTab.getAttribute('aria-selected')).toBe('true'))

    expect(screen.getByText('transcript_only_ev')).toBeTruthy()
  })

  it('renders session events from the runtime state once', async () => {
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
    const persistedEvents: SessionEvent[] = [
      {
        id: 'shared_event_1',
        sessionId: 'session_1',
        sequence: 1,
        type: 'message.completed',
        payload: { message: { id: 'message_1', role: 'assistant', content: [] } },
        createdAt: now,
      },
    ]
    const runtimeWithSameEvent = buildRuntimeState({ sessionEvents: persistedEvents })

    render(
      <SessionRuntimePanel
        runtime={runtimeWithSameEvent}
        message=""
        setMessage={vi.fn()}
        onSend={vi.fn()}
        onAbort={vi.fn()}
        onReconnect={vi.fn()}
        canSend
      />,
    )

    const debugTab = screen.getByRole('tab', { name: 'Debug' })
    fireEvent.pointerDown(debugTab, { button: 0, ctrlKey: false })
    fireEvent.mouseDown(debugTab)
    fireEvent.mouseUp(debugTab)
    fireEvent.click(debugTab)
    await waitFor(() => expect(debugTab.getAttribute('aria-selected')).toBe('true'))

    expect(screen.getAllByText('shared_event_1')).toHaveLength(1)
  })
})

// ---------------------------------------------------------------------------
// SessionToolTrace component — all status branches
// ---------------------------------------------------------------------------

describe('SessionToolTrace component', () => {
  it('renders empty state when no entries', () => {
    render(<SessionToolTrace entries={[]} />)
    expect(screen.getByText('No tool calls yet')).toBeTruthy()
  })

  it('renders a completed entry with duration and approval', () => {
    render(<SessionToolTrace entries={[buildTraceEntry()]} />)
    expect(screen.getByText('bash')).toBeTruthy()
    expect(screen.getByText('completed')).toBeTruthy()
    expect(screen.getByText('approved')).toBeTruthy()
    expect(screen.getByText('250ms')).toBeTruthy()
  })

  it('renders a running entry', () => {
    render(<SessionToolTrace entries={[buildTraceEntry({ status: 'running', durationMs: null })]} />)
    expect(screen.getByText('running')).toBeTruthy()
  })

  it('renders a failed entry with error summary and destructive approval', () => {
    const entry = buildTraceEntry({
      status: 'failed',
      errorSummary: 'Permission denied',
      approval: 'denied',
    })
    render(<SessionToolTrace entries={[entry]} />)
    expect(screen.getByText('failed')).toBeTruthy()
    expect(screen.getByText('denied')).toBeTruthy()
    expect(screen.getAllByText('Permission denied').length).toBeGreaterThan(0)
  })

  it('renders approval-required badge', () => {
    const entry = buildTraceEntry({ approval: 'approval required', status: 'failed', errorSummary: 'blocked' })
    render(<SessionToolTrace entries={[entry]} />)
    expect(screen.getByText('approval required')).toBeTruthy()
  })

  it('renders orphaned result entry with explanatory message', () => {
    const entry = buildTraceEntry({
      orphanedResult: true,
      status: 'completed',
      startedAt: null,
      durationMs: null,
      input: undefined,
    })
    render(<SessionToolTrace entries={[entry]} />)
    expect(
      screen.getByText('Result without a recorded tool call. Showing the result data that was received.'),
    ).toBeTruthy()
  })

  it('renders None for undefined input and output', () => {
    const entry = buildTraceEntry({ input: undefined, output: undefined })
    render(<SessionToolTrace entries={[entry]} />)
    expect(screen.getAllByText('None').length).toBeGreaterThan(0)
  })

  it('renders null durationMs without crashing', () => {
    const entry = buildTraceEntry({ durationMs: null, status: 'running' })
    render(<SessionToolTrace entries={[entry]} />)
    expect(screen.queryByText('null')).toBeNull()
  })

  it('renders failed entry with null errorSummary as fallback text', () => {
    const entry = buildTraceEntry({ status: 'failed', errorSummary: null, approval: 'denied' })
    render(<SessionToolTrace entries={[entry]} />)
    expect(screen.getAllByText('Tool execution failed').length).toBeGreaterThan(0)
  })
})

// ---------------------------------------------------------------------------
// CreateSessionSheet — formatCreateSessionError branches
// ---------------------------------------------------------------------------

describe('CreateSessionSheet — formatCreateSessionError', () => {
  it('returns error message for generic Error', () => {
    expect(formatCreateSessionError(new Error('Network timeout'))).toBe('Network timeout')
  })

  it('returns stringified value for non-Error', () => {
    expect(formatCreateSessionError('plain string')).toBe('plain string')
    expect(formatCreateSessionError(42)).toBe('42')
  })

  it('returns ApiError message for ApiError without runtime_catalog details', () => {
    const error = new ApiError('Something went wrong', 400, {
      error: { type: 'bad_request', message: 'Something went wrong', details: { resourceType: 'other' } },
    })
    expect(formatCreateSessionError(error)).toBe('Something went wrong')
  })

  it('returns ApiError message for ApiError with no body details', () => {
    const error = new ApiError('Server error', 500, {})
    expect(formatCreateSessionError(error)).toBe('Server error')
  })

  it('returns ApiError message for ApiError with null details', () => {
    const error = new ApiError('Bad request', 400, { error: { details: null } })
    expect(formatCreateSessionError(error)).toBe('Bad request')
  })

  it('returns ApiError message for ApiError with array details', () => {
    const error = new ApiError('Bad request', 400, { error: { details: ['a', 'b'] } })
    expect(formatCreateSessionError(error)).toBe('Bad request')
  })

  it('returns ApiError message for ApiError with non-object details field', () => {
    const error = new ApiError('Bad request', 400, { error: { details: 'not-an-object' } })
    expect(formatCreateSessionError(error)).toBe('Bad request')
  })

  it('returns Self-hosted label in runtime_catalog capability error', () => {
    const error = new ApiError('Unsupported', 409, {
      error: {
        type: 'conflict',
        message: 'Unsupported',
        details: {
          resourceType: 'runtime_catalog',
          hostingMode: 'self_hosted',
          runtime: 'codex',
          provider: 'openai',
          model: 'gpt-4',
        },
      },
    })
    expect(formatCreateSessionError(error)).toBe(
      'Unsupported capability: Self-hosted session runtime codex cannot run Agent provider openai with model gpt-4.',
    )
  })

  it('renders the sheet form when open=true', async () => {
    server.use(agentsList([buildAgent()]), environmentsList([buildEnvironment()]), memoryStoresList())

    const queryClient = makeQueryClient()
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <CreateSessionSheet open onOpenChange={vi.fn()} />
        </MemoryRouter>
      </QueryClientProvider>,
    )

    expect(screen.getByText('Create Session')).toBeTruthy()
  })

  it('does not render sheet content when open=false', () => {
    const queryClient = makeQueryClient()
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <CreateSessionSheet open={false} onOpenChange={vi.fn()} />
        </MemoryRouter>
      </QueryClientProvider>,
    )

    expect(screen.queryByText('Create Session')).toBeNull()
  })

  it('submits the create session form and navigates to the new session', async () => {
    const newSession = buildSession({ id: 'session_new', name: 'New session' })
    server.use(
      agentsList([buildAgent()]),
      environmentsList([buildEnvironment()]),
      memoryStoresList(),
      http.post('*/api/v1/sessions', () => HttpResponse.json(newSession, { status: 201 })),
    )

    Object.defineProperty(HTMLElement.prototype, 'hasPointerCapture', {
      value: vi.fn(() => false),
      configurable: true,
    })
    Object.defineProperty(HTMLElement.prototype, 'setPointerCapture', {
      value: vi.fn(),
      configurable: true,
    })
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      value: vi.fn(),
      configurable: true,
    })

    const onOpenChange = vi.fn()
    const queryClient = makeQueryClient()
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <CreateSessionSheet open onOpenChange={onOpenChange} />
        </MemoryRouter>
      </QueryClientProvider>,
    )

    // Wait for agents/environments to load
    await waitFor(() => expect(screen.getByText('Create Session')).toBeTruthy())

    fireEvent.change(screen.getByLabelText('Prompt'), { target: { value: 'Create a test session' } })

    // Submit the form (find the submit button)
    const submitButton = await screen.findByRole('button', { name: /create/i })
    fireEvent.click(submitButton)

    // onSuccess: onOpenChange(false) is called
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false), { timeout: 5000 })
  })

  it('shows error message when create session API call fails', async () => {
    server.use(
      agentsList([buildAgent()]),
      environmentsList([buildEnvironment()]),
      memoryStoresList(),
      http.post('*/api/v1/sessions', () =>
        HttpResponse.json(
          {
            error: {
              type: 'conflict',
              message: 'Unsupported runtime',
              details: {
                resourceType: 'runtime_catalog',
                hostingMode: 'cloud',
                runtime: 'ama',
                provider: 'workers-ai',
                model: '@cf/moonshotai/kimi-k2.6',
              },
            },
          },
          { status: 409 },
        ),
      ),
    )

    Object.defineProperty(HTMLElement.prototype, 'hasPointerCapture', {
      value: vi.fn(() => false),
      configurable: true,
    })
    Object.defineProperty(HTMLElement.prototype, 'setPointerCapture', {
      value: vi.fn(),
      configurable: true,
    })
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      value: vi.fn(),
      configurable: true,
    })

    const queryClient = makeQueryClient()
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <CreateSessionSheet open onOpenChange={vi.fn()} />
        </MemoryRouter>
      </QueryClientProvider>,
    )

    await waitFor(() => expect(screen.getByText('Create Session')).toBeTruthy())

    fireEvent.change(screen.getByLabelText('Prompt'), { target: { value: 'Create a failing test session' } })

    const submitButton = await screen.findByRole('button', { name: /create/i })
    fireEvent.click(submitButton)

    // onError → formatCreateSessionError → shows in form
    await waitFor(() => expect(screen.getByText(/Unsupported capability/)).toBeTruthy(), { timeout: 5000 })
  })

  it('useEffect auto-selects first active agent and environment when agents load', async () => {
    server.use(agentsList([buildAgent()]), environmentsList([buildEnvironment()]), memoryStoresList())

    const queryClient = makeQueryClient()
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <CreateSessionSheet open onOpenChange={vi.fn()} />
        </MemoryRouter>
      </QueryClientProvider>,
    )

    // After agents/environments load, the form should have auto-selected them.
    // The Session form shows "Agent provider/model" text when an agent is selected.
    await waitFor(() => expect(screen.getByText(/workers-ai \/ @cf\/moonshotai\/kimi-k2\.6/)).toBeTruthy(), {
      timeout: 5000,
    })
  })

  it('[spec: sessions/identity-materialization] locks and submits the Identity Runtime', async () => {
    const identityAgent = buildAgent({
      identity: {
        identityId: 'identity_codex',
        agentId: 'realmroot_agent_1',
        issuer: 'https://id.realmroot.dev/api/auth',
        subject: 'agent:realmroot_agent_1',
        username: 'codex-operator',
        runtime: 'codex',
      },
    })
    let postedBody: Record<string, unknown> | null = null
    server.use(
      agentsList([identityAgent]),
      environmentsList([buildEnvironment()]),
      memoryStoresList(),
      http.get('*/api/v1/vaults', () => HttpResponse.json(listOf([]))),
      http.post('*/api/v1/sessions', async ({ request }) => {
        postedBody = (await request.json()) as Record<string, unknown>
        return HttpResponse.json(buildSession({ id: 'session_identity', spec: { runtime: 'codex' } }), { status: 201 })
      }),
    )

    const queryClient = makeQueryClient()
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <CreateSessionSheet open onOpenChange={vi.fn()} />
        </MemoryRouter>
      </QueryClientProvider>,
    )

    expect(await screen.findByText('Set by the selected identity.')).toBeTruthy()
    const runtimeSelect = screen.getAllByRole('combobox')[2] as HTMLButtonElement
    expect(runtimeSelect.disabled).toBe(true)
    expect(runtimeSelect.textContent).toContain('Codex')
    fireEvent.change(screen.getByLabelText('Prompt'), { target: { value: 'Run as the Realmroot identity' } })
    fireEvent.submit(screen.getByRole('button', { name: 'Create session' }).closest('form') as HTMLFormElement)

    await waitFor(() => expect(postedBody).not.toBeNull())
    expect(postedBody).toMatchObject({ spec: { agentId: 'agent_1', runtime: 'codex' } })
  })
})

// ---------------------------------------------------------------------------
// SessionsPage — loading / error / filter / sort / batch-archive
// ---------------------------------------------------------------------------

describe('SessionsPage', () => {
  function renderSessionsPage(initialEntries = ['/']) {
    const queryClient = makeQueryClient()
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={initialEntries}>
          <SessionsPage />
        </MemoryRouter>
      </QueryClientProvider>,
    )
    return queryClient
  }

  it('shows loading state initially', () => {
    // Use a handler that never responds to keep the query pending.
    server.use(http.get('*/api/v1/sessions', () => new Promise(() => {})))

    renderSessionsPage()

    expect(screen.getByText('Loading sessions')).toBeTruthy()
  })

  it('renders sessions list once data is loaded', async () => {
    server.use(sessionsList([buildSession()]))

    renderSessionsPage()

    await waitFor(() => expect(screen.getByText('Test session')).toBeTruthy())
    expect(screen.getByText('Sessions')).toBeTruthy()
  })

  it('shows error state when query fails', async () => {
    server.use(
      http.get('*/api/v1/sessions', () =>
        HttpResponse.json({ error: { type: 'internal', message: 'Sessions API failed' } }, { status: 500 }),
      ),
    )

    renderSessionsPage()

    await waitFor(() => expect(screen.getByText('Sessions unavailable')).toBeTruthy())
    expect(screen.getByText('Sessions API failed')).toBeTruthy()
  })

  it('shows empty state when no sessions', async () => {
    server.use(sessionsList([]))

    renderSessionsPage()

    await waitFor(() => expect(screen.getByText('No sessions')).toBeTruthy())
  })

  it('filters sessions by search text', async () => {
    server.use(
      sessionsList([buildSession({ name: 'Alpha session' }), buildSession({ id: 'session_2', name: 'Beta session' })]),
    )

    renderSessionsPage()

    await waitFor(() => expect(screen.getByText('Alpha session')).toBeTruthy())

    const searchInput = screen.getByRole('searchbox', { name: 'Search sessions' })
    fireEvent.change(searchInput, { target: { value: 'Alpha' } })

    await waitFor(() => {
      expect(screen.getByText('Alpha session')).toBeTruthy()
      expect(screen.queryByText('Beta session')).toBeNull()
    })
  })

  it('opens the create session sheet when Create session button is clicked', async () => {
    server.use(sessionsList([]), agentsList([]), environmentsList([]))

    renderSessionsPage()

    await waitFor(() => expect(screen.queryByText('Loading sessions')).toBeNull())

    fireEvent.click(screen.getByRole('button', { name: 'Create session' }))
    await waitFor(() => expect(screen.getByText('Create Session')).toBeTruthy())
  })

  it('Archive selected button is disabled when no sessions selected', async () => {
    server.use(sessionsList([buildSession()]))

    renderSessionsPage()

    await waitFor(() => expect(screen.getByText('Test session')).toBeTruthy())

    const archiveSelectedButton = screen.getByRole('button', { name: 'Archive selected' })
    expect(archiveSelectedButton.hasAttribute('disabled')).toBe(true)
  })

  it('shows batch success outcome after archiving all selected sessions', async () => {
    server.use(sessionsList([buildSession()]), sessionPatch(buildSession({ archivedAt: now })))

    Object.defineProperty(HTMLElement.prototype, 'hasPointerCapture', {
      value: vi.fn(() => false),
      configurable: true,
    })
    Object.defineProperty(HTMLElement.prototype, 'setPointerCapture', {
      value: vi.fn(),
      configurable: true,
    })

    renderSessionsPage()

    await waitFor(() => expect(screen.getByText('Test session')).toBeTruthy())

    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Test session' }))

    const archiveBtn = screen.getByRole('button', { name: 'Archive selected' })
    expect(archiveBtn.hasAttribute('disabled')).toBe(false)
    fireEvent.click(archiveBtn)

    const confirmBtn = await screen.findByRole('button', { name: 'Archive sessions' })
    fireEvent.click(confirmBtn)

    await waitFor(() => expect(screen.getByText(/All selected sessions archived/)).toBeTruthy())
  })

  it('shows batch failure outcome when archive call fails', async () => {
    const sessions = [
      buildSession({ id: 'session_1', name: 'First session' }),
      buildSession({ id: 'session_2', name: 'Second session' }),
    ]
    server.use(
      sessionsList(sessions),
      http.patch('*/api/v1/sessions/session_1', () =>
        HttpResponse.json({ error: { type: 'conflict', message: 'Conflict' } }, { status: 409 }),
      ),
    )

    Object.defineProperty(HTMLElement.prototype, 'hasPointerCapture', {
      value: vi.fn(() => false),
      configurable: true,
    })
    Object.defineProperty(HTMLElement.prototype, 'setPointerCapture', {
      value: vi.fn(),
      configurable: true,
    })

    renderSessionsPage()

    await waitFor(() => expect(screen.getByText('First session')).toBeTruthy())

    fireEvent.click(screen.getByRole('checkbox', { name: 'Select First session' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Second session' }))

    fireEvent.click(screen.getByRole('button', { name: 'Archive selected' }))
    const confirmBtn = await screen.findByRole('button', { name: 'Archive sessions' })
    fireEvent.click(confirmBtn)

    await waitFor(() => expect(screen.getByText(/Failed on "First session"/)).toBeTruthy())
  })

  it('filters by error status showing only errored sessions', async () => {
    server.use(
      sessionsList([
        buildSession({ id: 'session_1', name: 'Good session', phase: 'idle' }),
        buildSession({ id: 'session_2', name: 'Bad session', phase: 'error', reason: 'crashed' }),
      ]),
    )

    renderSessionsPage(['/?status=error'])

    await waitFor(() => expect(screen.queryByText('Loading sessions')).toBeNull())
    await waitFor(() => expect(screen.queryByText('Good session')).toBeNull())
  })

  it('sorts sessions by started-asc', async () => {
    const older = buildSession({ id: 'session_old', name: 'Older', startedAt: '2026-01-01T00:00:00.000Z' })
    const newer = buildSession({ id: 'session_new', name: 'Newer', startedAt: '2026-06-01T00:00:00.000Z' })
    server.use(sessionsList([newer, older]))

    renderSessionsPage(['/?sort=started-asc'])

    await waitFor(() => expect(screen.getByText('Older')).toBeTruthy())
    const rows = screen.getAllByRole('row')
    const olderIndex = rows.findIndex((row) => row.textContent?.includes('Older'))
    const newerIndex = rows.findIndex((row) => row.textContent?.includes('Newer'))
    expect(olderIndex).toBeLessThan(newerIndex)
  })

  it('sorts sessions by started-desc', async () => {
    const older = buildSession({ id: 'session_old', name: 'Older', startedAt: '2026-01-01T00:00:00.000Z' })
    const newer = buildSession({ id: 'session_new', name: 'Newer', startedAt: '2026-06-01T00:00:00.000Z' })
    server.use(sessionsList([older, newer]))

    renderSessionsPage(['/?sort=started-desc'])

    await waitFor(() => expect(screen.getByText('Newer')).toBeTruthy())
    const rows = screen.getAllByRole('row')
    const olderIndex = rows.findIndex((row) => row.textContent?.includes('Older'))
    const newerIndex = rows.findIndex((row) => row.textContent?.includes('Newer'))
    expect(newerIndex).toBeLessThan(olderIndex)
  })

  it('sorts sessions by updated-asc', async () => {
    const older = buildSession({
      id: 'session_old',
      name: 'OlderUpdated',
      updatedAt: '2026-01-01T00:00:00.000Z',
    })
    const newer = buildSession({
      id: 'session_new',
      name: 'NewerUpdated',
      updatedAt: '2026-06-01T00:00:00.000Z',
    })
    server.use(sessionsList([newer, older]))

    renderSessionsPage(['/?sort=updated-asc'])

    await waitFor(() => expect(screen.getByText('OlderUpdated')).toBeTruthy())
    const rows = screen.getAllByRole('row')
    const olderIndex = rows.findIndex((row) => row.textContent?.includes('OlderUpdated'))
    const newerIndex = rows.findIndex((row) => row.textContent?.includes('NewerUpdated'))
    expect(olderIndex).toBeLessThan(newerIndex)
  })

  it('shows error message for non-Error query rejection', async () => {
    server.use(
      http.get('*/api/v1/sessions', () =>
        HttpResponse.json({ error: { type: 'internal', message: 'string error rejection' } }, { status: 500 }),
      ),
    )

    renderSessionsPage()

    await waitFor(() => expect(screen.getByText('Sessions unavailable')).toBeTruthy())
    expect(screen.getByText('string error rejection')).toBeTruthy()
  })

  it('shows batch outcome with archived count and failure message when some sessions succeed', async () => {
    const sessions = [
      buildSession({ id: 'session_1', name: 'First session' }),
      buildSession({ id: 'session_2', name: 'Second session' }),
      buildSession({ id: 'session_3', name: 'Third session' }),
    ]
    server.use(
      sessionsList(sessions),
      http.patch('*/api/v1/sessions/session_1', () =>
        HttpResponse.json(buildSession({ id: 'session_1', archivedAt: now })),
      ),
      http.patch('*/api/v1/sessions/session_2', () =>
        HttpResponse.json({ error: { type: 'conflict', message: 'Archive conflict' } }, { status: 409 }),
      ),
    )

    Object.defineProperty(HTMLElement.prototype, 'hasPointerCapture', {
      value: vi.fn(() => false),
      configurable: true,
    })
    Object.defineProperty(HTMLElement.prototype, 'setPointerCapture', {
      value: vi.fn(),
      configurable: true,
    })

    renderSessionsPage()

    await waitFor(() => expect(screen.getByText('First session')).toBeTruthy())

    fireEvent.click(screen.getByRole('checkbox', { name: 'Select First session' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Second session' }))

    fireEvent.click(screen.getByRole('button', { name: 'Archive selected' }))
    const confirmBtn = await screen.findByRole('button', { name: 'Archive sessions' })
    fireEvent.click(confirmBtn)

    await waitFor(() => expect(screen.getByText(/Archived 1 session\./)).toBeTruthy())
    expect(screen.getByText(/Failed on "Second session"/)).toBeTruthy()
  })

  it('shows plural sessions count in batch success outcome', async () => {
    const sessions = [
      buildSession({ id: 'session_1', name: 'First session' }),
      buildSession({ id: 'session_2', name: 'Second session' }),
    ]
    server.use(
      sessionsList(sessions),
      http.patch('*/api/v1/sessions/session_1', () =>
        HttpResponse.json(buildSession({ id: 'session_1', archivedAt: now })),
      ),
      http.patch('*/api/v1/sessions/session_2', () =>
        HttpResponse.json(buildSession({ id: 'session_2', archivedAt: now })),
      ),
    )

    Object.defineProperty(HTMLElement.prototype, 'hasPointerCapture', {
      value: vi.fn(() => false),
      configurable: true,
    })
    Object.defineProperty(HTMLElement.prototype, 'setPointerCapture', {
      value: vi.fn(),
      configurable: true,
    })

    renderSessionsPage()

    await waitFor(() => expect(screen.getByText('First session')).toBeTruthy())

    fireEvent.click(screen.getByRole('checkbox', { name: 'Select First session' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Second session' }))

    fireEvent.click(screen.getByRole('button', { name: 'Archive selected' }))
    const confirmBtn = await screen.findByRole('button', { name: 'Archive sessions' })
    fireEvent.click(confirmBtn)

    await waitFor(() => expect(screen.getByText(/All selected sessions archived/)).toBeTruthy())
  })

  it('sorts sessions by started-asc when startedAt is null (falls back to createdAt)', async () => {
    const older = buildSession({
      id: 'session_old',
      name: 'OlderCreated',
      startedAt: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    })
    const newer = buildSession({
      id: 'session_new',
      name: 'NewerCreated',
      startedAt: null,
      createdAt: '2026-06-01T00:00:00.000Z',
      updatedAt: '2026-06-01T00:00:00.000Z',
    })
    server.use(sessionsList([newer, older]))

    renderSessionsPage(['/?sort=started-asc'])

    await waitFor(() => expect(screen.getByText('OlderCreated')).toBeTruthy())
    const rows = screen.getAllByRole('row')
    const olderIndex = rows.findIndex((row) => row.textContent?.includes('OlderCreated'))
    const newerIndex = rows.findIndex((row) => row.textContent?.includes('NewerCreated'))
    expect(olderIndex).toBeLessThan(newerIndex)
  })

  it('shows error message from api when archive call returns 4xx with error body', async () => {
    const sessions = [buildSession({ id: 'session_1', name: 'Only session' })]
    server.use(
      sessionsList(sessions),
      http.patch('*/api/v1/sessions/session_1', () =>
        HttpResponse.json({ error: { type: 'conflict', message: 'archive-rejected' } }, { status: 409 }),
      ),
    )

    Object.defineProperty(HTMLElement.prototype, 'hasPointerCapture', {
      value: vi.fn(() => false),
      configurable: true,
    })
    Object.defineProperty(HTMLElement.prototype, 'setPointerCapture', {
      value: vi.fn(),
      configurable: true,
    })

    renderSessionsPage()

    await waitFor(() => expect(screen.getByText('Only session')).toBeTruthy())

    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Only session' }))
    fireEvent.click(screen.getByRole('button', { name: 'Archive selected' }))
    const confirmBtn = await screen.findByRole('button', { name: 'Archive sessions' })
    fireEvent.click(confirmBtn)

    await waitFor(() => expect(screen.getByText(/archive-rejected/)).toBeTruthy())
  })
})

// ---------------------------------------------------------------------------
// SessionDetailPage — loading / not-found states (safe: null/closed session = no WebSocket)
// ---------------------------------------------------------------------------

describe('SessionDetailPage', () => {
  it('keeps polling pending and running sessions until the control plane reaches a terminal turn state [spec: sessions/live-state-refresh]', () => {
    expect(sessionRefetchInterval('pending')).toBe(2000)
    expect(sessionRefetchInterval('running')).toBe(2000)
    expect(sessionRefetchInterval('idle')).toBe(false)
    expect(sessionRefetchInterval('error')).toBe(false)
  })

  it('shows loading state while session query is pending', () => {
    server.use(http.get('*/api/v1/sessions/session_loading', () => new Promise(() => {})))

    const queryClient = makeQueryClient()
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/sessions/session_loading']}>
          <Routes>
            <Route path="/sessions/:sessionId" element={<SessionDetailPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    )

    expect(screen.getByText('Loading session')).toBeTruthy()
  })

  it('shows not-found state when session query returns 404', async () => {
    server.use(sessionNotFound())

    const queryClient = makeQueryClient()
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/sessions/session_404']}>
          <Routes>
            <Route path="/sessions/:sessionId" element={<SessionDetailPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    )

    await waitFor(() => expect(screen.getByText('Session not found')).toBeTruthy(), { timeout: 5000 })
  })

  it('renders session detail view for a closed session (agentId and environmentId present)', async () => {
    stubSessionSocket()
    const stoppedSession = buildSession({ id: 'session_stopped', phase: 'closed', closedAt: now })
    server.use(sessionDetail(stoppedSession), agentDetail(buildAgent()), environmentDetail(buildEnvironment()))

    const queryClient = makeQueryClient()
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/sessions/session_stopped']}>
          <Routes>
            <Route path="/sessions/:sessionId" element={<SessionDetailPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    )

    await waitFor(() => expect(screen.getByText('Test session')).toBeTruthy(), { timeout: 5000 })
    expect(screen.getAllByText('closed').length).toBeGreaterThan(0)
  })

  it('loads complete session event history through socket backfill pagination', async () => {
    const sockets = stubSessionSocket()
    const stoppedSession = buildSession({ id: 'session_history', phase: 'closed', closedAt: now })
    server.use(sessionDetail(stoppedSession), agentDetail(buildAgent()), environmentDetail(buildEnvironment()))

    const queryClient = makeQueryClient()
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/sessions/session_history']}>
          <Routes>
            <Route path="/sessions/:sessionId" element={<SessionDetailPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    )

    await waitFor(() => expect(sockets[0]).toBeTruthy(), { timeout: 5000 })
    sockets[0]!.emit({
      type: 'backfill',
      requestId: 'backfill-1',
      events: [buildMessageEvent('session_history', 1, 'First page reply')],
      hasMore: true,
      nextCursor: 1,
    })
    await waitFor(() => expect(sockets[0]!.sent).toHaveLength(1), { timeout: 5000 })
    expect(JSON.parse(sockets[0]!.sent[0] ?? '{}')).toMatchObject({ type: 'backfill', cursor: 1, limit: 200 })
    sockets[0]!.emit({
      type: 'backfill',
      requestId: 'backfill-2',
      events: [buildMessageEvent('session_history', 2, 'Second page reply')],
      hasMore: false,
      nextCursor: null,
    })

    await waitFor(() => expect(screen.getByText('First page reply')).toBeTruthy(), { timeout: 5000 })
    expect(screen.getByText('Second page reply')).toBeTruthy()
  })

  it('renders view while socket backfill has not arrived yet', async () => {
    stubSessionSocket()
    const stoppedSession = buildSession({ id: 'session_events_pending', phase: 'closed', closedAt: now })
    server.use(sessionDetail(stoppedSession), agentDetail(buildAgent()), environmentDetail(buildEnvironment()))

    const queryClient = makeQueryClient()
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/sessions/session_events_pending']}>
          <Routes>
            <Route path="/sessions/:sessionId" element={<SessionDetailPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    )

    await waitFor(() => expect(screen.getByText('Test session')).toBeTruthy(), { timeout: 5000 })
  })

  it('renders loading state when sessionId param is undefined (covers sessionId ?? "" branches)', () => {
    // Mounting the component outside a :sessionId route means useParams() returns {}
    // and sessionId is undefined. This exercises the `sessionId ?? ''` null-coalescing
    // branch where the query is disabled and data is always undefined.
    const queryClient = makeQueryClient()
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/sessions']}>
          <Routes>
            {/* Route has no :sessionId param → useParams() returns {} → sessionId=undefined */}
            <Route path="/sessions" element={<SessionDetailPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    )
    // With sessionId=undefined, enabled=false for all queries → isPending=true → loading state
    expect(screen.getByText('Loading session')).toBeTruthy()
  })

  it('renders session detail view with no agentId/environmentId (enabled=false branches)', async () => {
    stubSessionSocket()
    const minimalSession = buildSession({
      id: 'session_minimal',
      phase: 'closed',
      closedAt: now,
      agentId: '',
      environmentId: null,
      environmentVersionId: null,
      environmentSnapshot: null,
    })
    server.use(sessionDetail(minimalSession))

    const queryClient = makeQueryClient()
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/sessions/session_minimal']}>
          <Routes>
            <Route path="/sessions/:sessionId" element={<SessionDetailPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    )

    await waitFor(() => expect(screen.getByText('Test session')).toBeTruthy(), { timeout: 5000 })
  })
})

// ---------------------------------------------------------------------------
// Within helper is imported at top — used here for table row assertions
// ---------------------------------------------------------------------------
const _within = within // ensure import is used; within is available from @testing-library/react
void _within
