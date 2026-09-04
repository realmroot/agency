import type { Context, Model } from '@earendil-works/pi-ai'
import type { EnborEvent } from '@shared/session-events'
import { describe, expect, it, vi } from 'vitest'
import type { TurnEngineInput } from './ports'
import { subagentTools } from './subagent-tools'
import { runtimeConversationFromEvents } from './transcript'
import { assistantMessage, runTurn, ZERO_USAGE } from './turn-engine'

const model = { api: 'test', provider: 'test', id: 'parent-model' } as unknown as Model<string>
const childModel = { ...model, id: 'child-model' }
const text = (value: string) => [{ type: 'text' as const, text: value }]

function fixture() {
  const events: EnborEvent[] = []
  const calls: Array<{ model: Model<string>; context: Context }> = []
  const input: TurnEngineInput = {
    sessionId: 'session_subagent',
    sandboxId: 'sandbox_subagent',
    model,
    providerLabel: 'test',
    modelLabel: model.id,
    prompt: 'delegate the task',
    agentSnapshot: {
      systemPrompt: 'parent instructions',
      allowedTools: ['bash'],
      identity: { id: 'parent-identity' },
      subagents: [{ name: 'researcher', systemPrompt: 'child instructions', model: null, allowedTools: ['read'] }],
    },
    sink: {
      emit: async (event) => {
        events.push(event)
      },
    },
    executor: {
      execute: vi.fn(async (request) => ({
        toolCallId: request.toolCallId,
        toolName: request.toolName,
        output: { content: 'private working notes' },
        error: null,
        durationMs: 0,
      })),
    },
    policy: { approve: vi.fn(async () => ({ allowed: true })) },
    toolResults: { resolve: vi.fn(async () => null) },
    liveness: { ensureActive: async () => {} },
    modelClient: {
      complete: vi.fn(async (selectedModel: Model<string>, context: Context) => {
        calls.push({ model: selectedModel, context: { ...context, messages: structuredClone(context.messages) } })
        const isChild = context.systemPrompt === 'child instructions'
        const hasResult = context.messages.some((message) => message.role === 'toolResult')
        if (isChild) {
          return assistantMessage(
            selectedModel,
            hasResult
              ? text('child final answer')
              : [{ type: 'toolCall', id: 'child_read', name: 'read', arguments: { path: 'notes.txt' } }],
            hasResult ? 'stop' : 'toolUse',
            ZERO_USAGE,
          )
        }
        return assistantMessage(
          selectedModel,
          hasResult
            ? text('parent final answer')
            : [
                {
                  type: 'toolCall',
                  id: 'delegate_1',
                  name: 'agent',
                  arguments: { subagentName: 'researcher', prompt: 'research this', description: 'Find the answer' },
                },
              ],
          hasResult ? 'stop' : 'toolUse',
          ZERO_USAGE,
        )
      }),
    },
  }
  return { input, events, calls }
}

