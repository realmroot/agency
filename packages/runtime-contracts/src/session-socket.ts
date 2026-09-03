import { type EnborSessionEventType, isEnborSessionEventType, type SessionEvent } from './session-events'

export type SessionSocketPromptMessage = {
  type: 'prompt'
  requestId?: string
  content: string
}

export type SessionSocketAbortMessage = {
  type: 'abort'
  requestId?: string
  reason?: string
}

export type SessionSocketSteerMessage = {
  type: 'steer'
  requestId?: string
  content: string
}

export type SessionSocketBackfillRequestMessage = {
  type: 'backfill'
  requestId?: string
  cursor?: number
  limit?: number
  eventType?: EnborSessionEventType
}

export type SessionSocketClientMessage =
  | SessionSocketPromptMessage
  | SessionSocketAbortMessage
  | SessionSocketSteerMessage
  | SessionSocketBackfillRequestMessage

export type SessionSocketEventMessage = {
  type: 'event'
  record: SessionEvent
}

export type SessionSocketBackfillMessage = {
  type: 'backfill'
  requestId: string
  events: SessionEvent[]
  nextCursor: number | null
  hasMore: boolean
}

export type SessionSocketAckMessage = {
  type: 'ack'
  requestId: string
}

export type SessionSocketErrorMessage = {
  type: 'error'
  requestId?: string
  message: string
}

export type SessionSocketRunnerUnavailableMessage = {
  type: 'runner_unavailable'
  message: string
}

export type SessionSocketServerMessage =
  | SessionSocketEventMessage
  | SessionSocketBackfillMessage
  | SessionSocketAckMessage
  | SessionSocketErrorMessage
  | SessionSocketRunnerUnavailableMessage

export function sessionSocketClientMessageFrom(value: unknown): SessionSocketClientMessage | null {
  const message = objectValue(value)
  if (typeof message.type !== 'string') {
    return null
  }
  if ('id' in message) {
    return null
  }
  if (message.type === 'prompt' || message.type === 'steer') {
    return typeof message.content === 'string'
      ? {
          type: message.type,
          ...requestIdFields(message),
          content: message.content,
        }
      : null
  }
  if (message.type === 'abort') {
    return {
      type: 'abort',
      ...requestIdFields(message),
      ...(typeof message.reason === 'string' ? { reason: message.reason } : {}),
    }
  }
  if (message.type === 'backfill') {
    if (
      message.eventType !== undefined &&
      (typeof message.eventType !== 'string' || !isEnborSessionEventType(message.eventType))
    ) {
      return null
    }
    const cursor = message.cursor
    if (cursor !== undefined && (typeof cursor !== 'number' || !Number.isInteger(cursor) || cursor < 0)) {
      return null
    }
    const limit = message.limit
    if (limit !== undefined && (typeof limit !== 'number' || !Number.isInteger(limit) || limit < 1)) {
      return null
    }
    return {
      type: 'backfill',
      ...requestIdFields(message),
      ...(typeof cursor === 'number' ? { cursor } : {}),
      ...(typeof limit === 'number' ? { limit } : {}),
      ...(typeof message.eventType === 'string' ? { eventType: message.eventType } : {}),
    }
  }
  return null
}

export function sessionSocketServerMessageFrom(value: unknown): SessionSocketServerMessage | null {
  const message = objectValue(value)
  if (message.type === 'backfill') {
    return Array.isArray(message.events)
      ? typeof message.requestId === 'string'
        ? {
            type: 'backfill',
            requestId: message.requestId,
            events: message.events.filter(isSessionEvent),
            nextCursor: typeof message.nextCursor === 'number' ? message.nextCursor : null,
            hasMore: message.hasMore === true,
          }
        : null
      : null
  }
  if (message.type === 'event') {
    return isSessionEvent(message.record) ? { type: 'event', record: message.record } : null
  }
  if (message.type === 'ack') {
    return typeof message.requestId === 'string' ? { type: 'ack', requestId: message.requestId } : null
  }
  if (message.type === 'error') {
    return typeof message.message === 'string'
      ? {
          type: 'error',
          ...(typeof message.requestId === 'string' ? { requestId: message.requestId } : {}),
          message: message.message,
        }
      : null
  }
  if (message.type === 'runner_unavailable') {
    return typeof message.message === 'string' ? { type: 'runner_unavailable', message: message.message } : null
  }
  return null
}

function isSessionEvent(value: unknown): value is SessionEvent {
  const record = objectValue(value)
  return (
    typeof record.id === 'string' &&
    typeof record.sessionId === 'string' &&
    typeof record.sequence === 'number' &&
    typeof record.createdAt === 'string' &&
    typeof record.type === 'string' &&
    isEnborSessionEventType(record.type) &&
    isObject(record.payload)
  )
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

function requestIdFields(message: Record<string, unknown>): { requestId?: string } {
  if (typeof message.requestId === 'string') {
    return { requestId: message.requestId }
  }
  return {}
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}
