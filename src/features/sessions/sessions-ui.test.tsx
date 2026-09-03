import { ENBOR_SESSION_EVENT_TYPES } from '@shared/session-events'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { formatTime } from '@/console/format'
import { SessionForm } from '@/console/forms'
import { useClientPagination } from '@/console/use-client-pagination'
import { type Agent, ApiError, type Environment, type Session, type SessionEvent } from '@/lib/enborrpc'
import {
  type AgentOverrides,
  type EnvironmentOverrides,
  agent as resourceAgent,
  environment as resourceEnvironment,
} from '@/test/resource-fixtures'
import { buildTestSession, type TestSessionOverrides } from '@/testing/session'
import { formatCreateSessionError } from './CreateSessionSheet'
import { SessionDetailView } from './SessionDetailView'
import { eventFilter, SessionRuntimePanel, transcriptFilter } from './SessionRuntimePanel'
import { SessionsView } from './SessionsView'
import type { SessionRuntimeState } from './session-runtime'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

function buildSession(overrides: TestSessionOverrides = {}): Session {
  return buildTestSession({ name: 'First run workflow', ...overrides })
}

function buildAgent(overrides: AgentOverrides = {}): Agent {
  return resourceAgent({
    createdAt: '2026-05-23T00:00:00.000Z',
    updatedAt: '2026-05-23T00:00:00.000Z',
    ...overrides,
  })
}

function buildEnvironment(overrides: EnvironmentOverrides = {}): Environment {
  return resourceEnvironment({
    packages: { type: 'packages', apt: [], cargo: [], gem: [], go: [], npm: ['tsx@latest'], pip: [], webi: [] },
    networking: {
      type: 'limited',
      allowMcpServers: false,
      allowPackageManagers: true,
      allowedHosts: ['registry.npmjs.org'],
    },
    createdAt: '2026-05-23T00:00:00.000Z',
    updatedAt: '2026-05-23T00:00:00.000Z',
    ...overrides,
  })
}

type SessionEventOverrides = Partial<Omit<SessionEvent, 'type' | 'payload'>> & {
  type?: SessionEvent['type']
  payload?: Record<string, unknown>
  metadata?: Record<string, unknown>
  event?: Pick<SessionEvent, 'type' | 'payload'>
}

function buildPersistedEvent(overrides: SessionEventOverrides = {}): SessionEvent {
  const {
    type = 'message.completed',
    payload = {
      message: { role: 'assistant', content: 'Runtime failed to start' },
    },
    event: eventOverride,
    ...recordOverrides
  } = overrides
  return {
    id: 'event_1',
    sessionId: 'session_1',
    sequence: 1,
    type,
    payload: payload as SessionEvent['payload'],
    createdAt: '2026-05-23T00:00:00.000Z',
    ...recordOverrides,
  }
}

function buildRuntimeState(overrides: Partial<SessionRuntimeState> = {}): SessionRuntimeState {
  return {
    connection: 'open',
    runState: 'idle',
    messages: [
      {
        id: 'message_1',
        role: 'assistant',
        content: 'Runtime failed to start',
        status: 'error',
        createdAt: '2026-05-23T00:00:00.000Z',
      },
    ],
    tools: [],
    sessionEvents: [
      buildPersistedEvent({
        type: 'runtime.error',
        payload: {
          message: 'Runtime failed to start',
        },
      }),
    ],
    eventKeys: [],
    error: 'Runtime failed to start',
    ...overrides,
  }
}

