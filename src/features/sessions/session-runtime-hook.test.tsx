/**
 * Tests for useSessionRuntimeSession hook.
 *
 * Uses a MockWebSocket to exercise the live session socket path.
 * No vi.spyOn/vi.mock of @/lib/amarpc.
 *
 * ROOT CAUSE OF OOM: The hook's socket effect depends on props that can
 * change reference on every re-render, causing infinite loops:
 *
 *   1. useEffect([endpoint, onEventsChanged, connectionAttempt])
 *      If onEventsChanged is a new function on each render (e.g. vi.fn() inline),
 *      the effect runs → dispatch → new state → re-render → new fn → repeat.
 *
 * FIXES:
 *   - Pass onEventsChanged as a stable ref via useCallback([stableRef])
 *
 * MockWebSocket.close() is silent so useEffect cleanup doesn't start reconnect.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useCallback } from 'react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Session, SessionEvent } from '@/lib/amarpc'
import * as oidcModule from '@/lib/oidc'
import { buildTestSession, type TestSessionOverrides } from '@/testing/session'
import { useSessionRuntimeSession } from './use-session-runtime'

// ---------------------------------------------------------------------------
// MockWebSocket
// ---------------------------------------------------------------------------

let lastSocket: MockWebSocket | null = null

class MockWebSocket extends EventTarget {
  static CONNECTING = 0
  static OPEN = 1
  static CLOSING = 2
  static CLOSED = 3

  readyState: number
  readonly url: string
  readonly sent: string[] = []

  constructor(url: string) {
    super()
    this.url = url
    this.readyState = MockWebSocket.OPEN
    lastSocket = this
    // Defer 'open' so the hook's addEventListener is registered first.
    Promise.resolve().then(() => this.dispatchEvent(new Event('open')))
  }

  emit(payload: Record<string, unknown>) {
    this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(payload) }))
  }

  emitRaw(data: unknown) {
    this.dispatchEvent(new MessageEvent('message', { data }))
  }

  triggerError() {
    this.dispatchEvent(new Event('error'))
  }

  /** Only use when you unmount immediately after to cancel the reconnect timer. */
  triggerClose() {
    this.readyState = MockWebSocket.CLOSED
    this.dispatchEvent(new Event('close'))
  }

  /** Called by useEffect cleanup — silent to prevent reconnect. */
  close() {
    this.readyState = MockWebSocket.CLOSED
  }

  send(data: string) {
    this.sent.push(data)
  }
}

// ---------------------------------------------------------------------------
// Fixtures — module-level constants so arrays are never recreated
// ---------------------------------------------------------------------------

const now = '2026-05-23T00:00:00.000Z'

function buildSession(overrides: TestSessionOverrides = {}): Session {
  return buildTestSession({ name: 'Test session', ...overrides })
}

type SessionEventOverrides = Partial<Omit<SessionEvent, 'type' | 'payload'>> & {
  type?: SessionEvent['type']
  payload?: Record<string, unknown>
  metadata?: Record<string, unknown>
  event?: Pick<SessionEvent, 'type' | 'payload'>
}

function buildEvent(overrides: SessionEventOverrides = {}): SessionEvent {
  const {
    type = 'message.completed',
    payload = {
      type: 'message.completed',
      message: { role: 'assistant', content: [{ type: 'text', text: 'Hello' }] },
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
    createdAt: now,
    ...recordOverrides,
  }
}

// ---------------------------------------------------------------------------
// Test Harness
//
// CRITICAL: events must be a stable reference (hoisted constant, never inline []).
// CRITICAL: onEventsChanged must be stable via useCallback with a stable ref.
// ---------------------------------------------------------------------------

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
}

