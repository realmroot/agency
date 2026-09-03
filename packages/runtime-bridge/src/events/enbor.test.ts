import { describe, expect, it } from 'vitest'
import { messageEvent, reasoningBlock, turnEnd } from './enbor'

describe('turnEnd', () => {
  it('emits the canonical empty end-of-turn payload', () => {
    const event = turnEnd()
    expect(event).toEqual({
      type: 'turn.completed',
      payload: {},
    })
  })
})

describe('reasoningBlock', () => {
  it('keeps reasoning as transcript message content', () => {
    expect(messageEvent({ id: 'msg_1', role: 'assistant', content: [reasoningBlock('thinking...')] })).toEqual({
      type: 'message.completed',
      payload: { message: { id: 'msg_1', role: 'assistant', content: [{ type: 'reasoning', text: 'thinking...' }] } },
    })
  })
})
