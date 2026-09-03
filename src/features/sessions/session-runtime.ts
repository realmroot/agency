import type { SessionSocketClientMessage } from '@enbor/runtime-contracts/session-socket'
import type { EnborSessionEventType } from '@shared/session-events'
import type { SessionEvent } from '@/lib/enborrpc'
import { getAuthHeaders } from '@/lib/oidc'

export type SessionRuntimeConnectionState = 'connecting' | 'open' | 'closed' | 'error'
export type SessionRuntimeRunState = 'idle' | 'running' | 'error'

export type SessionRuntimeCommand = Extract<SessionSocketClientMessage, { type: 'prompt' | 'steer' | 'abort' }>
export type SessionSocketClientMessageType = SessionRuntimeCommand['type']

export interface SessionRuntimeMessage {
  id: string
  sourceEventId?: string
  role: 'user' | 'assistant' | 'system'
  content: string
  status: 'streaming' | 'complete' | 'error'
  createdAt: string
}

export interface SessionRuntimeToolTrace {
  id: string
  callId: string
  name: string
  status: 'running' | 'success' | 'error'
  input: unknown
  output: unknown
  error: string | null
  durationMs: number | null
  createdAt: string
  updatedAt: string
  eventType: string
}

export interface SessionRuntimeState {
  connection: SessionRuntimeConnectionState
  runState: SessionRuntimeRunState
  messages: SessionRuntimeMessage[]
  tools: SessionRuntimeToolTrace[]
  sessionEvents: SessionEvent[]
  eventKeys: string[]
  error: string | null
}

export type SessionRuntimeAction =
  | { type: 'reset' }
  | { type: 'connection'; state: SessionRuntimeConnectionState; error?: string | null }
  | { type: 'command_sent'; command: SessionRuntimeCommand; at: string }
  | { type: 'event'; item: SessionEvent; at?: string }
  | { type: 'session_events'; events: SessionEvent[] }

export const initialSessionRuntimeState: SessionRuntimeState = {
  connection: 'connecting',
  runState: 'idle',
  messages: [],
  tools: [],
  sessionEvents: [],
  eventKeys: [],
  error: null,
}

export function sessionRuntimeReducer(state: SessionRuntimeState, action: SessionRuntimeAction): SessionRuntimeState {
  if (action.type === 'reset') {
    return initialSessionRuntimeState
  }
  if (action.type === 'connection') {
    return {
      ...state,
      connection: action.state,
      error: action.error ?? (action.state === 'error' ? state.error : null),
    }
  }
  if (action.type === 'session_events') {
    return mergePersistedEvents(state, action.events)
  }
  if (action.type === 'event') {
    return mergePersistedEvents(state, [action.item])
  }
  if (action.type === 'command_sent') {
    if (action.command.type === 'abort' || !action.command.content) {
      return state
    }
    return {
      ...state,
      runState: 'running',
      messages: upsertMessage(state.messages, {
        id: action.command.requestId ?? crypto.randomUUID(),
        role: 'user',
        content: action.command.content,
        status: 'complete',
        createdAt: action.at,
      }),
    }
  }
  return state
}

export async function sessionSocketConnection(socketPath: string) {
  const url = new URL(socketPath, window.location.href)
  const ticketResponse = await fetch(`${url.pathname.replace(/\/socket$/, '/socket-tickets')}`, {
    method: 'POST',
    headers: await getAuthHeaders(),
  })
  if (!ticketResponse.ok) throw new Error(`Session socket ticket request failed with HTTP ${ticketResponse.status}`)
  const { ticket } = (await ticketResponse.json()) as { ticket?: string }
  if (!ticket || !/^[A-Za-z0-9_-]{43}$/.test(ticket)) throw new Error('Session socket ticket response is invalid')
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
  return {
    url: url.toString(),
    protocols: ['enbor-ticket', `enbor-ticket.${ticket}`],
  }
}

