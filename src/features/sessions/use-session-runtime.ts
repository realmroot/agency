import {
  type SessionSocketServerMessage,
  sessionSocketServerMessageFrom,
} from '@enbor/runtime-contracts/session-socket'
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import type { Session, SessionEvent } from '@/lib/enborrpc'
import {
  initialSessionRuntimeState,
  type SessionRuntimeCommand,
  type SessionSocketClientMessageType,
  sessionRuntimeReducer,
  sessionSocketConnection,
} from './session-runtime'

export function useSessionRuntimeSession({
  session,
  onEventsChanged,
}: {
  session: Session | null
  onEventsChanged: () => void
}) {
  const [state, dispatch] = useReducer(sessionRuntimeReducer, initialSessionRuntimeState)
  const [connectionAttempt, setConnectionAttempt] = useState(0)
  const socketRef = useRef<WebSocket | null>(null)
  const refreshTimerRef = useRef<number | null>(null)
  const reconnectTimerRef = useRef<number | null>(null)
  const sessionIdRef = useRef<string | null>(null)
  const sessionId = session?.metadata.uid ?? ''
  const endpoint = useMemo(() => (sessionId ? `/api/v1/sessions/${sessionId}/socket` : null), [sessionId])

  useEffect(() => {
    if (sessionIdRef.current !== (session?.metadata.uid ?? null)) {
      sessionIdRef.current = session?.metadata.uid ?? null
      dispatch({ type: 'reset' })
    }
  }, [session])

  useEffect(() => {
    void connectionAttempt
    if (!endpoint) {
      dispatch({ type: 'connection', state: 'closed' })
      return
    }
    let disposed = false
    let activeSocket: WebSocket | null = null
    window.clearTimeout(reconnectTimerRef.current ?? undefined)
    dispatch({ type: 'connection', state: 'connecting' })
    void sessionSocketConnection(endpoint)
      .then(({ url, protocols }) => {
        if (disposed) return
        const socket = new WebSocket(url, protocols)
        activeSocket = socket
        socketRef.current = socket
        socket.addEventListener('open', () => {
          if (socketRef.current !== socket) return
          dispatch({ type: 'connection', state: 'open' })
        })
        socket.addEventListener('message', (message) => {
          if (socketRef.current !== socket) return
          const socketMessage = parseSessionSocketServerMessage(message.data)
          if (socketMessage instanceof Error) {
            dispatch({ type: 'connection', state: 'error', error: socketMessage.message })
            return
          }
          if (socketMessage.type === 'ack') return
          if (socketMessage.type === 'error' || socketMessage.type === 'runner_unavailable') {
            dispatch({ type: 'connection', state: 'error', error: socketMessage.message })
            return
          }
          if (socketMessage.type === 'backfill') {
            dispatch({ type: 'session_events', events: socketMessage.events as SessionEvent[] })
            if (socketMessage.hasMore && typeof socketMessage.nextCursor === 'number') {
              socket.send(
                JSON.stringify({
                  type: 'backfill',
                  requestId: crypto.randomUUID(),
                  cursor: socketMessage.nextCursor,
                  limit: 200,
                }),
              )
            }
          } else {
            dispatch({ type: 'session_events', events: [socketMessage.record as SessionEvent] })
          }
          if (shouldRefreshAfterMessage(socketMessage)) {
            window.clearTimeout(refreshTimerRef.current ?? undefined)
            refreshTimerRef.current = window.setTimeout(onEventsChanged, 150)
          }
        })
        socket.addEventListener('error', () => {
          if (socketRef.current !== socket) return
          dispatch({ type: 'connection', state: 'error', error: 'Session socket failed' })
        })
        socket.addEventListener('close', () => {
          if (socketRef.current !== socket) return
          socketRef.current = null
          dispatch({ type: 'connection', state: 'connecting' })
          reconnectTimerRef.current = window.setTimeout(() => {
            setConnectionAttempt((attempt) => attempt + 1)
          }, 750)
        })
      })
      .catch((error: unknown) => {
        if (disposed) return
        dispatch({
          type: 'connection',
          state: 'error',
          error: error instanceof Error ? error.message : 'Session credentials are unavailable',
        })
      })

    return () => {
      disposed = true
      window.clearTimeout(refreshTimerRef.current ?? undefined)
      window.clearTimeout(reconnectTimerRef.current ?? undefined)
      if (socketRef.current === activeSocket) {
        socketRef.current = null
      }
      activeSocket?.close()
    }
  }, [endpoint, onEventsChanged, connectionAttempt])

  const sendCommand = useCallback((type: SessionSocketClientMessageType, content?: string) => {
    const socket = socketRef.current
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      dispatch({ type: 'connection', state: 'error', error: 'Session socket is not open' })
      return false
    }
    const nextCommand = clientMessage(type, content)
    dispatch({ type: 'command_sent', command: nextCommand, at: new Date().toISOString() })
    socket.send(JSON.stringify(nextCommand))
    return true
  }, [])
  const reconnect = useCallback(() => {
    window.clearTimeout(reconnectTimerRef.current ?? undefined)
    const socket = socketRef.current
    socketRef.current = null
    socket?.close()
    if (!endpoint) {
      dispatch({ type: 'connection', state: 'closed' })
      return
    }
    dispatch({ type: 'connection', state: 'connecting' })
    setConnectionAttempt((attempt) => attempt + 1)
  }, [endpoint])

  return {
    endpoint,
    state,
    reconnect,
    sendPrompt: (message: string) => sendCommand('prompt', message),
    sendSteer: (message: string) => sendCommand('steer', message),
    abort: () => sendCommand('abort'),
  }
}

function clientMessage(type: SessionSocketClientMessageType, content?: string): SessionRuntimeCommand {
  const requestId = crypto.randomUUID()
  if (type === 'abort') {
    return { type, requestId }
  }
  return { type, requestId, content: content ?? '' }
}

function parseSessionSocketServerMessage(data: unknown): SessionSocketServerMessage | Error {
  if (typeof data !== 'string') {
    return new Error('Session socket emitted non-text data')
  }
  try {
    const parsed = JSON.parse(data) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return new Error('Session socket emitted a non-object JSON message')
    }
    return sessionSocketServerMessageFrom(parsed) ?? new Error('Session socket emitted an unsupported message')
  } catch (error) {
    /* v8 ignore start -- JSON.parse always throws SyntaxError (an Error); the non-Error branch is unreachable */
    return error instanceof Error ? error : new Error('Session socket emitted invalid JSON')
    /* v8 ignore stop */
  }
}

function shouldRefreshAfterMessage(message: SessionSocketServerMessage) {
  if (message.type !== 'event') {
    return false
  }
  const eventType = message.record.type
  return (
    eventType === 'runtime.completed' ||
    eventType === 'turn.completed' ||
    hasToolResult(message.record.payload) ||
    eventType === 'runtime.error'
  )
}

function hasToolResult(payload: unknown) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return false
  const message = (payload as { message?: unknown }).message
  if (!message || typeof message !== 'object' || Array.isArray(message)) return false
  const content = (message as { content?: unknown }).content
  return (
    Array.isArray(content) &&
    content.some((item) => item && typeof item === 'object' && (item as { type?: unknown }).type === 'tool_result')
  )
}
