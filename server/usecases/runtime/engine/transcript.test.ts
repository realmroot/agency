import { describe, expect, it } from 'vitest'
import { runtimeMessagesFromEvents } from './transcript'

const text = (value: string) => [{ type: 'text' as const, text: value }]

describe('Enbor runtime transcript', () => {
  it('excludes child transcripts but preserves the parent delegation and final result [spec: runtime/subagent-execution]', () => {
    const completed = (message: Record<string, unknown>) => ({ type: 'message.completed', payload: { message } })
    const messages = runtimeMessagesFromEvents([
      completed({
        id: 'parent_call',
        role: 'assistant',
        content: [
          {
            type: 'tool_call',
            toolCall: {
              id: 'delegate_1',
              name: 'agent',
              input: { subagentName: 'researcher', prompt: 'research this' },
            },
          },
        ],
      }),
      completed({ id: 'child_prompt', role: 'user', parentToolCallId: 'delegate_1', content: text('research this') }),
      completed({
        id: 'child_answer',
        role: 'assistant',
        parentToolCallId: 'delegate_1',
        content: text('private child transcript'),
      }),
      completed({
        id: 'child_tool',
        role: 'tool',
        parentToolCallId: 'delegate_1',
        content: [
          {
            type: 'tool_result',
            toolCallId: 'child_read',
            result: { content: text('private child tool') },
            error: null,
          },
        ],
      }),
      completed({
        id: 'parent_result',
        role: 'tool',
        parentToolCallId: 'delegate_1',
        content: [
          {
            type: 'tool_result',
            toolCallId: 'delegate_1',
            result: { content: text('child final answer') },
            error: null,
          },
        ],
      }),
    ])
    expect(messages).toMatchObject([
      {
        role: 'assistant',
        stopReason: 'toolUse',
        content: [
          {
            type: 'toolCall',
            id: 'delegate_1',
            name: 'agent',
            arguments: { subagentName: 'researcher', prompt: 'research this' },
          },
        ],
      },
      { role: 'toolResult', toolCallId: 'delegate_1', content: text('child final answer'), isError: false },
    ])
    expect(messages).toHaveLength(2)
  })

  it('rebuilds context from completed canonical messages only', () => {
    const messages = runtimeMessagesFromEvents([
      {
        payload: {
          type: 'message.completed',
          message: { id: 'msg_user', role: 'user', content: text('canonical user') },
        },
      },
      {
        payload: {
          type: 'message.completed',
          message: { id: 'msg_assistant', role: 'assistant', content: text('canonical assistant') },
        },
      },
    ])
    expect(messages).toMatchObject([
      { role: 'user', content: 'canonical user' },
      { role: 'assistant', content: [{ type: 'text', text: 'canonical assistant' }] },
    ])
  })

  it('falls back to message.completed accumulation when no runtime snapshot is present', () => {
    const messages = runtimeMessagesFromEvents([
      { type: 'message.updated', payload: { message: { role: 'assistant', content: text('partial') } } },
      { type: 'message.completed', payload: { message: { role: 'assistant', content: text('completed') } } },
    ])
    expect(messages).toMatchObject([{ role: 'assistant', content: [{ type: 'text', text: 'completed' }] }])
  })

  it('skips malformed payload entries instead of throwing', () => {
    const messages = runtimeMessagesFromEvents([
      { type: 'message.completed', payload: 'not json {' },
      { type: 'message.completed', payload: JSON.stringify({ message: { role: 'user', content: text('kept') } }) },
    ])
    expect(messages).toMatchObject([{ role: 'user', content: 'kept' }])
  })

  it('parses string payloads and ignores non-persisted message roles', () => {
    const messages = runtimeMessagesFromEvents([
      { type: 'message.completed', payload: JSON.stringify({ message: { role: 'system', content: text('ignored') } }) },
      { type: 'message.completed', payload: JSON.stringify({ message: { role: 'assistant', content: text('kept') } }) },
    ])
    expect(messages).toMatchObject([{ role: 'assistant', content: [{ type: 'text', text: 'kept' }] }])
  })
})
