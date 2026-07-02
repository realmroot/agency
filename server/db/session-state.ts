import type { SessionState } from '../domain/session'

export type PersistedSessionState = 'pending' | 'running' | 'idle' | 'stopped' | 'error'

export function persistedSessionState(state: string): PersistedSessionState {
  return (state === 'closed' ? 'stopped' : state) as PersistedSessionState
}

export function domainSessionState(state: string): SessionState {
  return (state === 'stopped' ? 'closed' : state) as SessionState
}

export function persistedSessionStates(states: string[]): PersistedSessionState[] {
  return states.map(persistedSessionState)
}
