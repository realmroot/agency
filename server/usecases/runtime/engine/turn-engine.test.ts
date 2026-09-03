import type { AssistantMessage, Model } from '@earendil-works/pi-ai'
import { describe, expect, it, vi } from 'vitest'
import { RuntimeTurnCancelledError } from './errors'
import type {
  ModelClient,
  RuntimeEventSink,
  ToolExecutionResult,
  ToolExecutor,
  ToolPolicyGate,
  ToolResultResolver,
  TurnLiveness,
} from './ports'
import { assistantMessage, emitAssistantMessage, ensureTurnActive, runTurn, ZERO_USAGE } from './turn-engine'

const model = { api: 'test', provider: 'test', id: 'test-model' } as unknown as Model<string>

// A fake stream that records every pushed event so we can assert contentIndex
// correlation without spinning up the real pi-ai event stream.
function recordingStream() {
  const events: Array<Record<string, unknown>> = []
  return {
    events,
    stream: {
      push: (event: Record<string, unknown>) => events.push(event),
      end: () => {},
    } as never,
  }
}

describe('Enbor runtime turn-engine', () => {
  it('correlates contentIndex to the partial content slot, not the source index [spec: runtime/turn]', () => {
    const { events, stream } = recordingStream()
    const content = [
      { type: 'text', text: 'first' },
      { type: 'toolCall', id: 'tc_1', name: 'bash', arguments: { command: 'ls' } },
    ] as unknown as AssistantMessage['content']

    emitAssistantMessage(stream, assistantMessage(model, content, 'stop', ZERO_USAGE))

    const indexed = events.filter((e) => typeof e.contentIndex === 'number')
    expect(indexed.find((e) => e.type === 'text_start')?.contentIndex).toBe(0)
    expect(indexed.find((e) => e.type === 'toolcall_start')?.contentIndex).toBe(1)
    // Every block's start/delta/end share one contentIndex and they are monotonic.
    expect(indexed.filter((e) => e.type === 'text_delta')[0]?.contentIndex).toBe(0)
    expect(indexed.filter((e) => e.type === 'toolcall_end')[0]?.contentIndex).toBe(1)
  })

  it('does not desync contentIndex when a leading block is skipped', () => {
    const { events, stream } = recordingStream()
    // A falsy/unknown leading block is skipped; the text block must still land at
    // partial index 0 (the pre-fix code used the source index 1 and wrote to an
    // undefined slot).
    const content = [null, { type: 'text', text: 'kept' }] as unknown as AssistantMessage['content']

    expect(() => emitAssistantMessage(stream, assistantMessage(model, content, 'stop', ZERO_USAGE))).not.toThrow()

    const textStart = events.find((e) => e.type === 'text_start')
    expect(textStart?.contentIndex).toBe(0)
    const textDelta = events.find((e) => e.type === 'text_delta')
    expect((textDelta?.partial as AssistantMessage).content[0]).toMatchObject({ type: 'text', text: 'kept' })
  })

  it('ensureTurnActive throws when the passed signal is already aborted', async () => {
    const ensureActive = vi.fn(async () => {})
    await expect(ensureTurnActive(AbortSignal.abort(), ensureActive)).rejects.toBeInstanceOf(RuntimeTurnCancelledError)
    expect(ensureActive).not.toHaveBeenCalled()
  })

  it('ensureTurnActive runs the liveness check for a live signal', async () => {
    const ensureActive = vi.fn(async () => {})
    await ensureTurnActive(new AbortController().signal, ensureActive)
    expect(ensureActive).toHaveBeenCalledTimes(1)
  })

  it('aborts the run when the external input.signal is already aborted', async () => {
    const sink: RuntimeEventSink = { emit: vi.fn(async () => {}) }
    const executor: ToolExecutor = {
      execute: vi.fn(
        async (): Promise<ToolExecutionResult> => ({
          toolCallId: 'x',
          toolName: 'bash',
          output: { stdout: '', stderr: '', exitCode: 0 },
          error: null,
          durationMs: 0,
        }),
      ),
    }
    const modelClient: ModelClient = { complete: vi.fn(async () => assistantMessage(model, [], 'stop', ZERO_USAGE)) }
    const policy: ToolPolicyGate = { approve: vi.fn(async () => ({ allowed: true })) }
    const toolResults: ToolResultResolver = { resolve: vi.fn(async () => null) }
    const liveness: TurnLiveness = { ensureActive: vi.fn(async () => {}) }

    const result = await runTurn({
      sessionId: 'session_1',
      sandboxId: 'sandbox_1',
      model,
      providerLabel: 'test',
      modelLabel: 'test-model',
      agentSnapshot: { systemPrompt: 'noop', allowedTools: [] },
      prompt: 'do nothing',
      sink,
      policy,
      toolResults,
      liveness,
      executor,
      modelClient,
      signal: AbortSignal.abort(),
    })

    expect(result).toEqual({ status: 'aborted' })
    // The model is never invoked once the external signal pre-aborts the run.
    expect(modelClient.complete).not.toHaveBeenCalled()
  })

  it('keeps one message id across a streamed assistant message lifecycle', async () => {
    const events: Array<Parameters<RuntimeEventSink['emit']>[0]> = []
    const sink: RuntimeEventSink = {
      emit: vi.fn(async (event) => {
        events.push(event)
      }),
    }
    const executor: ToolExecutor = {
      execute: vi.fn(
        async (): Promise<ToolExecutionResult> => ({
          toolCallId: 'x',
          toolName: 'bash',
          output: { stdout: '', stderr: '', exitCode: 0 },
          error: null,
          durationMs: 0,
        }),
      ),
    }
    const modelClient: ModelClient = {
      complete: vi.fn(async () =>
        assistantMessage(model, [{ type: 'text', text: 'hello' }] as unknown as AssistantMessage['content'], 'stop', {
          ...ZERO_USAGE,
          input: 1,
          output: 1,
          totalTokens: 2,
        }),
      ),
    }
    const policy: ToolPolicyGate = { approve: vi.fn(async () => ({ allowed: true })) }
    const toolResults: ToolResultResolver = { resolve: vi.fn(async () => null) }
    const liveness: TurnLiveness = { ensureActive: vi.fn(async () => {}) }

    await runTurn({
      sessionId: 'session_1',
      sandboxId: 'sandbox_1',
      model,
      providerLabel: 'test',
      modelLabel: 'test-model',
      agentSnapshot: { systemPrompt: 'noop', allowedTools: [] },
      prompt: 'say hello',
      sink,
      policy,
      toolResults,
      liveness,
      executor,
      modelClient,
    })

    const assistantMessages = events.filter(
      (
        event,
      ): event is Extract<
        Parameters<RuntimeEventSink['emit']>[0],
        { type: 'message.started' | 'message.updated' | 'message.completed' }
      > =>
        (event.type === 'message.started' || event.type === 'message.updated' || event.type === 'message.completed') &&
        event.payload.message.role === 'assistant',
    )
    expect(assistantMessages[0]?.type).toBe('message.started')
    expect(assistantMessages.at(-1)?.type).toBe('message.completed')
    expect(assistantMessages.some((event) => event.type === 'message.updated')).toBe(true)
    expect(new Set(assistantMessages.map((event) => event.payload.message.id)).size).toBe(1)
  })
})