function RuntimeHarness({
  session,
  onEventsChangedRef,
}: {
  session: Session | null
  onEventsChangedRef: React.MutableRefObject<() => void>
}) {
  const onEventsChanged = useCallback(() => onEventsChangedRef.current(), [onEventsChangedRef])

  const { state, reconnect, sendPrompt, sendSteer, abort } = useSessionRuntimeSession({
    session,
    onEventsChanged,
  })
  return (
    <div>
      <span data-testid="connection">{state.connection}</span>
      <span data-testid="runState">{state.runState}</span>
      <span data-testid="error">{state.error ?? 'none'}</span>
      <span data-testid="messageCount">{state.messages.length}</span>
      <button type="button" onClick={() => sendPrompt('Test prompt')}>
        Send Prompt
      </button>
      <button type="button" onClick={() => sendSteer('steer message')}>
        Steer
      </button>
      <button type="button" onClick={() => abort()}>
        Abort
      </button>
      <button type="button" onClick={() => reconnect()}>
        Reconnect
      </button>
    </div>
  )
}

function makeCallbackRef(fn: () => void = () => {}): React.MutableRefObject<() => void> {
  return { current: fn }
}

async function renderLive(sessionState: Session['status']['phase'] = 'idle', cbRef = makeCallbackRef()) {
  const queryClient = makeQueryClient()
  const result = render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <RuntimeHarness session={buildSession({ phase: sessionState })} onEventsChangedRef={cbRef} />
      </MemoryRouter>
    </QueryClientProvider>,
  )
  await waitFor(() => expect(screen.getByTestId('connection').textContent).toBe('open'), { timeout: 5000 })
  return result
}

// ---------------------------------------------------------------------------
// Global setup / teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  lastSocket = null
  vi.spyOn(oidcModule, 'getStoredAccessToken').mockReturnValue(null)
  vi.stubGlobal('WebSocket', MockWebSocket)
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  lastSocket = null
})

// ---------------------------------------------------------------------------
// Tests — null / closed session
// ---------------------------------------------------------------------------

describe('useSessionRuntimeSession — null/closed session', () => {
  it('reports closed when session is null', async () => {
    const cbRef = makeCallbackRef()
    const queryClient = makeQueryClient()
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <RuntimeHarness session={null} onEventsChangedRef={cbRef} />
        </MemoryRouter>
      </QueryClientProvider>,
    )
    await waitFor(() => expect(screen.getByTestId('connection').textContent).toBe('closed'), { timeout: 5000 })
  })

  it('connects a closed session socket and dispatches backfilled message.completed events', async () => {
    const events: SessionEvent[] = [
      buildEvent(),
      buildEvent({ id: 'event_2', sequence: 2, type: 'turn.completed', payload: { type: 'turn.completed' } }),
    ]
    const cbRef = makeCallbackRef()
    const queryClient = makeQueryClient()
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <RuntimeHarness session={buildSession({ phase: 'closed' })} onEventsChangedRef={cbRef} />
        </MemoryRouter>
      </QueryClientProvider>,
    )
    await waitFor(() => expect(screen.getByTestId('connection').textContent).toBe('open'), { timeout: 5000 })
    lastSocket!.emit({ type: 'backfill', requestId: 'backfill-1', events, nextCursor: null, hasMore: false })
    await waitFor(() => expect(screen.getByTestId('messageCount').textContent).toBe('1'), { timeout: 5000 })
    expect(screen.getByTestId('runState').textContent).toBe('idle')
  })
})

// ---------------------------------------------------------------------------
// Tests — live session
// ---------------------------------------------------------------------------