describe('cloud subagent execution [spec: runtime/subagent-execution]', () => {
  it('defers later parent tools when a child pauses and executes each pending tool once on resume', async () => {
    const { input, events } = fixture()
    const complete = input.modelClient.complete
    input.modelClient.complete = async (selectedModel, context, signal) => {
      const message = await complete(selectedModel, context, signal)
      if (context.systemPrompt === 'parent instructions' && message.stopReason === 'toolUse') {
        return {
          ...message,
          content: [
            ...message.content,
            { type: 'toolCall', id: 'side_effect', name: 'bash', arguments: { command: 'touch marker.txt' } },
          ],
        }
      }
      return message
    }
    input.executor.execute = vi.fn(async (request) => ({
      toolCallId: request.toolCallId,
      toolName: request.toolName,
      output:
        request.toolName === 'bash' ? { stdout: '', stderr: '', exitCode: 0 } : { content: 'private working notes' },
      error: null,
      durationMs: 0,
    }))
    const executedIds = () => vi.mocked(input.executor.execute).mock.calls.map(([request]) => request.toolCallId)
    input.budget = { shouldPause: () => executedIds().includes('child_read') }
    expect(await runTurn(input)).toEqual({ status: 'paused' })
    expect(executedIds()).toEqual(['child_read'])
    const conversation = runtimeConversationFromEvents(events.map((event) => ({ payload: event })))
    expect(conversation.messages.filter((message) => message.role === 'toolResult')).toEqual([])
    expect(
      await runTurn({ ...input, ...conversation, continuation: true, budget: { shouldPause: () => false } }),
    ).toEqual({ status: 'idle' })
    expect(executedIds()).toEqual(['child_read', 'side_effect'])
    const resumed = runtimeConversationFromEvents(events.map((event) => ({ payload: event })))
    expect(
      resumed.messages.filter((message) => message.role === 'toolResult').map((message) => message.toolCallId),
    ).toEqual(['delegate_1', 'side_effect'])
  })

  it('resumes a child after its approved tool result is persisted without executing that tool again', async () => {
    const { input, events, calls } = fixture()
    let approved = false
    input.policy.approve = vi.fn(async (request) =>
      request.toolName === 'read' && !approved
        ? { allowed: false, reason: 'read approval required', requiresAction: true }
        : { allowed: true },
    )
    await expect(runTurn(input)).rejects.toThrow('read approval required')
    expect(input.executor.execute).not.toHaveBeenCalled()
    const pending = runtimeConversationFromEvents(events.map((event) => ({ payload: event })))
    expect(pending.messages.some((message) => message.role === 'toolResult')).toBe(false)
    expect(pending.subagentMessages.delegate_1?.at(-1)).toMatchObject({
      role: 'assistant',
      content: [{ type: 'toolCall', id: 'child_read', name: 'read' }],
    })
    events.push({
      type: 'message.completed',
      payload: {
        message: {
          id: 'approved_child_result',
          role: 'tool',
          parentToolCallId: 'delegate_1',
          content: [
            {
              type: 'tool_result',
              toolCallId: 'child_read',
              result: { content: text('approved private working notes') },
            },
          ],
        },
      },
    })
    approved = true
    const conversation = runtimeConversationFromEvents(events.map((event) => ({ payload: event })))
    expect(await runTurn({ ...input, ...conversation, continuation: true })).toEqual({ status: 'idle' })
    expect(input.executor.execute).not.toHaveBeenCalled()
    expect(calls.filter((call) => call.context.systemPrompt === 'child instructions')).toHaveLength(2)
    const parent = calls.filter((call) => call.context.systemPrompt === 'parent instructions').at(-1)
    expect(parent?.context.messages.find((message) => message.role === 'toolResult')).toMatchObject({
      toolCallId: 'delegate_1',
      content: text('child final answer'),
      isError: false,
    })
    expect(JSON.stringify(parent)).not.toContain('approved private working notes')
  })

  it('resumes the same pending delegation after approval without inventing an outer tool result', async () => {
    const { input, events, calls } = fixture()
    let approved = false
    input.policy.approve = vi.fn(async (request) =>
      request.toolName === 'agent' && !approved
        ? { allowed: false, reason: 'approval required', requiresAction: true }
        : { allowed: true },
    )
    await expect(runTurn(input)).rejects.toThrow('approval required')
    expect(input.executor.execute).not.toHaveBeenCalled()
    const conversation = runtimeConversationFromEvents(events.map((event) => ({ payload: event })))
    expect(conversation.messages.at(-1)).toMatchObject({
      role: 'assistant',
      content: [{ type: 'toolCall', id: 'delegate_1', name: 'agent' }],
    })
    approved = true
    expect(await runTurn({ ...input, ...conversation, continuation: true })).toEqual({ status: 'idle' })
    expect(input.executor.execute).toHaveBeenCalledOnce()
    expect(calls.filter((call) => call.context.systemPrompt === 'child instructions')).toHaveLength(2)
    const parentResults = runtimeConversationFromEvents(events.map((event) => ({ payload: event }))).messages.filter(
      (message) => message.role === 'toolResult' && message.toolCallId === 'delegate_1',
    )
    expect(parentResults).toHaveLength(1)
    expect(parentResults[0]).toMatchObject({ content: text('child final answer'), isError: false })
  })

  it('pauses inside a child and resumes its saved transcript without replaying completed tools', async () => {
    const { input, events, calls } = fixture()
    input.budget = { shouldPause: () => vi.mocked(input.executor.execute).mock.calls.length > 0 }
    expect(await runTurn(input)).toEqual({ status: 'paused' })
    const results = () =>
      events.flatMap((event) =>
        event.type === 'message.completed'
          ? event.payload.message.content.filter(
              (block) => block.type === 'tool_result' && block.toolCallId === 'delegate_1',
            )
          : [],
      )
    expect(results()).toEqual([])
    expect(input.executor.execute).toHaveBeenCalledOnce()
    const conversation = runtimeConversationFromEvents(events.map((event) => ({ payload: event })))
    expect(conversation.messages.at(-1)).toMatchObject({ role: 'assistant', stopReason: 'toolUse' })
    expect(conversation.subagentMessages.delegate_1?.at(-1)).toMatchObject({
      role: 'toolResult',
      toolCallId: 'child_read',
    })
    expect(
      await runTurn({ ...input, ...conversation, continuation: true, budget: { shouldPause: () => false } }),
    ).toEqual({ status: 'idle' })
    expect(input.executor.execute).toHaveBeenCalledOnce()
    expect(results()).toHaveLength(1)
    expect(results()[0]).toMatchObject({ result: { content: text('child final answer') } })
    expect(calls.filter((call) => call.context.systemPrompt === 'child instructions')).toHaveLength(2)
  })

  it('never passes parent or referenced child identity and nested agents into the child turn', async () => {
    const { input } = fixture()
    input.agentSnapshot.subagents = [
      {
        name: 'researcher',
        systemPrompt: 'child instructions',
        model: null,
        allowedTools: ['read'],
        identity: { id: 'child-identity' },
        subagents: [{ name: 'nested' }],
      },
    ]
    const run = vi.fn(async (_childInput: TurnEngineInput) => ({ status: 'idle' as const }))
    const tool = subagentTools(input, run, new AbortController().signal)[0]
    expect(tool).toBeDefined()
    await tool?.execute('delegate_1', { subagentName: 'researcher', prompt: 'research this' })
    expect(run).toHaveBeenCalledOnce()
    const childInput = run.mock.calls[0]?.[0]
    expect(childInput?.agentSnapshot).toMatchObject({ systemPrompt: 'child instructions', allowedTools: ['read'] })
    expect(childInput?.agentSnapshot).not.toHaveProperty('identity')
    expect(childInput?.agentSnapshot).not.toHaveProperty('subagents')
  })

  it('executes a referenced child with isolated tools and context, returning only its final answer', async () => {
    const { input, events, calls } = fixture()
    expect(await runTurn(input)).toEqual({ status: 'idle' })
    const childCalls = calls.filter((call) => call.context.systemPrompt === 'child instructions')
    expect(childCalls).toHaveLength(2)
    expect(childCalls[0]?.model.id).toBe('parent-model')
    expect(childCalls[0]?.context.tools?.map((tool) => tool.name)).toEqual(['read'])
    expect(childCalls[0]?.context.messages).toMatchObject([{ role: 'user', content: text('research this') }])
    expect(input.executor.execute).toHaveBeenCalledWith(
      expect.objectContaining({ toolName: 'read', input: { path: 'notes.txt' } }),
      expect.any(AbortSignal),
    )
    const parentContinuation = calls.filter((call) => call.context.systemPrompt === 'parent instructions').at(-1)
    const results = parentContinuation?.context.messages.filter((message) => message.role === 'toolResult')
    expect(results).toHaveLength(1)
    expect(results?.[0]).toMatchObject({
      toolCallId: 'delegate_1',
      isError: false,
      content: text('child final answer'),
    })
    expect(JSON.stringify(parentContinuation)).not.toContain('private working notes')
    expect(JSON.stringify(parentContinuation)).not.toContain('child_read')
    const childMessages = events.filter(
      (event) => event.type === 'message.completed' && event.payload.message.parentToolCallId === 'delegate_1',
    )
    expect(childMessages.length).toBeGreaterThanOrEqual(3)
    expect(JSON.stringify(childMessages)).toContain('child final answer')
  })

  it('resolves an explicitly configured child model without changing the parent model', async () => {
    const { input, calls } = fixture()
    input.agentSnapshot.subagents = [
      { name: 'researcher', systemPrompt: 'child instructions', model: 'test/child-model', allowedTools: ['read'] },
    ]
    const resolveModel = vi.fn(() => childModel)
    await runTurn({ ...input, resolveModel } as TurnEngineInput)
    expect(resolveModel).toHaveBeenCalledWith('test/child-model')
    expect(
      calls.filter((call) => call.context.systemPrompt === 'child instructions').map((call) => call.model.id),
    ).toEqual(['child-model', 'child-model'])
    expect(
      calls
        .filter((call) => call.context.systemPrompt === 'parent instructions')
        .every((call) => call.model.id === 'parent-model'),
    ).toBe(true)
  })

  it('returns an error for an unknown alias without executing any child', async () => {
    const { input, calls } = fixture()
    input.agentSnapshot.subagents = [{ name: 'other', systemPrompt: 'child instructions', allowedTools: ['read'] }]
    await runTurn(input)
    const result = calls.at(-1)?.context.messages.find((message) => message.role === 'toolResult')
    expect(result).toMatchObject({ toolCallId: 'delegate_1', isError: true })
    expect(JSON.stringify(result)).toMatch(/unknown.*subagent/i)
    expect(input.executor.execute).not.toHaveBeenCalled()
  })

  it('enforces policy before starting a child', async () => {
    const { input, calls, events } = fixture()
    input.policy.approve = vi.fn(async () => ({ allowed: false, reason: 'delegation blocked' }))
    await expect(runTurn(input)).rejects.toThrow('delegation blocked')
    expect(input.policy.approve).toHaveBeenCalledWith(
      expect.objectContaining({ toolName: 'agent', input: expect.objectContaining({ subagentName: 'researcher' }) }),
    )
    expect(calls.every((call) => call.context.systemPrompt === 'parent instructions')).toBe(true)
    expect(input.executor.execute).not.toHaveBeenCalled()
    const results = events.flatMap((event) =>
      event.type === 'message.completed'
        ? event.payload.message.content.filter((block) => block.type === 'tool_result')
        : [],
    )
    expect(results).toHaveLength(1)
    expect(results[0]).toMatchObject({ toolCallId: 'delegate_1', error: { message: 'delegation blocked' } })
  })

  it('cancels an in-flight child when the parent signal aborts', async () => {
    const { input } = fixture()
    const controller = new AbortController()
    input.signal = controller.signal
    const originalComplete = input.modelClient.complete
    let childSignal: AbortSignal | undefined
    input.modelClient.complete = async (selectedModel, context, signal) => {
      if (context.systemPrompt === 'child instructions') {
        childSignal = signal
        controller.abort()
        return assistantMessage(selectedModel, text('must not complete'), 'stop', ZERO_USAGE)
      }
      return originalComplete(selectedModel, context, signal)
    }
    expect(await runTurn(input)).toEqual({ status: 'aborted' })
    expect(childSignal?.aborted).toBe(true)
    expect(input.executor.execute).not.toHaveBeenCalled()
  })

  it('fails the parent turn when a child tool is denied without reporting a successful parent completion', async () => {
    const { input, events } = fixture()
    input.policy.approve = vi.fn(async (request) =>
      request.toolName === 'read' ? { allowed: false, reason: 'child read blocked' } : { allowed: true },
    )
    await expect(runTurn(input)).rejects.toThrow('child read blocked')
    expect(input.executor.execute).not.toHaveBeenCalled()
    const parentCompletions = events.filter(
      (event) =>
        event.type === 'message.completed' &&
        !event.payload.message.parentToolCallId &&
        JSON.stringify(event.payload.message.content).includes('parent final answer'),
    )
    expect(parentCompletions).toEqual([])
  })
})
