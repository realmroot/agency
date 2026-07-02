import { describe, expect, it, vi } from 'vitest'
import { reopenSession } from './session-lifecycle'
import { markIdleTimedOutSessions as runIdleTimeoutCleanup } from './watchdog'

const auth = {
  organization: { id: 'org_1' },
  project: { id: 'proj_1' },
} as never

function session(state: string) {
  return {
    id: 'sess_1',
    organizationId: 'org_1',
    projectId: 'proj_1',
    state,
    stateReason: null,
    sandboxId: null,
    metadata: '{}',
  }
}

describe('session lifecycle maintenance', () => {
  it('treats reopen on an active session as idempotent', async () => {
    const updateSession = vi.fn()
    const deps = {
      sessionOrchestration: {
        findSession: vi.fn().mockResolvedValue(session('running')),
        updateSession,
      },
      audit: { record: vi.fn() },
    } as never

    const result = await reopenSession(deps, auth, 'sess_1', 'req_1')

    expect(result).toEqual({ ok: true, session: session('running') })
    expect(updateSession).not.toHaveBeenCalled()
  })

  it('delegates idle timeout cleanup to the session store', async () => {
    const markIdleTimedOutSessions = vi.fn()
    const deps = {
      sessionOrchestration: { markIdleTimedOutSessions },
    } as never

    await runIdleTimeoutCleanup(deps)

    expect(markIdleTimedOutSessions).toHaveBeenCalledWith(expect.any(String))
  })
})