describe('[spec: sessions/console-detail] [spec: sessions/console-transcript] sessions UI contracts', () => {
  it('shows Agent-owned provider/model, Environment-owned hosting, and Session-owned runtime in session creation', () => {
    render(
      <SessionForm
        value={{
          agentId: 'agent_1',
          environmentId: 'env_1',
          runtime: 'ama',
          prompt: 'Run session',
          credentialVaultIds: [],
          resources: [],
        }}
        setValue={vi.fn()}
        agents={[buildAgent()]}
        environments={[buildEnvironment({ type: 'self_hosted' })]}
        onSubmit={vi.fn()}
      />,
    )

    expect(screen.getByText('Agent provider/model: workers-ai / @cf/moonshotai/kimi-k2.6')).toBeTruthy()
    expect(screen.getByText('Environment type: Self-hosted')).toBeTruthy()
    expect(screen.getByText('Runtime is selected per session.')).toBeTruthy()
    expect(screen.getAllByText('Enbor').length).toBeGreaterThan(0)
  })

  it('formats structured runtime capability failures with exact runtime provider and model', () => {
    const error = new ApiError('Unsupported runtime provider/model combination', 409, {
      error: {
        type: 'conflict',
        message: 'Unsupported runtime provider/model combination',
        details: {
          resourceType: 'runtime_catalog',
          hostingMode: 'cloud',
          runtime: 'ama',
          provider: 'workers-ai',
          model: '@cf/moonshotai/kimi-k2.6',
        },
      },
    })

    expect(formatCreateSessionError(error)).toBe(
      'Unsupported capability: Cloud session runtime ama cannot run Agent provider workers-ai with model @cf/moonshotai/kimi-k2.6.',
    )
  })

  it('keeps error status detail off the table row while preserving pagination and adaptive surface', () => {
    const sessions = Array.from({ length: 11 }, (_, index) =>
      buildSession({
        id: `session_${index + 1}`,
        name: `Session ${index + 1}`,
        phase: index === 0 ? 'error' : 'idle',
        reason: index === 0 ? 'Runtime crashed' : null,
      }),
    )
    function Harness() {
      const pagination = useClientPagination(sessions)
      return (
        <MemoryRouter>
          <SessionsView
            sessions={pagination.items}
            pagination={pagination}
            selectedIds={[]}
            setSelectedIds={vi.fn()}
            onDelete={vi.fn()}
          />
        </MemoryRouter>
      )
    }

    render(<Harness />)

    const table = screen.getByRole('table')
    expect(within(table).getAllByRole('row')).toHaveLength(11)
    const badgeTrigger = screen.getByLabelText('error: Runtime crashed')
    expect(screen.queryByText('Runtime crashed')).toBeNull()
    expect(badgeTrigger.getAttribute('aria-label')).toBe('error: Runtime crashed')
    expect(screen.getByText('1-10 of 11')).toBeTruthy()
    expect(table.closest('[data-slot="table-container"]')?.className).toContain('overflow-hidden')
    expect(table.closest('[data-slot="table-container"]')?.parentElement?.className).toContain('overflow-y-auto')
    expect(table.closest('[data-slot="table-container"]')?.parentElement?.className).toContain('overflow-x-hidden')
    expect(table.closest('[data-slot="table-container"]')?.parentElement?.parentElement?.className).toContain(
      'overflow-hidden',
    )

    const viewport = table.closest('[data-slot="table-container"]')?.parentElement as HTMLDivElement
    viewport.scrollTop = 72
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }))
    expect(screen.getByText('11-11 of 11')).toBeTruthy()
    expect(screen.getByText('Session 11')).toBeTruthy()
    expect(viewport.scrollTop).toBe(0)
  })

  it('renders one table row for one error session', () => {
    const session = buildSession({ phase: 'error', reason: 'Runtime crashed' })
    render(
      <MemoryRouter>
        <SessionsView
          sessions={[session]}
          pagination={{
            items: [session],
            page: 1,
            pageCount: 1,
            pageSize: 10,
            total: 1,
            start: 1,
            end: 1,
            canPrevious: false,
            canNext: false,
            viewportRef: { current: null },
            previous: vi.fn(),
            next: vi.fn(),
          }}
          selectedIds={[]}
          setSelectedIds={vi.fn()}
          onDelete={vi.fn()}
        />
      </MemoryRouter>,
    )

    const table = screen.getByRole('table')
    expect(within(table).getAllByRole('row')).toHaveLength(2)
    const badgeTrigger = screen.getByLabelText('error: Runtime crashed')
    expect(screen.queryByText('Runtime crashed')).toBeNull()
    expect(badgeTrigger.getAttribute('aria-label')).toBe('error: Runtime crashed')
    expect(table.closest('[data-slot="table-container"]')?.className).toContain('overflow-hidden')
    expect(table.closest('[data-slot="table-container"]')?.parentElement?.className).toContain('overflow-y-auto')
    expect(table.closest('[data-slot="table-container"]')?.parentElement?.className).toContain('overflow-x-hidden')
    expect(table.closest('[data-slot="table-container"]')?.parentElement?.parentElement?.className).toContain(
      'overflow-hidden',
    )
  })

  it('renders session rows with agent identity and provider/model tooltip metadata', () => {
    const session = buildSession({
      environmentSnapshot: {
        ...buildSession().status.bindings.environment.snapshot!,
        type: 'self_hosted',
      },
      spec: { ...buildSession().spec, runtime: 'codex' },
      status: {
        placement: { ...buildSession().status.placement!, hostingMode: 'self_hosted' },
      },
    })
    render(
      <MemoryRouter>
        <SessionsView
          sessions={[session]}
          pagination={{
            items: [session],
            page: 1,
            pageCount: 1,
            pageSize: 10,
            total: 1,
            start: 1,
            end: 1,
            canPrevious: false,
            canNext: false,
            viewportRef: { current: null },
            previous: vi.fn(),
            next: vi.fn(),
          }}
          agentNameById={new Map([['agent_1', 'Coding agent']])}
          selectedIds={[]}
          setSelectedIds={vi.fn()}
          onDelete={vi.fn()}
        />
      </MemoryRouter>,
    )

    expect(screen.queryByText('Agent provider/model')).toBeNull()
    expect(screen.getByText('Hosting / runtime')).toBeTruthy()
    expect(screen.getByText('Coding agent')).toBeTruthy()
    expect(screen.getByText('agent_1')).toBeTruthy()
    expect(
      screen.getByLabelText('Coding agent agent_1. Provider/model: workers-ai / @cf/moonshotai/kimi-k2.6'),
    ).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Self-hosted / codex · env_1' })).toBeTruthy()
    expect(screen.queryByText(/legacy-provider|legacy-model/)).toBeNull()
  })

  it('renders compact session header metadata without the old fact cards', () => {
    const session = buildSession({
      phase: 'pending',
      reason: 'waiting-for-runner',
      environmentSnapshot: {
        ...buildSession().status.bindings.environment.snapshot!,
        type: 'self_hosted',
      },
      spec: { ...buildSession().spec, runtime: 'codex' },
      status: {
        placement: { ...buildSession().status.placement!, hostingMode: 'self_hosted' },
      },
    })

    render(
      <MemoryRouter>
        <SessionDetailView
          session={session}
          agentName="Coding agent"
          environmentName="Node workspace"
          runtime={buildRuntimeState({ messages: [], tools: [], sessionEvents: [], error: null })}
          onClose={vi.fn()}
          onReopen={vi.fn()}
          onDelete={vi.fn()}
          onReconnectRuntime={vi.fn()}
          chatMessage=""
          setChatMessage={vi.fn()}
          onSendMessage={vi.fn()}
          onAbortRuntime={vi.fn()}
        />
      </MemoryRouter>,
    )

    expect(screen.getAllByText('Coding agent').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Node workspace').length).toBeGreaterThan(0)
    expect(screen.getByText('pending')).toBeTruthy()
    expect(screen.queryByText('Agent provider/model')).toBeNull()
    expect(screen.queryByText('Hosting / runtime')).toBeNull()
    expect(screen.queryByText('Environment type')).toBeNull()
    expect(screen.queryByText('Runtime status')).toBeNull()
    expect(screen.queryByText(/legacy-provider|legacy-model/)).toBeNull()
  })

  it('renders memory store resources without exposing memory contents', () => {
    const session = buildSession({
      spec: {
        ...buildSession().spec,
        volumes: [
          {
            type: 'memory',
            name: 'Team memory',
            memoryRef: 'ama://memories/memstore_1',
          },
        ],
        volumeMounts: [{ name: 'Team memory', mountPath: '/workspace/.ama/memory-stores/memstore_1', readOnly: false }],
      },
    })

    render(
      <MemoryRouter>
        <SessionDetailView
          session={session}
          agentName="Coding agent"
          environmentName="Node workspace"
          runtime={buildRuntimeState({ messages: [], tools: [], sessionEvents: [], error: null })}
          onClose={vi.fn()}
          onReopen={vi.fn()}
          onDelete={vi.fn()}
          onReconnectRuntime={vi.fn()}
          chatMessage=""
          setChatMessage={vi.fn()}
          onSendMessage={vi.fn()}
          onAbortRuntime={vi.fn()}
        />
      </MemoryRouter>,
    )

    fireEvent.click(screen.getAllByLabelText('Open session volumes')[0]!)
    expect(screen.getByText('Session volumes')).toBeTruthy()
    expect(screen.getByText(/memstore_1/)).toBeTruthy()
    expect(screen.queryByText(/secret content/)).toBeNull()
  })

  it('renders transcript timestamps in message metadata without exposing raw payloads in transcript mode', () => {
    const runtime = buildRuntimeState()

    render(
      <SessionRuntimePanel
        runtime={runtime}
        message=""
        setMessage={vi.fn()}
        onSend={vi.fn()}
        onAbort={vi.fn()}
        onReconnect={vi.fn()}
        canSend
      />,
    )

    const article = screen.getByText('Runtime failed to start').closest('article')
    expect(article).toBeTruthy()
    expect(within(article as HTMLElement).getByText(formatTime(runtime.messages[0]?.createdAt ?? null))).toBeTruthy()
    expect(within(article as HTMLElement).getByLabelText('Error: Runtime failed to start')).toBeTruthy()
    expect(screen.queryByText(/"message":/)).toBeNull()
  })

  it('shows the selected transcript event beside the message list', () => {
    const persistedEvents = [
      buildPersistedEvent({
        id: 'event_1',
        payload: {
          type: 'message.completed',
          debugOnly: 'selected_event_marker',
          message: {
            id: 'runtime_message_1',
            role: 'assistant',
            content: [{ type: 'text', text: 'Open workspace' }],
          },
        },
      }),
    ]
    const runtime = buildRuntimeState({
      messages: [
        {
          id: 'runtime_message_1',
          sourceEventId: 'event_1',
          role: 'assistant',
          content: 'Open workspace',
          status: 'complete',
          createdAt: '2026-05-23T00:00:00.000Z',
        },
      ],
      tools: [],
      sessionEvents: persistedEvents,
      error: null,
    })

    render(
      <SessionRuntimePanel
        runtime={runtime}
        message=""
        setMessage={vi.fn()}
        onSend={vi.fn()}
        onAbort={vi.fn()}
        onReconnect={vi.fn()}
        canSend
      />,
    )

    expect(screen.queryByText(/selected_event_marker/)).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: /Open workspace/ }))

    expect(screen.getByText('event_1')).toBeTruthy()
    expect(screen.getByText(/selected_event_marker/)).toBeTruthy()
  })

  it('keeps canonical payload JSON in debug while transcript renders structured message, tool, lifecycle, usage, error, and metadata rows', async () => {
    const runtime = buildRuntimeState({
      messages: [
        {
          id: 'message_1',
          role: 'assistant',
          content: 'Structured answer',
          status: 'complete',
          createdAt: '2026-05-23T00:00:00.000Z',
        },
      ],
      tools: [
        {
          id: 'tool_1:2026-05-23T00:00:01.000Z',
          callId: 'tool_1',
          name: 'read_file',
          status: 'success',
          input: { path: 'README.md' },
          output: 'ok',
          error: null,
          durationMs: 12,
          createdAt: '2026-05-23T00:00:01.000Z',
          updatedAt: '2026-05-23T00:00:01.000Z',
          eventType: 'tool_result',
        },
      ],
      sessionEvents: ENBOR_SESSION_EVENT_TYPES.map((type, index) =>
        buildPersistedEvent({
          id: `debug_${type}`,
          sequence: index + 1,
          type,
          payload: { type, safe: true, marker: `payload_${type}` },
          createdAt: new Date((index + 1) * 1000).toISOString(),
        }),
      ),
    })

    render(
      <SessionRuntimePanel
        runtime={runtime}
        message=""
        setMessage={vi.fn()}
        onSend={vi.fn()}
        onAbort={vi.fn()}
        onReconnect={vi.fn()}
        canSend
      />,
    )

    expect(screen.getByText('Structured answer')).toBeTruthy()
    expect(screen.getByText('read_file')).toBeTruthy()
    expect(screen.queryByText(/payload_runtime.error/)).toBeNull()

    const debugTab = screen.getByRole('tab', { name: 'Debug' })
    fireEvent.pointerDown(debugTab, { button: 0, ctrlKey: false })
    fireEvent.mouseDown(debugTab)
    fireEvent.mouseUp(debugTab)
    fireEvent.click(debugTab)
    await waitFor(() => expect(debugTab.getAttribute('aria-selected')).toBe('true'))

    for (const type of ENBOR_SESSION_EVENT_TYPES) {
      expect(screen.getAllByText(type).length).toBeGreaterThan(0)
      expect(screen.getByText(`debug_${type}`)).toBeTruthy()
    }
    fireEvent.click(screen.getByText('debug_runtime.error').closest('button')!)
    expect(screen.getByText(/payload_runtime.error/)).toBeTruthy()
  })

  it('renders transcript and debug empty states', async () => {
    render(
      <SessionRuntimePanel
        runtime={buildRuntimeState({ messages: [], tools: [], sessionEvents: [], error: null })}
        message=""
        setMessage={vi.fn()}
        onSend={vi.fn()}
        onAbort={vi.fn()}
        onReconnect={vi.fn()}
        canSend
      />,
    )

    expect(screen.getByText('No messages yet')).toBeTruthy()
    expect(screen.getByRole('tab', { name: 'Transcript' })).toBeTruthy()
    expect(screen.queryByRole('tab', { name: 'Tools' })).toBeNull()
    const debugTab = screen.getByRole('tab', { name: 'Debug' })
    fireEvent.pointerDown(debugTab, { button: 0, ctrlKey: false })
    fireEvent.mouseDown(debugTab)
    fireEvent.mouseUp(debugTab)
    fireEvent.click(debugTab)
    await waitFor(() => expect(debugTab.getAttribute('aria-selected')).toBe('true'))
    expect(screen.getByText('No debug events')).toBeTruthy()
  })

  it('copies and downloads debug event exports without adding payload JSON to transcript', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    })
    const createObjectURL = vi.fn(() => 'blob:session-events')
    const revokeObjectURL = vi.fn()
    Object.defineProperty(URL, 'createObjectURL', { value: createObjectURL, configurable: true })
    Object.defineProperty(URL, 'revokeObjectURL', { value: revokeObjectURL, configurable: true })
    const createElement = document.createElement.bind(document)
    vi.spyOn(document, 'createElement').mockImplementation((tagName, options) => {
      const element = createElement(tagName, options)
      if (tagName === 'a') {
        element.click = vi.fn()
      }
      return element
    })
    const sessionEvents = [
      buildPersistedEvent(),
      buildPersistedEvent({
        id: 'live_only_event',
        sequence: 2,
        type: 'runtime.error',
        payload: { message: 'live_only_payload' },
        createdAt: '2026-05-23T00:00:01.000Z',
      }),
    ]

    render(
      <SessionRuntimePanel
        runtime={buildRuntimeState({
          sessionEvents,
        })}
        message=""
        setMessage={vi.fn()}
        onSend={vi.fn()}
        onAbort={vi.fn()}
        onReconnect={vi.fn()}
        canSend
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Copy events' }))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(expect.stringContaining('"message.completed"')))
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('live_only_event'))
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('live_only_payload'))

    fireEvent.click(screen.getByRole('button', { name: 'Download events' }))
    expect(createObjectURL).toHaveBeenCalledWith(expect.any(Blob))
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:session-events')
    expect(screen.queryByText(/"payload":/)).toBeNull()
  })

  it('submits trimmed runtime messages and parses debug event filters', () => {
    const onSend = vi.fn()
    const setMessage = vi.fn()

    render(
      <SessionRuntimePanel
        runtime={buildRuntimeState({
          messages: [],
          tools: [],
          sessionEvents: [
            buildPersistedEvent({
              id: 'debug_message',
              sequence: 1,
              type: 'message.completed',
              payload: { type: 'message.completed', marker: 'payload_message' },
              createdAt: '2026-05-23T00:00:00.000Z',
            }),
          ],
        })}
        message="  Ship it  "
        setMessage={setMessage}
        onSend={onSend}
        onAbort={vi.fn()}
        onReconnect={vi.fn()}
        canSend
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    expect(onSend).toHaveBeenCalledWith('Ship it')
    expect(setMessage).toHaveBeenCalledWith('')

    expect(eventFilter('runtime.error')).toBe('runtime.error')
    expect(eventFilter('message.completed')).toBe('message.completed')
    expect(eventFilter('')).toBe('all')
    expect(transcriptFilter('user')).toBe('user')
    expect(transcriptFilter('agent')).toBe('agent')
    expect(transcriptFilter('tool')).toBe('tool')
    expect(transcriptFilter('error')).toBe('error')
    expect(transcriptFilter('system')).toBe('system')
    expect(transcriptFilter('bad')).toBe('all')
  })

  it('filters transcript items through the transcript menu', async () => {
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

    render(
      <SessionRuntimePanel
        runtime={buildRuntimeState({
          messages: [
            {
              id: 'message_user',
              role: 'user',
              content: 'User request',
              status: 'complete',
              createdAt: '2026-05-23T00:00:00.000Z',
            },
            {
              id: 'message_1',
              role: 'assistant',
              content: 'Only message text',
              status: 'complete',
              createdAt: '2026-05-23T00:00:01.000Z',
            },
            {
              id: 'message_system',
              role: 'system',
              content: 'System note',
              status: 'complete',
              createdAt: '2026-05-23T00:00:02.000Z',
            },
            {
              id: 'message_error',
              role: 'assistant',
              content: 'Runtime failed',
              status: 'error',
              createdAt: '2026-05-23T00:00:03.000Z',
            },
          ],
          tools: [
            {
              id: 'tool_1',
              callId: 'call_1',
              name: 'read_file',
              status: 'success',
              input: { path: 'README.md' },
              output: 'ok',
              error: null,
              durationMs: 5,
              createdAt: '2026-05-23T00:00:04.000Z',
              updatedAt: '2026-05-23T00:00:04.000Z',
              eventType: 'tool_result',
            },
          ],
          sessionEvents: [],
        })}
        message=""
        setMessage={vi.fn()}
        onSend={vi.fn()}
        onAbort={vi.fn()}
        onReconnect={vi.fn()}
        canSend
      />,
    )

    expect(screen.getByText('User request')).toBeTruthy()
    expect(screen.getByText('Only message text')).toBeTruthy()
    expect(screen.getByText('System note')).toBeTruthy()
    expect(screen.getByText('Runtime failed')).toBeTruthy()
    expect(screen.getByText('read_file')).toBeTruthy()

    const filter = screen.getByRole('combobox', { name: 'Filter transcript' })
    filter.focus()
    fireEvent.pointerDown(filter, { button: 0, ctrlKey: false, pointerId: 1, pointerType: 'mouse' })
    fireEvent.mouseDown(filter)
    fireEvent.keyDown(filter, { key: 'ArrowDown' })
    fireEvent.click(await screen.findByRole('option', { name: 'Tool' }))

    expect(screen.queryByText('User request')).toBeNull()
    expect(screen.queryByText('Only message text')).toBeNull()
    expect(screen.queryByText('System note')).toBeNull()
    expect(screen.queryByText('Runtime failed')).toBeNull()
    expect(screen.getByText('read_file')).toBeTruthy()

    filter.focus()
    fireEvent.pointerDown(filter, { button: 0, ctrlKey: false, pointerId: 2, pointerType: 'mouse' })
    fireEvent.mouseDown(filter)
    fireEvent.keyDown(filter, { key: 'ArrowDown' })
    fireEvent.click(await screen.findByRole('option', { name: 'Agent' }))

    expect(screen.getByText('Only message text')).toBeTruthy()
    expect(screen.getByText('Runtime failed')).toBeTruthy()
    expect(screen.queryByText('User request')).toBeNull()
    expect(screen.queryByText('System note')).toBeNull()
    expect(screen.queryByText('read_file')).toBeNull()
  })

  it('filters canonical debug events through the debug event type menu', async () => {
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

    render(
      <SessionRuntimePanel
        runtime={buildRuntimeState({
          messages: [],
          tools: [],
          sessionEvents: [
            buildPersistedEvent({
              id: 'debug_message',
              sequence: 1,
              type: 'message.completed',
              payload: { type: 'message.completed', marker: 'payload_message' },
              createdAt: '2026-05-23T00:00:00.000Z',
            }),
            buildPersistedEvent({
              id: 'debug_error',
              sequence: 2,
              type: 'runtime.error',
              payload: { type: 'runtime.error', marker: 'payload_error' },
              createdAt: '2026-05-23T00:00:01.000Z',
            }),
          ],
        })}
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

    const filter = screen.getByRole('combobox', { name: 'Filter debug events' })
    filter.focus()
    fireEvent.pointerDown(filter, { button: 0, ctrlKey: false, pointerId: 1, pointerType: 'mouse' })
    fireEvent.mouseDown(filter)
    fireEvent.keyDown(filter, { key: 'ArrowDown' })
    fireEvent.click(await screen.findByRole('option', { name: 'runtime.error' }))

    expect(screen.getByText('debug_error')).toBeTruthy()
    expect(screen.queryByText('debug_message')).toBeNull()
    fireEvent.click(screen.getByText('debug_error').closest('button')!)
    expect(screen.getByText(/payload_error/)).toBeTruthy()
  })
})
