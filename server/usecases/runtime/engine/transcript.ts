// Rebuilds the agent transcript from persisted (or in-memory) runtime events so
// a continuation turn resumes where the previous one left off. Host-agnostic and
// pure: both the Worker and the runner re-enter the engine from the same rebuilt
// context. Lives apart from the engine loop because it is a distinct concern with
// its own boundary (it parses persisted/queued JSON).
import type { AgentMessage } from '@earendil-works/pi-agent-core'
import type { ImageContent, TextContent } from '@earendil-works/pi-ai'
import type { Message, MessageContentBlock, ToolResultValueContentBlock } from '@shared/session-events'

const ZERO_USAGE = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
}

export function isPersistedMessage(value: unknown): value is AgentMessage {
  if (!value || typeof value !== 'object' || !('role' in value)) {
    return false
  }
  const role = (value as { role?: unknown }).role
  return role === 'user' || role === 'assistant' || role === 'toolResult'
}

function enborMessageFromValue(value: unknown): Message | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }
  const record = value as Partial<Message>
  if (
    (record.role !== 'user' && record.role !== 'assistant' && record.role !== 'tool') ||
    !Array.isArray(record.content)
  ) {
    return null
  }
  return record as Message
}

function textFromContent(blocks: MessageContentBlock[]) {
  return blocks
    .map((block) => {
      if (block.type === 'text' || block.type === 'reasoning') return block.text
      return ''
    })
    .join('')
}

function piTextContentBlocks(blocks: MessageContentBlock[]): TextContent[] {
  return blocks.flatMap((block): TextContent[] => {
    if (block.type === 'text') return [{ type: 'text' as const, text: block.text }]
    return []
  })
}

function piToolResultContentBlocks(blocks: ToolResultValueContentBlock[]): Array<TextContent | ImageContent> {
  return blocks.flatMap((block): Array<TextContent | ImageContent> => {
    if (block.type === 'text') return [{ type: 'text' as const, text: block.text }]
    if (block.type === 'image' && block.data && block.mediaType) {
      return [{ type: 'image' as const, data: block.data, mimeType: block.mediaType }]
    }
    return []
  })
}

function agentMessageFromEnborMessage(message: Message): AgentMessage | null {
  const timestamp = Date.now()
  if (message.role === 'user') {
    return { role: 'user', content: textFromContent(message.content), timestamp }
  }
  if (message.role === 'assistant') {
    return {
      role: 'assistant',
      content: piTextContentBlocks(message.content),
      api: 'ama',
      provider: 'ama',
      model: 'ama',
      usage: ZERO_USAGE,
      stopReason: message.stopReason === 'aborted' || message.stopReason === 'error' ? message.stopReason : 'stop',
      timestamp,
    }
  }
  const resultBlock = message.content.find((block) => block.type === 'tool_result')
  if (resultBlock?.type !== 'tool_result') {
    return null
  }
  return {
    role: 'toolResult',
    toolCallId: resultBlock.toolCallId,
    toolName: 'tool',
    content: piToolResultContentBlocks(resultBlock.result.content),
    details: resultBlock.result.structuredContent,
    isError: Boolean(resultBlock.error),
    timestamp,
  }
}

// Safely resolve an event payload to an object. Persisted/queued payloads cross a
// storage boundary, so a single malformed entry must be skipped, not allowed to
// throw and abort the whole transcript rebuild.
function parseEventPayload(payload: string | Record<string, unknown>): Record<string, unknown> | null {
  if (typeof payload !== 'string') {
    return payload && typeof payload === 'object' ? payload : null
  }
  try {
    const parsed: unknown = JSON.parse(payload)
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null
  } catch {
    return null
  }
}

function eventCore(event: {
  type?: string
  payload: string | Record<string, unknown>
}): { type?: string; payload: Record<string, unknown> } | null {
  const record = parseEventPayload(event.payload)
  if (!record) {
    return null
  }
  const type = typeof event.type === 'string' ? event.type : typeof record.type === 'string' ? record.type : undefined
  const innerPayload = record.payload && typeof record.payload === 'object' ? record.payload : record
  return {
    ...(type ? { type } : {}),
    payload: innerPayload as Record<string, unknown>,
  }
}

// Accumulates canonical completed transcript messages. Malformed event payloads
// are skipped rather than throwing.
export function runtimeMessagesFromEvents(
  events: Array<{ type?: string; payload: string | Record<string, unknown> }>,
): AgentMessage[] {
  const messageEndMessages: AgentMessage[] = []
  for (const event of events) {
    const core = eventCore(event)
    if (!core) {
      continue
    }
    if (core.type !== 'message.completed') {
      continue
    }
    const enborMessage = enborMessageFromValue(core.payload.message)
    const message = enborMessage ? agentMessageFromEnborMessage(enborMessage) : null
    if (!message) {
      continue
    }
    messageEndMessages.push(message)
  }
  return messageEndMessages
}