describe('useSessionRuntimeSession — live session open', () => {
  it('connects WebSocket for idle session and reports open', async () => {
    await renderLive('idle')
    expect(screen.getByTestId('connection').textContent).toBe('open')
  })

  it('connects WebSocket for running session', async () => {
    await renderLive('running')
    expect(screen.getByTestId('connection').textContent).toBe('open')
  })

  it('dispatches browser socket live event frames into messages state', async () => {
    await renderLive()

    lastSocket!.emit({
      type: 'event',
      record: buildEvent({
        id: 'event_live',
        sequence: 2,
        payload: {
          type: 'message.completed',
          message: { role: 'assistant', content: [{ type: 'text', text: 'Live frame' }], id: 'msg_live' },
        },
      }),
    })

    await waitFor(() => expect(screen.getByTestId('messageCount').textContent).toBe('1'), { timeout: 5000 })
  })

  it('dispatches browser socket backfill frames into messages state', async () => {
    await renderLive()

    lastSocket!.emit({
      type: 'backfill',
      requestId: 'backfill-1',
      events: [
        buildEvent({
          id: 'event_backfill',
          sequence: 2,
          payload: {
            type: 'message.completed',
            message: { role: 'assistant', content: [{ type: 'text', text: 'Backfill' }], id: 'msg_backfill' },
          },
        }),
      ],
      nextCursor: null,
      hasMore: false,
    })

    await waitFor(() => expect(screen.getByTestId('messageCount').textContent).toBe('1'), { timeout: 5000 })
  })

  it('sets error state on WebSocket error event', async () => {
    await renderLive()

    lastSocket!.triggerError()

    await waitFor(() => expect(screen.getByTestId('connection').textContent).toBe('error'), { timeout: 5000 })
    expect(screen.getByTestId('error').textContent).toBe('Session socket failed')
  })

  it('sets error state for invalid JSON message', async () => {
    await renderLive()

    lastSocket!.emitRaw('{ bad json }')

    await waitFor(() => expect(screen.getByTestId('connection').textContent).toBe('error'), { timeout: 5000 })
  })

  it('sets error state for non-object JSON (plain string)', async () => {
    await renderLive()

    lastSocket!.emitRaw('"just a string"')

    await waitFor(() => expect(screen.getByTestId('connection').textContent).toBe('error'), { timeout: 5000 })
  })

  it('sets error for non-string WebSocket data', async () => {
    await renderLive()

    lastSocket!.emitRaw(42)

    await waitFor(() => expect(screen.getByTestId('connection').textContent).toBe('error'), { timeout: 5000 })
  })
})

describe('useSessionRuntimeSession — close event', () => {
  it('keeps reporting connecting during reconnectable socket close; unmount cancels reconnect timer', async () => {
    const { unmount } = await renderLive()

    lastSocket!.triggerClose()
    await waitFor(() => expect(screen.getByTestId('connection').textContent).toBe('connecting'), { timeout: 5000 })

    // Unmount so clearTimeout in useEffect cleanup cancels the 750ms reconnect.
    unmount()
    await new Promise((resolve) => setTimeout(resolve, 100))
  })

  it('reconnects on explicit reconnect request', async () => {
    await renderLive()
    const firstSocket = lastSocket

    fireEvent.click(screen.getByRole('button', { name: 'Reconnect' }))

    await waitFor(() => expect(lastSocket).not.toBe(firstSocket), { timeout: 5000 })
    expect(firstSocket?.readyState).toBe(MockWebSocket.CLOSED)
    await waitFor(() => expect(screen.getByTestId('connection').textContent).toBe('open'), { timeout: 5000 })
  })
})

describe('useSessionRuntimeSession — send commands', () => {
  it('sends prompt command', async () => {
    await renderLive()

    fireEvent.click(screen.getByRole('button', { name: 'Send Prompt' }))

    await waitFor(() => expect(lastSocket!.sent).toHaveLength(1), { timeout: 5000 })
    const cmd = JSON.parse(lastSocket!.sent[0] ?? '{}') as Record<string, unknown>
    expect(cmd.type).toBe('prompt')
    expect(cmd.content).toBe('Test prompt')
  })

  it('sends steer command', async () => {
    await renderLive()

    fireEvent.click(screen.getByRole('button', { name: 'Steer' }))

    await waitFor(() => expect(lastSocket!.sent).toHaveLength(1), { timeout: 5000 })
    const cmd = JSON.parse(lastSocket!.sent[0] ?? '{}') as Record<string, unknown>
    expect(cmd.type).toBe('steer')
  })

  it('sends abort command without message body', async () => {
    await renderLive()

    fireEvent.click(screen.getByRole('button', { name: 'Abort' }))

    await waitFor(() => expect(lastSocket!.sent).toHaveLength(1), { timeout: 5000 })
    const cmd = JSON.parse(lastSocket!.sent[0] ?? '{}') as Record<string, unknown>
    expect(cmd.type).toBe('abort')
    expect(cmd.content).toBeUndefined()
  })

  it('sets error when sendPrompt is called while socket is CONNECTING', async () => {
    vi.stubGlobal(
      'WebSocket',
      class extends MockWebSocket {
        constructor(url: string) {
          super(url)
          this.readyState = MockWebSocket.CONNECTING
          lastSocket = this
        }
      },
    )

    const cbRef = makeCallbackRef()
    const queryClient = makeQueryClient()
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <RuntimeHarness session={buildSession({ phase: 'idle' })} onEventsChangedRef={cbRef} />
        </MemoryRouter>
      </QueryClientProvider>,
    )
    await waitFor(() => expect(lastSocket).not.toBeNull(), { timeout: 5000 })
    await new Promise((resolve) => setTimeout(resolve, 50))

    fireEvent.click(screen.getByRole('button', { name: 'Send Prompt' }))

    await waitFor(() => expect(screen.getByTestId('connection').textContent).toBe('error'), { timeout: 5000 })
    expect(screen.getByTestId('error').textContent).toBe('Session socket is not open')
  })
})