function mergePersistedEvents(state: SessionRuntimeState, events: SessionEvent[]) {
  const runtimeEvents = uniquePersistedRuntimeEvents(events, runtimeEventContext(state.sessionEvents)).filter(
    ({ key }) => {
      return !key || !state.eventKeys.includes(key)
    },
  )
  const messages = dedupeRuntimeMessages(
    runtimeEvents
      .map(({ stored, payload }) => {
        const type = sessionEventType(stored, payload)
        if (type === 'message.started') {
          return messageFromStoredSessionEvent(stored, payload, 'streaming')
        }
        if (type === 'message.updated') {
          const message = objectValue(payload.message)
          if (!stringField(message, 'id') && !scalarField(message, 'timestamp') && !scalarField(payload, 'timestamp')) {
            return null
          }
          return messageFromStoredSessionEvent(stored, payload, 'streaming')
        }
        if (type === 'message.completed') {
          return messageFromStoredSessionEvent(stored, payload, 'complete')
        }
        if (type === 'turn.completed') {
          return messageFromStoredSessionEvent(stored, payload, 'complete')
        }
        if (type === 'runtime.error') {
          return messageFromRuntimeError(payload, stored.createdAt, stored.id)
        }
        return null
      })
      .filter((message): message is SessionRuntimeMessage => Boolean(message))
      .sort((left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt)),
  )
  const tools = runtimeEvents
    .flatMap(({ stored, payload }) =>
      toolsFromMessageEvent(payload, stored.createdAt, sessionEventType(stored, payload)),
    )
    .filter((tool): tool is SessionRuntimeToolTrace => Boolean(tool))
    .reduce<SessionRuntimeToolTrace[]>((next, tool) => upsertTool(next, tool), [])
  const eventKeys = runtimeEvents.map(({ key }) => key).filter((key): key is string => Boolean(key))
  const hasTerminalEvent = runtimeEvents.some(({ stored, payload }) => {
    const type = sessionEventType(stored, payload)
    return type === 'runtime.completed' || type === 'turn.completed'
  })
  const hasErrorEvent = runtimeEvents.some(({ stored }) => {
    return stored.type === 'runtime.error'
  })
  const latestError = [...runtimeEvents].reverse().find(({ stored }) => stored.type === 'runtime.error')
  return {
    ...state,
    runState: hasErrorEvent ? 'error' : hasTerminalEvent ? 'idle' : state.runState,
    error: latestError ? runtimeErrorMessage(latestError.payload) : state.error,
    messages: messages.reduce((next, message) => upsertMessage(next, message), state.messages),
    tools: state.tools.length === 0 ? tools : tools.reduce((next, tool) => upsertTool(next, tool), state.tools),
    sessionEvents: mergeSessionEvents(
      state.sessionEvents,
      runtimeEvents.map(({ stored }) => stored),
    ),
    eventKeys: mergeEventKeys(eventKeys, state.eventKeys),
  }
}

type StoredRuntimeEvent = {
  stored: SessionEvent
  payload: Record<string, unknown>
  key: string | null
}

type RuntimeEventContext = {
  turnIndex: number
  turnKey: string | null
}

function uniquePersistedRuntimeEvents(
  events: SessionEvent[],
  initialContext: RuntimeEventContext = { turnIndex: 0, turnKey: null },
): StoredRuntimeEvent[] {
  const seen = new Set<string>()
  let turnKey = initialContext.turnKey
  let turnIndex = initialContext.turnIndex
  const uniqueEvents: StoredRuntimeEvent[] = []
  events
    .sort((left, right) => left.sequence - right.sequence)
    .forEach((stored) => {
      const payload = objectValue(stored.payload)
      const type = sessionEventType(stored, payload)
      if (type === 'turn.started' || isUserMessage(payload, type)) {
        turnIndex += 1
        turnKey = `turn:${turnIndex}`
      }
      const nextTurnKey = isUserMessage(payload, type) ? runtimeTurnKey(payload, type) : null
      if (nextTurnKey) {
        turnKey = nextTurnKey
      }
      const key = runtimeEventKey(payload, type, turnKey)
      if (key && seen.has(key)) {
        return
      }
      if (key) {
        seen.add(key)
      }
      uniqueEvents.push({ stored, payload, key })
    })
  return uniqueEvents
}

