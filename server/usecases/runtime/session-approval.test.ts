import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { EventStore, SessionOrchestrationStore } from '../ports'

const { activateCloudSessionForTurnMock, executeCloudSessionTurnMock } = vi.hoisted(() => ({
  activateCloudSessionForTurnMock: vi.fn(async () => undefined),
  executeCloudSessionTurnMock: vi.fn(async () => ({ ok: true })),
}))

vi.mock('./cloud-turn', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./cloud-turn')>()),
  activateCloudSessionForTurn: activateCloudSessionForTurnMock,
  executeCloudSessionTurn: executeCloudSessionTurnMock,
}))

import { decideSessionApproval } from './session-approval'

const auth = {
  user: { id: 'user_1' },
  organization: { id: 'org_1' },
  project: { id: 'proj_1' },
} as never

function fixture(
  options: {
    acquired?: boolean
    inline?: boolean
    executeFailure?: Error
    toolName?: string
    events?: Awaited<ReturnType<EventStore['eventStream']>>
  } = {},
) {
  const pendingApproval = {
    id: 'approval_1',
    toolCallId: 'tool_call_1',
    toolName: options.toolName ?? 'bash',
    input: options.toolName === 'agent' ? { subagentName: 'researcher', prompt: 'research this' } : { command: 'pwd' },
    requestedAt: '2026-09-03T00:00:00.000Z',
    relatedEventIds: ['event_request'],
  }
  const metadata = JSON.stringify({ pendingApproval })
  const session = {
    id: 'session_1',
    organizationId: 'org_1',
    projectId: 'proj_1',
    state: 'idle',
    sandboxId: 'sandbox_1',
    agentSnapshot: JSON.stringify({ provider: 'workers-ai', model: '@cf/test', mcpConnectors: [] }),
    environmentSnapshot: null,
    env: '{}',
    envFrom: '[]',
    volumes: '[]',
    volumeMounts: '[]',
    metadata,
  }
  const executeTool = options.executeFailure
    ? vi.fn(async () => Promise.reject(options.executeFailure))
    : vi.fn(async () => ({
        toolCallId: 'tool_call_1',
        toolName: 'bash',
        output: { stdout: '/workspace', stderr: '', exitCode: 0 },
        error: null,
        durationMs: 1,
      }))
  const acquireIdleTurnLease = vi.fn<SessionOrchestrationStore['acquireIdleTurnLease']>(
    async () => options.acquired ?? true,
  )
  const releaseTurnLease = vi.fn<SessionOrchestrationStore['releaseTurnLease']>(async () => true)
  const enqueue = vi.fn(async () => undefined)
  const appendEvent = vi.fn<EventStore['appendEvent']>(async () => 'event_1')
  const audit = { record: vi.fn(async () => undefined) }
  const upsertApproval = vi.fn(async () => undefined)
  const updateSession = vi.fn(async () => undefined)
  const deps = {
    sessionOrchestration: {
      findSession: vi.fn(async () => session),
      findApproval: vi.fn(async () => null),
      sessionMetadata: vi.fn(async () => ({ metadata })),
      updateSession,
      upsertApproval,
      acquireIdleTurnLease,
      releaseTurnLease,
    },
    sessionEventStore: { appendEvent, eventStream: vi.fn(async () => options.events ?? []) },
    audit,
    sandboxExecutor: { executeTool },
    cloudTurnQueue: { runsInline: () => options.inline ?? false, enqueue },
  } as never
  return {
    deps,
    session,
    pendingApproval,
    executeTool,
    acquireIdleTurnLease,
    releaseTurnLease,
    enqueue,
    appendEvent,
    audit,
    upsertApproval,
    updateSession,
  }
}

