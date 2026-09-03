// The session lifecycle: the state vocabulary plus the per-session turn lease
// that serializes concurrent cloud turns and bounds runaway continuation chains.
//
// The multi-state CAS in updateSessionWhenState is NOT a mutex (it succeeds on
// running→running), so two turns could run the same session's transcript in
// parallel. A turn claims the lease (active_turn_id) for the whole continuation
// chain; a concurrent turn loses the compare-and-set and is deferred. A crashed
// holder's lease expires (turn_lease_expires_at) so the next turn reclaims it.
import type { SessionState } from '../session'
import { newId, now } from './util'

export type { SessionState }

// Lease TTL: comfortably above a single cloud-turn invocation's soft budget
// (CLOUD_TURN_SOFT_BUDGET_MS, 4 min) and renewed per event, so a live turn never
// loses its lease mid-flight, while a crashed holder is recovered after the TTL.
export const TURN_LEASE_TTL_MS = 6 * 60_000
// Startup and destroy calls can occupy a full queue invocation. Keep their
// ownership beyond the platform's invocation bound so a replacement worker
// cannot touch the same sandbox ID while the prior invocation is still alive.
export const LIFECYCLE_LEASE_TTL_MS = 30 * 60_000

// Hard cap on continuation steps in one turn chain (~25 × ~4-min steps bounds a
// runaway pause/continue loop far under any legitimate turn). At the cap the turn
// parks idle with a recoverable reason so the operator can re-prompt.
export const MAX_CONTINUATION_DEPTH = 25

export const CONTINUATION_LIMIT_REASON = 'continuation-limit'

// Delay before a deferred turn (one that lost the lease) is retried, in seconds.
export const TURN_LEASE_RETRY_DELAY_SECONDS = 5

export function newTurnId(): string {
  return newId('turn')
}

export function turnLeaseExpiry(fromIso: string = now()): string {
  return new Date(Date.parse(fromIso) + TURN_LEASE_TTL_MS).toISOString()
}

export function lifecycleLeaseExpiry(fromIso: string = now()): string {
  return new Date(Date.parse(fromIso) + LIFECYCLE_LEASE_TTL_MS).toISOString()
}