function runtimeEventContext(events: SessionEvent[]): RuntimeEventContext {
  return events
    .slice()
    .sort((left, right) => left.sequence - right.sequence)
    .reduce<RuntimeEventContext>(
      (context, stored) => {
        const payload = objectValue(stored.payload)
        const type = sessionEventType(stored, payload)
        if (type === 'turn.started' || isUserMessage(payload, type)) {
          context.turnIndex += 1
          context.turnKey = `turn:${context.turnIndex}`
        }
        const nextTurnKey = isUserMessage(payload, type) ? runtimeTurnKey(payload, type) : null
        if (nextTurnKey) {
          context.turnKey = nextTurnKey
        }
        return context
      },
      { turnIndex: 0, turnKey: null },
    )
}

function isUserMessage(event: Record<string, unknown>, eventType: string) {
  if (!isTranscriptEvent(eventType)) {
    return false
  }
  return stringField(objectValue(event.message), 'role') === 'user'
}

function sessionEventType(stored: SessionEvent, _payload: Record<string, unknown>): EnborSessionEventType {
  return stored.type
}

function runtimeTurnKey(event: Record<string, unknown>, eventType: string) {
  if (!isTranscriptEvent(eventType)) {
    return null
  }
  const message = objectValue(event.message)
  const timestamp = scalarField(message, 'timestamp') ?? stringField(message, 'id')
  if (!timestamp) {
    return null
  }
  return `${stringField(message, 'role') ?? ''}:${timestamp}`
}

function messageFromSessionEvent(event: Record<string, unknown>, at: string, status: SessionRuntimeMessage['status']) {
  const message = objectValue(event.message)
  if (Object.keys(message).length === 0) {
    return null
  }
  const rawRole = stringField(message, 'role') ?? 'assistant'
  if (rawRole === 'tool') {
    return null
  }
  const role: SessionRuntimeMessage['role'] =
    rawRole === 'user' || rawRole === 'assistant' || rawRole === 'system' ? rawRole : 'assistant'
  const content = renderMessageContent(message.content)
  if (!content) {
    return null
  }
  return {
    id: messageRenderId(message, role, at),
    role,
    content,
    status,
    createdAt: at,
  }
}

function messageRenderId(message: Record<string, unknown>, role: SessionRuntimeMessage['role'], at: string) {
  const id = stringField(message, 'id')
  const timestamp = scalarField(message, 'timestamp')
  if (id && timestamp) {
    return `${id}:${timestamp}`
  }
  return id ?? timestamp ?? `${role}_${at}`
}

function messageFromStoredSessionEvent(
  stored: SessionEvent,
  event: Record<string, unknown>,
  status: SessionRuntimeMessage['status'],
) {
  const message = messageFromSessionEvent(event, stored.createdAt, status)
  return message ? { ...message, sourceEventId: stored.id } : null
}

function messageFromRuntimeError(
  event: Record<string, unknown>,
  at: string,
  fallbackId: string,
): SessionRuntimeMessage {
  const eventId = stringField(event, 'id')
  return {
    id: eventId ? `${eventId}_error` : fallbackId,
    role: 'assistant',
    content: runtimeErrorMessage(event),
    status: 'error',
    createdAt: at,
  }
}

function toolsFromMessageEvent(
  event: Record<string, unknown>,
  at: string,
  eventType: string,
): SessionRuntimeToolTrace[] {
  if (!isTranscriptEvent(eventType)) return []
  const message = objectValue(event.message)
  const content = Array.isArray(message.content) ? message.content : []
  return content
    .map((item): SessionRuntimeToolTrace | null => {
      const block = objectValue(item)
      if (block.type === 'tool_call') {
        const toolCall = objectValue(block.toolCall)
        const callId = stringField(toolCall, 'id')
        if (!callId) return null
        return {
          id: callId,
          callId,
          name: stringField(toolCall, 'name') ?? 'tool',
          status: 'running',
          input: toolCall.input,
          output: undefined,
          error: null,
          durationMs: null,
          createdAt: at,
          updatedAt: at,
          eventType: 'tool_call',
        }
      }
      if (block.type === 'tool_result') {
        const callId = stringField(block, 'toolCallId')
        if (!callId) return null
        const failed = Boolean(block.error)
        return {
          id: callId,
          callId,
          name: 'tool',
          status: failed ? 'error' : 'success',
          input: undefined,
          output: readableToolValue(block.result),
          error: failed ? readableContent(block.error) : null,
          durationMs: null,
          createdAt: at,
          updatedAt: at,
          eventType: 'tool_result',
        }
      }
      return null
    })
    .filter((tool): tool is SessionRuntimeToolTrace => Boolean(tool))
}

