import { randomUUID } from 'node:crypto'
import {
  ENBOR_SESSION_EVENT_TYPES,
  type EnborSessionEventType,
  type Message,
  type MessageContentBlock,
  type MessageRole,
  type ToolCall,
  ToolCallSchema,
  type ToolResult,
  type UsageRecordedPayload,
} from '@enbor/runtime-contracts/session-events'
import type { EnborRuntimeEvent } from '../protocol'

const EVENT_TYPES = new Set<string>(ENBOR_SESSION_EVENT_TYPES)

export function assertEnborRuntimeEvent(event: EnborRuntimeEvent): EnborRuntimeEvent {
  if (!EVENT_TYPES.has(event.type)) {
    throw new Error(`Unsupported Enbor runtime event type: ${event.type}`)
  }
  if (!event.payload || typeof event.payload !== 'object' || Array.isArray(event.payload)) {
    throw new Error(`Enbor runtime event ${event.type} must include an object payload`)
  }
  return event
}

export function runtimeEvent(type: EnborSessionEventType, payload: Record<string, unknown> = {}): EnborRuntimeEvent {
  return assertEnborRuntimeEvent({ type, payload } as EnborRuntimeEvent)
}

export function textMessage(
  role: Extract<MessageRole, 'assistant' | 'user' | 'system'>,
  text: string,
  id = randomId('msg'),
) {
  return {
    id,
    role,
    content: [{ type: 'text', text }],
  }
}

export function messageEvent(
  message: Message,
  type: Extract<
    EnborSessionEventType,
    'message.started' | 'message.updated' | 'message.completed'
  > = 'message.completed',
) {
  return runtimeEvent(type, { message })
}

export function messageStarted(message: Message) {
  return messageEvent(message, 'message.started')
}

export function messageUpdated(message: Message) {
  return messageEvent(message, 'message.updated')
}

export function messageCompleted(message: Message) {
  return messageEvent(message, 'message.completed')
}

export function textBlock(text: string): MessageContentBlock {
  return { type: 'text', text }
}

export function reasoningBlock(text: string): MessageContentBlock {
  return { type: 'reasoning', text }
}

export function toolCallBlock(toolCall: ToolCall): MessageContentBlock {
  return { type: 'tool_call', toolCall: ToolCallSchema.parse(toolCall) }
}

export function toolResultBlock(toolCallId: string, result: ToolResult, failed = false): MessageContentBlock {
  return {
    type: 'tool_result',
    toolCallId,
    result,
    ...(failed
      ? {
          error: {
            message: toolResultText(result) || 'Tool execution failed',
            details: result.structuredContent ?? result.content,
          },
        }
      : {}),
  }
}

export function toolResultMessage(
  toolCallId: string,
  result: ToolResult,
  failed = false,
  id = randomId('msg'),
): Message {
  return {
    id,
    role: 'tool',
    parentToolCallId: toolCallId,
    content: [toolResultBlock(toolCallId, result, failed)],
  }
}

export function usageEvent(payload: UsageRecordedPayload) {
  return runtimeEvent('usage.recorded', payload)
}

export function turnEnd() {
  return runtimeEvent('turn.completed')
}

export function runtimeError(message: string, code?: string, details?: unknown) {
  return runtimeEvent('runtime.error', {
    message,
    ...(code ? { code } : {}),
    ...(details !== undefined ? { details } : {}),
  })
}

export function randomId(prefix: string) {
  return `${prefix}_${randomUUID()}`
}

function toolResultText(result: ToolResult) {
  return result.content
    .map((item) => {
      if (item.type === 'text') return item.text
      return ''
    })
    .join('')
}
