import { describe, expect, it, vi } from 'vitest'
import type { AuthScope, SessionRow, WorkItemInsert } from '../ports'
import { dispatchSessionPrompt, type PromptDeps } from './session-prompt'

const auth: AuthScope = {
  user: { id: 'user_1' },
  organization: { id: 'org_1', name: 'org_1' },
  project: { id: 'proj_1', name: 'proj_1' },
  roles: ['system'],
  permissions: ['*'],
}

function selfHostedSession(overrides: Partial<SessionRow> = {}): SessionRow {
  const timestamp = '2026-06-26T17:00:00.000Z'
  return {
    id: 'sess_1',
    agentId: 'agent_1',
    organizationId: auth.organization.id,
    createdByUserId: auth.user.id,
    agentVersionId: 'agentver_1',
    agentSnapshot: JSON.stringify({
      id: 'agentver_1',
      agentId: 'agent_1',
      projectId: auth.project.id,
      version: 1,
      systemPrompt: 'Do the work.',
      provider: 'openai',
      model: 'gpt-5',
      skills: [],
      subagents: [],
      allowedTools: [],
      mcpConnectors: [],
      createdAt: timestamp,
    }),
    environmentId: 'env_1',
    environmentVersionId: 'envver_1',
    environmentSnapshot: JSON.stringify({ id: 'envver_1', hostingMode: 'self_hosted', runtimeConfig: {} }),
    title: 'Self-hosted prompt',
    env: '{}',
    envFrom: '[]',
    volumes: '[]',
    volumeMounts: '[]',
    projectId: auth.project.id,
    durableObjectName: 'sess_1',
    sandboxId: null,
    resumeToken: null,
    runtimeEndpointPath: null,
    modelProvider: 'openai',
    modelConfig: null,
    state: 'running',
    stateReason: null,
    activeTurnId: null,
    turnLeaseExpiresAt: null,
    continuationDepth: 0,
    metadata: JSON.stringify({ runtime: 'codex' }),
    startedAt: timestamp,
    closedAt: null,
    archivedAt: null,
    createdAt: timestamp,
    updatedAt: timestamp,
    ...overrides,
  }
}

function depsFor(
  session: SessionRow,
  options: { queueResult?: boolean; channelAccepted?: boolean; dispatchResult?: boolean } = {},
) {
  const queueSessionWorkWhenState = vi.fn<
    (
      projectId: string,
      sessionId: string,
      expected: string | string[],
      fields: Record<string, unknown>,
      workItem: WorkItemInsert,
    ) => Promise<boolean>
  >(async () => options.queueResult ?? true)
  const recentSessionWorkItems = vi.fn(async () => [
    {
      state: 'succeeded',
      payload: JSON.stringify({ resumeToken: 'payload-token' }),
      result: JSON.stringify({ resumeToken: 'result-token' }),
    },
  ])
  const deps = {
    sessionOrchestration: {
      findSession: async () => session,
      recentSessionWorkItems,
      queueSessionWorkWhenState,
    },
    runnerChannel: {
      assignWork: async () => true,
      isAccepted: async () => options.channelAccepted ?? false,
      dispatch: async () => options.dispatchResult ?? false,
    },
    audit: { record: vi.fn() },
  } as unknown as PromptDeps
  return { deps, queueSessionWorkWhenState }
}

function depsForFirstPrompt(session: SessionRow) {
  const { deps, queueSessionWorkWhenState } = depsFor(session)
  vi.mocked(deps.sessionOrchestration.recentSessionWorkItems).mockResolvedValue([])
  return { deps, queueSessionWorkWhenState }
}

describe('dispatchSessionPrompt [spec: sessions/prompt]', () => {
  it('delivers running self-hosted prompts through the live runner channel', async () => {
    const { deps, queueSessionWorkWhenState } = depsFor(selfHostedSession(), {
      channelAccepted: true,
      dispatchResult: true,
    })

    const result = await dispatchSessionPrompt(deps, auth, 'sess_1', 'resume after review rejection')

    expect(result).toEqual({ ok: true, delivery: 'live', state: 'delivered' })
    expect(queueSessionWorkWhenState).not.toHaveBeenCalled()
  })

  it('does not queue a second work item when a running self-hosted session is not accepting live prompts', async () => {
    const { deps, queueSessionWorkWhenState } = depsFor(selfHostedSession())

    const result = await dispatchSessionPrompt(deps, auth, 'sess_1', 'resume after review rejection')

    expect(result).toEqual({ ok: false, status: 409, message: 'Session runtime is not accepting live prompts' })
    expect(queueSessionWorkWhenState).not.toHaveBeenCalled()
  })

  it('does not report live delivery when the runner rejects the command acknowledgement', async () => {
    const { deps, queueSessionWorkWhenState } = depsFor(selfHostedSession(), {
      channelAccepted: true,
      dispatchResult: false,
    })

    const result = await dispatchSessionPrompt(deps, auth, 'sess_1', 'resume after review rejection')

    expect(result).toEqual({ ok: false, status: 409, message: 'Session runtime did not accept the live prompt' })
    expect(queueSessionWorkWhenState).not.toHaveBeenCalled()
  })

  it('queues the first self-hosted prompt without resume metadata when the session has no prior work item', async () => {
    const { deps, queueSessionWorkWhenState } = depsForFirstPrompt(selfHostedSession({ state: 'idle' }))

    const result = await dispatchSessionPrompt(deps, auth, 'sess_1', 'start the session', 'req_prompt_1')

    expect(result).toEqual({ ok: true, delivery: 'queued', state: 'accepted' })
    const workItem = queueSessionWorkWhenState.mock.calls[0]?.[4]
    expect(JSON.parse(workItem?.payload ?? '{}')).toMatchObject({
      type: 'session.start',
      requestId: 'req_prompt_1',
      prompt: 'start the session',
      resume: false,
      resumeToken: null,
    })
  })

  it('preserves the caller prompt when resuming a self-hosted runtime', async () => {
    const { deps, queueSessionWorkWhenState } = depsFor(selfHostedSession({ state: 'idle' }))

    const result = await dispatchSessionPrompt(deps, auth, 'sess_1', 'address review feedback', 'req_resume_1')

    expect(result).toEqual({ ok: true, delivery: 'queued', state: 'accepted' })
    const workItem = queueSessionWorkWhenState.mock.calls[0]?.[4]
    expect(JSON.parse(workItem?.payload ?? '{}')).toMatchObject({
      type: 'session.start',
      requestId: 'req_resume_1',
      prompt: 'address review feedback',
      resume: true,
      resumeToken: 'result-token',
    })
  })

  it('does not accept an idle prompt when the atomic self-hosted queue transition loses the state race', async () => {
    const { deps, queueSessionWorkWhenState } = depsFor(selfHostedSession({ state: 'idle' }), { queueResult: false })

    const result = await dispatchSessionPrompt(deps, auth, 'sess_1', 'resume after review rejection')

    expect(result).toEqual({ ok: false, status: 409, message: 'Session runtime is no longer active' })
    expect(queueSessionWorkWhenState).toHaveBeenCalledTimes(1)
  })
})
