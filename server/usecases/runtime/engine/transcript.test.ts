import { describe, expect, it } from 'vitest'
import { runtimeMessagesFromEvents } from './transcript'

const text = (value: string) => [{ type: 'text' as const, text: value }]

describe('Enbor runtime transcript', () => {
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
