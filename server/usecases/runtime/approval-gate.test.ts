import { describe, expect, it, vi } from 'vitest'
import { createToolApprovalGate } from './approval-gate'

function fixture(metadata: Record<string, unknown> = {}) {
  const updateSession = vi.fn(async () => {})
  const appendEvent = vi.fn(async () => 'permission_event')
  const gate = createToolApprovalGate(
    {
      sessionOrchestration: { sessionMetadata: async () => ({ metadata: JSON.stringify(metadata) }), updateSession },
      audit: { record: vi.fn(async () => {}) },
      policy: { toolPolicyRequiresApproval: async () => true },
    } as unknown as Parameters<typeof createToolApprovalGate>[0],
    {
      auth: { project: { id: 'project_1' } } as Parameters<typeof createToolApprovalGate>[1]['auth'],
      sessionId: 'session_1',
      sessionMetadata: metadata,
      appendEvent,
    },
  )
  return { gate, updateSession, appendEvent }
}

describe('approval decision classification [spec: runtime/subagent-execution]', () => {
  it('marks a newly pending approval as requiring action rather than a final denial', async () => {
    const { gate, updateSession, appendEvent } = fixture()
    expect(
      await gate.gate({
        toolCallId: 'delegate_1',
        toolName: 'agent',
        input: { subagentName: 'researcher', prompt: 'research this' },
      }),
    ).toMatchObject({ allowed: false, requiresAction: true })
    expect(gate.requiresAction()).toBe(true)
    expect(appendEvent).toHaveBeenCalledOnce()
    expect(updateSession).toHaveBeenCalledWith(
      'project_1',
      'session_1',
      expect.objectContaining({ state: 'idle', stateReason: 'requires-action' }),
    )
  })

  it('keeps a recorded denial final without creating another approval request', async () => {
    const { gate, appendEvent, updateSession } = fixture({ approvalGrants: { denied: { delegate_1: 'Not allowed' } } })
    expect(
      await gate.gate({
        toolCallId: 'delegate_1',
        toolName: 'agent',
        input: { subagentName: 'researcher', prompt: 'research this' },
      }),
    ).toEqual({ allowed: false, reason: 'Not allowed' })
    expect(gate.requiresAction()).toBe(false)
    expect(appendEvent).not.toHaveBeenCalled()
    expect(updateSession).not.toHaveBeenCalled()
  })
})