function upsertMessage(messages: SessionRuntimeMessage[], message: SessionRuntimeMessage) {
  const index = messages.findIndex((item) => item.id === message.id || sameRuntimeMessage(item, message))
  if (index === -1) {
    return [...messages, message]
  }
  const next = [...messages]
  const existing = next[index]
  if (!existing) {
    return [...messages, message]
  }
  next[index] = {
    ...existing,
    ...message,
    content: message.status === 'streaming' ? `${existing.content}${message.content}` : message.content,
  }
  return next
}

function sameRuntimeMessage(left: SessionRuntimeMessage, right: SessionRuntimeMessage) {
  return (
    left.role === right.role &&
    Math.abs(Date.parse(left.createdAt) - Date.parse(right.createdAt)) < 5000 &&
    normalizeMessageContent(left.content) === normalizeMessageContent(right.content)
  )
}

function dedupeRuntimeMessages(messages: SessionRuntimeMessage[]) {
  return messages.reduce<SessionRuntimeMessage[]>((next, message) => upsertMessage(next, message), [])
}

function normalizeMessageContent(value: string) {
  return value.trim().replace(/\s+/g, ' ')
}

function upsertTool(tools: SessionRuntimeToolTrace[], tool: SessionRuntimeToolTrace) {
  const runningIndex = findLastToolIndex(tools, (item) => item.callId === tool.callId && item.status === 'running')
  const index =
    tool.eventType === 'tool_call'
      ? runningIndex
      : runningIndex !== -1
        ? runningIndex
        : findLastToolIndex(tools, (item) => item.callId === tool.callId)
  if (index === -1) {
    return [...tools, { ...tool, id: `${tool.callId}:${tool.createdAt}` }]
  }
  const next = [...tools]
  const existing = next[index]
  if (!existing) {
    return [...tools, tool]
  }
  next[index] = {
    ...existing,
    ...tool,
    name: tool.name === 'tool' ? existing.name : tool.name,
    input: tool.input ?? existing.input,
    output: hasToolValue(tool.output) ? tool.output : existing.output,
    error: tool.error ?? existing.error,
    durationMs:
      tool.durationMs ??
      existing.durationMs ??
      (tool.eventType === 'tool_result' ? elapsedMs(existing.createdAt, tool.updatedAt) : null),
    createdAt: existing.createdAt,
  }
  return next
}

function elapsedMs(start: string, end: string) {
  const elapsed = Date.parse(end) - Date.parse(start)
  return Number.isFinite(elapsed) ? Math.max(0, elapsed) : null
}

function findLastToolIndex(tools: SessionRuntimeToolTrace[], predicate: (tool: SessionRuntimeToolTrace) => boolean) {
  for (let index = tools.length - 1; index >= 0; index -= 1) {
    const tool = tools[index]
    if (tool && predicate(tool)) {
      return index
    }
  }
  return -1
}

function runtimeEventKey(event: Record<string, unknown>, eventType: string, turnKey?: string | null) {
  const message = objectValue(event.message)
  const timestamp = scalarField(message, 'timestamp') ?? stringField(message, 'id')
  const toolKey = toolContentEventKey(message, eventType, turnKey)
  if (toolKey) {
    return toolKey
  }
  if (eventType === 'message.updated') {
    if (!timestamp) {
      return null
    }
    return `${eventType}:${timestamp ?? ''}:${stableStringify(message.content)}`
  }
  if (
    eventType === 'message.started' ||
    eventType === 'message.completed' ||
    eventType === 'runtime.started' ||
    eventType === 'runtime.completed' ||
    eventType === 'turn.started' ||
    eventType === 'turn.completed'
  ) {
    if (!timestamp) {
      return null
    }
    return `${eventType}:${stringField(message, 'role') ?? ''}:${timestamp}:${stableStringify(message.content)}`
  }
  return `${eventType}:${stableStringify(event)}`
}

