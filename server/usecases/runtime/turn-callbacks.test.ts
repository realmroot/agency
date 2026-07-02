import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildSessionTurnCallbacks } from './turn-callbacks'

// The shared callback bundle is the single seam both in-Worker turn drivers
// (cloud-turn.executeCloudSessionTurn and recordRuntimeMessageOutcome) run
// through. These tests pin its control flow so the two paths can't drift. The
// usecase is deps-first: the policy gate, the approval-gate factory, and the
// store all arrive on `deps`, and the policy-denial recorder is injected on
// `values`, so the test wires fakes at those seams instead of mocking modules.
describe('[spec: runtime/turn] buildSessionTurnCallbacks (shared turn-driver seam)', () => {
  const auth = { project: { id: 'project_1' }, organization: { id: 'org_1' } } as never
  const session = {
    id: 'session_1',
    agentSnapshot: '{}',
    environmentSnapshot: null,
    metadata: null,
  } as never

  let store: { db: object; sessionState: ReturnType<typeof vi.fn>; appendEvent: ReturnType<typeof vi.fn> }
  let policyBlocksSandboxOperation: ReturnType<typeof vi.fn>
  let createToolApprovalGate: ReturnType<typeof vi.fn>
  let gate: {
    shouldSuppressEvent: ReturnType<typeof vi.fn>
    resolveToolResult: ReturnType<typeof vi.fn>
    gate: ReturnType<typeof vi.fn>
    requiresAction: ReturnType<typeof vi.fn>
  }
  let recordPolicyDenial: ReturnType<typeof vi.fn>

  beforeEach(() => {
    store = {
      db: {},
      sessionState: vi.fn().mockResolvedValue({ state: 'running' }),
      appendEvent: vi.fn().mockResolvedValue(undefined),
    }
    gate = {
      shouldSuppressEvent: vi.fn().mockReturnValue(false),
      resolveToolResult: vi.fn().mockResolvedValue(null),
      gate: vi.fn().mockResolvedValue(null),
      requiresAction: vi.fn().mockReturnValue(false),
    }
    createToolApprovalGate = vi.fn().mockReturnValue(gate)
    policyBlocksSandboxOperation = vi.fn()
    recordPolicyDenial = vi.fn(async () => {})
  })

  const build = () =>
    buildSessionTurnCallbacks(
      {
        sessionOrchestration: store as never,
        sessionEventStore: store as never,
        policy: { policyBlocksSandboxOperation } as never,
        createApprovalGate: createToolApprovalGate as never,
      },
      { auth, session, recordPolicyDenial: recordPolicyDenial as never },
    )

  it('records the denial and short-circuits the gate when a sandbox operation is policy-blocked', async () => {
    policyBlocksSandboxOperation.mockResolvedValue({
      decision: { message: 'blocked by policy', category: 'sandbox', rule: 'rule_1' },
      operation: { operation: 'command', command: 'rm -rf', resourceType: 'sandbox_command', resourceId: 'rm' },
    })
    const callbacks = build()
    const decision = await callbacks.approveToolCall({ toolCallId: 'tc_1', toolName: 'bash', input: {} })

    expect(recordPolicyDenial).toHaveBeenCalledTimes(1)
    expect(decision).toEqual({ allowed: false, reason: 'blocked by policy' })
    expect(callbacks.wasPolicyDenied()).toBe(true)
    expect(gate.gate).not.toHaveBeenCalled()
  })

  it('falls through to the approval gate when the operation is not policy-blocked', async () => {
    policyBlocksSandboxOperation.mockResolvedValue(null)
    const callbacks = build()
    const decision = await callbacks.approveToolCall({ toolCallId: 'tc_2', toolName: 'bash', input: {} })

    expect(recordPolicyDenial).not.toHaveBeenCalled()
    expect(gate.gate).toHaveBeenCalledTimes(1)
    expect(decision).toEqual({ allowed: true })
    expect(callbacks.wasPolicyDenied()).toBe(false)
  })

  it('returns the approval gate decision when the gate parks the tool call', async () => {
    policyBlocksSandboxOperation.mockResolvedValue(null)
    gate.gate.mockResolvedValue({ allowed: false, reason: 'awaiting approval' })
    const callbacks = build()
    const decision = await callbacks.approveToolCall({ toolCallId: 'tc_3', toolName: 'bash', input: {} })

    expect(decision).toEqual({ allowed: false, reason: 'awaiting approval' })
    expect(callbacks.wasPolicyDenied()).toBe(false)
  })

  it('suppresses gated events and persists the rest only while the session is running', async () => {
    const callbacks = build()

    gate.shouldSuppressEvent.mockReturnValueOnce(true)
    await callbacks.onEvent({
      type: 'message.updated',
      payload: { message: { id: 'msg_1', role: 'assistant', content: [] } },
    })
    expect(store.appendEvent).not.toHaveBeenCalled()

    await callbacks.onEvent({
      type: 'message.completed',
      payload: { message: { id: 'msg_2', role: 'assistant', content: [] } },
    })
    expect(store.sessionState).toHaveBeenCalledWith('project_1', 'session_1')
    expect(store.appendEvent).toHaveBeenCalledTimes(1)
  })

  it('throws RuntimeTurnCancelled from ensureActive when the session is no longer running', async () => {
    store.sessionState.mockResolvedValue({ state: 'closed' })
    const callbacks = build()
    await expect(callbacks.ensureActive()).rejects.toThrow()
  })
})