describe('session approval continuation', () => {
  beforeEach(() => vi.clearAllMocks())

  it('[spec: runtime/subagent-execution] approving delegation resumes the parent without a sandbox agent call or fabricated final result', async () => {
    const f = fixture({ toolName: 'agent' })
    await expect(
      decideSessionApproval(f.deps, auth, f.session.id, f.pendingApproval.id, { decision: 'approve' }),
    ).resolves.toMatchObject({ ok: true })
    expect(f.executeTool).not.toHaveBeenCalled()
    expect(f.enqueue).toHaveBeenCalledWith(expect.objectContaining({ type: 'session.step' }))
    expect(
      f.appendEvent.mock.calls
        .map(([, event]) => event)
        .filter((event) => JSON.stringify(event).includes('tool_result')),
    ).toEqual([])
  })

  it('[spec: runtime/subagent-execution] records an approved child sandbox result in its child conversation', async () => {
    const f = fixture({
      events: [
        {
          type: 'message.completed',
          payload: JSON.stringify({
            message: {
              id: 'child_call',
              role: 'assistant',
              parentToolCallId: 'delegate_1',
              content: [
                { type: 'tool_call', toolCall: { id: 'tool_call_1', name: 'bash', input: { command: 'pwd' } } },
              ],
            },
          }),
        },
      ],
    })
    await decideSessionApproval(f.deps, auth, f.session.id, f.pendingApproval.id, { decision: 'approve' })
    const recorded = f.appendEvent.mock.calls
      .map(([, event]) => event)
      .find((event) => JSON.stringify(event).includes('tool_result'))
    expect(recorded).toBeDefined()
    expect(JSON.stringify(recorded)).toContain('"parentToolCallId":"delegate_1"')
    expect(f.executeTool).toHaveBeenCalledOnce()
    expect(f.enqueue).toHaveBeenCalledOnce()
  })

  it('[spec: runtime/idle-retention] executes an approved tool inside one acquired lease and queues that turn id', async () => {
    const f = fixture()

    await decideSessionApproval(f.deps, auth, f.session.id, f.pendingApproval.id, { decision: 'approve' })

    expect(f.acquireIdleTurnLease).toHaveBeenCalledWith(
      'proj_1',
      'session_1',
      expect.any(String),
      expect.any(String),
      expect.any(String),
    )
    const turnId = f.acquireIdleTurnLease.mock.calls[0]?.[2]
    expect(activateCloudSessionForTurnMock.mock.invocationCallOrder[0]).toBeLessThan(
      f.executeTool.mock.invocationCallOrder[0]!,
    )
    expect(f.executeTool).toHaveBeenCalledWith(expect.objectContaining({ sandboxId: 'sandbox_1', toolName: 'bash' }))
    expect(f.enqueue).toHaveBeenCalledWith(expect.objectContaining({ type: 'session.step', turnId }))
    expect(f.releaseTurnLease).not.toHaveBeenCalled()
  })

  it('[spec: runtime/idle-retention] rejects a duplicate approval when the idle lease claim loses without side effects', async () => {
    const f = fixture({ acquired: false })

    await expect(
      decideSessionApproval(f.deps, auth, f.session.id, f.pendingApproval.id, { decision: 'approve' }),
    ).resolves.toEqual({
      ok: false,
      error: { status: 409, code: 'conflict', message: 'Session is no longer awaiting approval' },
    })
    expect(f.appendEvent).not.toHaveBeenCalled()
    expect(f.audit.record).not.toHaveBeenCalled()
    expect(f.upsertApproval).not.toHaveBeenCalled()
    expect(f.updateSession).not.toHaveBeenCalled()
    expect(activateCloudSessionForTurnMock).not.toHaveBeenCalled()
    expect(f.executeTool).not.toHaveBeenCalled()
    expect(f.enqueue).not.toHaveBeenCalled()
  })

  it('[spec: runtime/idle-retention] releases the approval lease after an inline continuation settles', async () => {
    const f = fixture({ inline: true })

    await decideSessionApproval(f.deps, auth, f.session.id, f.pendingApproval.id, { decision: 'approve' })

    const turnId = f.acquireIdleTurnLease.mock.calls[0]?.[2]
    expect(executeCloudSessionTurnMock).toHaveBeenCalledWith(
      f.deps,
      auth,
      f.session,
      { continuation: true },
      'session.command',
    )
    expect(f.releaseTurnLease).toHaveBeenCalledWith('proj_1', 'session_1', turnId, {})
    expect(f.enqueue).not.toHaveBeenCalled()
  })

  it('[spec: runtime/idle-retention] releases the approval lease to error when direct execution throws', async () => {
    const failure = new Error('sandbox unavailable')
    const f = fixture({ executeFailure: failure })

    await expect(
      decideSessionApproval(f.deps, auth, f.session.id, f.pendingApproval.id, { decision: 'approve' }),
    ).rejects.toBe(failure)

    const turnId = f.acquireIdleTurnLease.mock.calls[0]?.[2]
    expect(f.releaseTurnLease).toHaveBeenCalledWith(
      'proj_1',
      'session_1',
      turnId,
      expect.objectContaining({ state: 'error', stateReason: 'sandbox unavailable' }),
    )
    expect(f.enqueue).not.toHaveBeenCalled()
  })
})