function toolContentEventKey(message: Record<string, unknown>, eventType: string, turnKey?: string | null) {
  if (!isTranscriptEvent(eventType) || !Array.isArray(message.content)) return null
  const toolParts = message.content
    .map((item) => {
      const block = objectValue(item)
      if (block.type === 'tool_call') {
        const toolCall = objectValue(block.toolCall)
        const id = stringField(toolCall, 'id')
        return id ? `tool_call:${id}` : null
      }
      if (block.type === 'tool_result') {
        const id = stringField(block, 'toolCallId')
        return id ? `tool_result:${id}` : null
      }
      return null
    })
    .filter((value): value is string => Boolean(value))
  return toolParts.length > 0 ? `${eventType}:${turnKey ? `${turnKey}:` : ''}${toolParts.join('|')}` : null
}

function isTranscriptEvent(eventType: string) {
  return eventType === 'message.started' || eventType === 'message.updated' || eventType === 'message.completed'
}

function mergeEventKeys(left: string[], right: string[]) {
  return [...new Set([...left, ...right])].slice(-800)
}

function mergeSessionEvents(existing: SessionEvent[], incoming: SessionEvent[]) {
  const byId = new Map(existing.map((record) => [record.id, record]))
  for (const record of incoming) {
    byId.set(record.id, record)
  }
  return [...byId.values()].sort(
    (left, right) => left.sequence - right.sequence || Date.parse(left.createdAt) - Date.parse(right.createdAt),
  )
}

function stableStringify(value: unknown): string {
  if (value === undefined) {
    return ''
  }
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`
  }
  const record = value as Record<string, unknown>
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
    .join(',')}}`
}

function runtimeErrorMessage(event: Record<string, unknown>) {
  return readableContent(event.message ?? 'Runtime error')
}

function renderMessageContent(value: unknown): string {
  if (typeof value === 'string') {
    return value
  }
  if (Array.isArray(value)) {
    return value.map(messageContentBlockText).filter(Boolean).join('\n')
  }
  return ''
}

function messageContentBlockText(value: unknown): string {
  const record = objectValue(value)
  if ((record.type === 'text' || record.type === 'reasoning') && typeof record.text === 'string') {
    return record.text
  }
  if (record.type === 'json') {
    return JSON.stringify(record.value) ?? ''
  }
  if (record.type === 'image') {
    return [record.url, record.mediaType].filter((item) => typeof item === 'string' && item).join(' ')
  }
  if (record.type === 'file') {
    return [record.path, record.name, record.mediaType].filter((item) => typeof item === 'string' && item).join(' ')
  }
  return ''
}

function readableContent(value: unknown): string {
  if (typeof value === 'string') {
    return value
  }
  if (value === null || value === undefined) {
    return ''
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value)
  }
  const record = objectValue(value)
  if (typeof record.message === 'string') {
    return record.message
  }
  return JSON.stringify(value) ?? ''
}

function readableToolValue(value: unknown) {
  if (!value || typeof value !== 'object') {
    return value
  }
  const record = value as Record<string, unknown>
  if (Array.isArray(record.content)) {
    const text = record.content
      .map((item) => {
        if (!item || typeof item !== 'object') {
          return ''
        }
        const contentItem = item as Record<string, unknown>
        return contentItem.type === 'text' && typeof contentItem.text === 'string' ? contentItem.text : ''
      })
      .join('')
    return text || value
  }
  return value
}

function hasToolValue(value: unknown) {
  if (value === undefined || value === null || value === '') {
    return false
  }
  if (Array.isArray(value)) {
    return value.length > 0
  }
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>
    if (Array.isArray(record.content)) {
      return (
        record.content.some((item) => Boolean(messageContentBlockText(item))) ||
        record.structuredContent !== undefined ||
        record.exitCode !== undefined
      )
    }
    return Object.keys(value).length > 0
  }
  return true
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

function stringField(record: Record<string, unknown>, field: string) {
  return typeof record[field] === 'string' ? record[field] : null
}

function scalarField(record: Record<string, unknown>, field: string) {
  const value = record[field]
  return typeof value === 'string' || typeof value === 'number' ? String(value) : null
}