describe('useSessionRuntimeSession — onEventsChanged callbacks', () => {
  it('calls onEventsChanged after turn.completed (150ms debounce)', async () => {
    const cb = vi.fn()
    await renderLive('idle', makeCallbackRef(cb))

    lastSocket!.emit({
      type: 'event',
      record: buildEvent({ type: 'turn.completed', payload: { type: 'turn.completed' } }),
    })

    await waitFor(() => expect(cb).toHaveBeenCalled(), { timeout: 5000 })
  })

  it('calls onEventsChanged after runtime.error', async () => {
    const cb = vi.fn()
    await renderLive('idle', makeCallbackRef(cb))

    lastSocket!.emit({
      type: 'event',
      record: buildEvent({ type: 'runtime.error', payload: { type: 'runtime.error', message: 'crashed' } }),
    })

    await waitFor(() => expect(cb).toHaveBeenCalled(), { timeout: 5000 })
  })

  it('calls onEventsChanged after a tool result message', async () => {
    const cb = vi.fn()
    await renderLive('idle', makeCallbackRef(cb))

    lastSocket!.emit({
      type: 'event',
      record: buildEvent({
        type: 'message.completed',
        payload: {
          message: {
            id: 'msg_tool_result',
            role: 'tool',
            parentToolCallId: 'tc_1',
            content: [{ type: 'tool_result', toolCallId: 'tc_1', result: { content: [] } }],
          },
        },
      }),
    })

    await waitFor(() => expect(cb).toHaveBeenCalled(), { timeout: 5000 })
  })

  it('calls onEventsChanged after runtime.completed', async () => {
    const cb = vi.fn()
    await renderLive('idle', makeCallbackRef(cb))

    lastSocket!.emit({
      type: 'event',
      record: buildEvent({ type: 'runtime.completed', payload: {} }),
    })

    await waitFor(() => expect(cb).toHaveBeenCalled(), { timeout: 5000 })
  })
})

describe('useSessionRuntimeSession — session change (reset)', () => {
  it('resets state when session id changes (line 42 — sessionIdRef update)', async () => {
    const cbRef = makeCallbackRef()
    const queryClient = makeQueryClient()

    // Render with session_1
    const session1 = buildSession({ id: 'session_1' })
    const { rerender } = render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <RuntimeHarness session={session1} onEventsChangedRef={cbRef} />
        </MemoryRouter>
      </QueryClientProvider>,
    )

    // Wait for stable state
    await new Promise((resolve) => setTimeout(resolve, 100))

    // Re-render with session_2 — this triggers the sessionIdRef !== check
    const session2 = buildSession({ id: 'session_2', phase: 'closed' })
    rerender(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <RuntimeHarness session={session2} onEventsChangedRef={cbRef} />
        </MemoryRouter>
      </QueryClientProvider>,
    )

    await new Promise((resolve) => setTimeout(resolve, 100))
    // After session change, state should be reset (runState back to 'idle', messages empty)
    expect(screen.getByTestId('messageCount').textContent).toBe('0')
  })
})
