import { describe, expect, it } from 'vitest'
import type { Identity } from '@/lib/amarpc'
import { identityAssignmentLabel, identityStatusLabel } from './identity-display'

const now = '2026-08-29T00:00:00.000Z'

function identity(
  state: 'provisioning' | 'active' | 'error',
  overrides: { archivedAt?: string | null; boundAgentId?: string | null } = {},
): Identity {
  const fixture: Identity = {
    metadata: {
      uid: 'identity_1',
      projectId: 'project_1',
      name: 'Operator',
      description: null,
      labels: {},
      annotations: {},
      createdBy: 'user_1',
      createdAt: now,
      updatedAt: now,
      archivedAt: overrides.archivedAt ?? null,
    },
    spec: { username: 'operator', runtime: 'codex' },
    status: {
      phase: 'active',
      state: 'active',
      failureCode: null,
      boundAgentId: overrides.boundAgentId ?? null,
      descriptor: null,
    },
  }
  Object.assign(fixture.status, {
    phase: state,
    state,
    failureCode: state === 'error' ? 'authorization_failed' : null,
  })
  return fixture
}

describe('identity display labels', () => {
  it.each([
    ['provisioning', 'Creating'],
    ['active', 'Active'],
    ['error', 'Needs attention'],
  ] as const)('maps %s state to %s', (state, expected) => {
    expect(identityStatusLabel(identity(state))).toBe(expected)
  })

  it('gives archived identities precedence over their provisioning state', () => {
    expect(identityStatusLabel(identity('provisioning', { archivedAt: now }))).toBe('Archived')
  })

  it('exposes assignment state without exposing the bound agent id', () => {
    expect(identityAssignmentLabel(identity('active'))).toBe('Unassigned')
    expect(identityAssignmentLabel(identity('active', { boundAgentId: 'agent_internal_1' }))).toBe('Assigned')
  })
})
