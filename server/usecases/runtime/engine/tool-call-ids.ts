import type { AgentMessage } from '@earendil-works/pi-agent-core'
import type { AssistantMessage } from '@earendil-works/pi-ai'

export function persistedToolCallIds(messages: AgentMessage[]): Set<string> {
  const ids = new Set<string>()
  for (const message of messages) {
    if (message.role === 'toolResult') ids.add(message.toolCallId)
    if (message.role !== 'assistant') continue
    for (const block of message.content) {
      if (block.type === 'toolCall') ids.add(block.id)
    }
  }
  return ids
}

// Providers may reuse call IDs across independent contexts. Policy grants and
// child transcripts are Session-scoped, so fresh calls must not alias old work.
export function reserveToolCallIds(message: AssistantMessage, ids: Set<string>): AssistantMessage {
  return {
    ...message,
    content: message.content.map((block) => {
      if (block.type !== 'toolCall') return block
      const id = ids.has(block.id) ? `call_${crypto.randomUUID().replaceAll('-', '')}` : block.id
      ids.add(id)
      return { ...block, id }
    }),
  }
}
