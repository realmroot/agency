import { describe, expect, it } from 'vitest'
import {
  ENBOR_SESSION_EVENT_TYPES,
  enborSessionEventTypeFromPayload,
  isEnborSessionEventType,
  normalizeEnborEvent,
  type EnborEvent,
} from './session-events'

describe('isEnborSessionEventType', () => {
  it('returns true for every canonical Enbor event type', () => {
    for (const type of ENBOR_SESSION_EVENT_TYPES) {
      expect(isEnborSessionEventType(type)).toBe(true)
    }
  })

  it('returns false for unknown or empty strings', () => {
    expect(isEnborSessionEventType('not_a_real_type')).toBe(false)
    expect(isEnborSessionEventType('')).toBe(false)
  })
})

describe('enborSessionEventTypeFromPayload', () => {
  it('returns the type field when it is a non-empty string', () => {
    expect(enborSessionEventTypeFromPayload({ type: 'agent.started' })).toBe('agent.started')
  })

  it('returns unknown when type is missing, empty, or not a string', () => {
    expect(enborSessionEventTypeFromPayload({})).toBe('unknown')
    expect(enborSessionEventTypeFromPayload({ type: '' })).toBe('unknown')
    expect(enborSessionEventTypeFromPayload({ type: 42 })).toBe('unknown')
    expect(enborSessionEventTypeFromPayload({ type: null })).toBe('unknown')
  })
})

describe('normalizeEnborEvent', () => {
  it('keeps a canonical event shape without adding transport metadata', () => {
    const event: EnborEvent = { type: 'turn.completed', payload: {} }
    expect(normalizeEnborEvent(event)).toEqual({ type: 'turn.completed', payload: {} })
  })
})
