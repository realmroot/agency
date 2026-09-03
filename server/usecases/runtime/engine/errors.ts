// The turn engine's shared error vocabulary. Pure: no platform dependencies.
// Both hosts and the orchestration callers branch on these, so they live in the
// core and are re-exported from server/runtime/session-runtime for back-compat.

// The adapter-normalized provider failure shape the engine reads to build the
// canonical runtime.error event. Structurally a subset of the server domain's
// NormalizedProviderError, so the Worker adapter can pass that value directly.
export interface RuntimeProviderError {
  message: string
  category: string
  retryable: boolean
  retryAfterSeconds?: number
}

// The canonical cancellation reason. The engine compares against this constant
// by identity instead of re-spelling the string literal at each call site, so a
// cancelled turn and the failure-detection path can never drift apart.
export const CANCELLATION_REASON = 'Runtime request aborted'

export class RuntimeTurnCancelledError extends Error {
  constructor(message = 'Session runtime is no longer active') {
    super(message)
    this.name = 'RuntimeTurnCancelledError'
  }
}

// A tool call was denied by Enbor policy. The turn fails, but the session stays
// usable: a governance denial is an expected product outcome, not a runtime
// fault, so callers park the session back to idle instead of error.
export class RuntimePolicyDeniedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'RuntimePolicyDeniedError'
  }
}

// A provider/model call failed: carries the adapter-normalized error so the
// canonical runtime.error event and the session status only ever expose the
// safe category and message, never the raw provider payload.
export class ProviderCallError extends Error {
  constructor(readonly normalized: RuntimeProviderError) {
    super(normalized.message)
    this.name = 'ProviderCallError'
  }
}

export function isRuntimePolicyDenied(error: unknown): error is RuntimePolicyDeniedError {
  return (
    error instanceof RuntimePolicyDeniedError || (error instanceof Error && error.name === 'RuntimePolicyDeniedError')
  )
}

export function isRuntimeTurnCancelled(error: unknown): error is RuntimeTurnCancelledError {
  return (
    error instanceof RuntimeTurnCancelledError || (error instanceof Error && error.name === 'RuntimeTurnCancelledError')
  )
}
