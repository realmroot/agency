import { describe, expect, it } from 'vitest'
import { reduceTurnStatus, type TurnStatus } from './turn-status'

const idle: TurnStatus = { kind: 'idle' }

describe('Enbor runtime turn-status reducer', () => {
  it('records each terminal signal from idle', () => {
    expect(reduceTurnStatus(idle, { type: 'pause' })).toEqual({ kind: 'paused' })
    expect(reduceTurnStatus(idle, { type: 'cancel' })).toEqual({ kind: 'cancelled' })
    expect(reduceTurnStatus(idle, { type: 'fail', message: 'boom' })).toEqual({ kind: 'failed', message: 'boom' })
  })

  it('applies precedence pause > cancel > fail and never downgrades', () => {
    // cancel beats a prior fail (matches the original aborted-over-failure ladder)
    expect(reduceTurnStatus({ kind: 'failed', message: 'boom' }, { type: 'cancel' })).toEqual({ kind: 'cancelled' })
    // fail does NOT downgrade a recorded cancel
    expect(reduceTurnStatus({ kind: 'cancelled' }, { type: 'fail', message: 'boom' })).toEqual({ kind: 'cancelled' })
    // pause beats cancel (pause is checked first in the original)
    expect(reduceTurnStatus({ kind: 'cancelled' }, { type: 'pause' })).toEqual({ kind: 'paused' })
    // nothing downgrades a pause
    expect(reduceTurnStatus({ kind: 'paused' }, { type: 'cancel' })).toEqual({ kind: 'paused' })
    expect(reduceTurnStatus({ kind: 'paused' }, { type: 'fail', message: 'boom' })).toEqual({ kind: 'paused' })
  })

  it('keeps the latest failure message when a second failure arrives (last-write-wins)', () => {
    const first = reduceTurnStatus(idle, { type: 'fail', message: 'first' })
    expect(reduceTurnStatus(first, { type: 'fail', message: 'second' })).toEqual({ kind: 'failed', message: 'second' })
  })
})
