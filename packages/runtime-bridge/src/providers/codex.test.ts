import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RuntimeProviderRequest } from '../protocol'

const codexConstructorMock = vi.hoisted(() => vi.fn())
const startThreadMock = vi.hoisted(() => vi.fn())
const resumeThreadMock = vi.hoisted(() => vi.fn())
const runStreamedMock = vi.hoisted(() => vi.fn())

vi.mock('@openai/codex-sdk', () => ({
  Codex: class {
    constructor(options: unknown) {
      codexConstructorMock(options)
    }

    startThread(options: unknown) {
      return startThreadMock(options)
    }

    resumeThread(id: string, options: unknown) {
      return resumeThreadMock(id, options)
    }
  },
}))

vi.mock('./cli-host', () => ({
  arrayValue: (value: unknown) => (Array.isArray(value) ? value : []),
  hostHome: (env: Record<string, string>) => env.AMA_RUNTIME_BRIDGE_HOST_HOME,
  normalizeProviderUsage: (value: Record<string, unknown>) => value,
  objectValue: (value: unknown) => (value && typeof value === 'object' && !Array.isArray(value) ? value : {}),
  resolveCliPath: () => undefined,
  sdkEnv: (request: RuntimeProviderRequest) => request.env,
}))

const { codexProvider } = await import('./codex')

function request(overrides: Partial<RuntimeProviderRequest> = {}): RuntimeProviderRequest {
  return {
    type: 'run',
    requestId: 'req_1',
    runtime: 'codex',
    sessionId: 'session_1',
    cwd: '/workspace',
    env: { HOME: '/home/agent' },
    prompt: 'USER_TASK',
    agentSnapshot: {
      systemPrompt: 'SYSTEM_PROMPT',
      skills: ['saltbo/agent-kanban@ak-maintainer'],
      subagents: [{ name: 'reviewer', description: 'Reviews pull requests' }],
    },
    ...overrides,
  }
}

async function* events() {
  yield { type: 'thread.started', thread_id: 'thread_1' }
  yield { type: 'turn.completed', usage: { input_tokens: 1, cached_input_tokens: 0, output_tokens: 1 } }
}

async function* usageEvents() {
  yield {
    type: 'turn.completed',
    usage: { input_tokens: 2, cached_input_tokens: 1, output_tokens: 3 },
  }
}

async function* commandEvents() {
  yield { type: 'turn.started' }
  yield {
    type: 'item.started',
    item: {
      id: 'item_1',
      type: 'command_execution',
      command: "printf 'ok'",
      aggregated_output: '',
      status: 'in_progress',
    },
  }
  yield {
    type: 'item.completed',
    item: {
      id: 'item_1',
      type: 'command_execution',
      command: "printf 'ok'",
      aggregated_output: 'ok',
      exit_code: 0,
      status: 'completed',
    },
  }
}

async function* fileChangeEvents() {
  yield {
    type: 'item.started',
    item: {
      id: 'item_file_1',
      type: 'file_change',
      changes: [{ kind: 'update', path: 'src/app.ts' }],
    },
  }
  yield {
    type: 'item.completed',
    item: {
      id: 'item_file_1',
      type: 'file_change',
      changes: [{ kind: 'update', path: 'src/app.ts' }],
    },
  }
}

async function* subagentFunctionEvents() {
  yield {
    type: 'item.completed',
    item: {
      id: 'call_spawn_1',
      type: 'function_call',
      name: 'spawn_agent',
      arguments: JSON.stringify({
        agent_type: 'reviewer',
        message: 'Check this change',
        reasoning_effort: 'medium',
      }),
    },
  }
  yield {
    type: 'item.completed',
    item: {
      call_id: 'call_spawn_1',
      type: 'function_call_output',
      output: JSON.stringify({ agent_id: 'agent_1', nickname: 'Raman' }),
    },
  }
  yield {
    type: 'item.completed',
    item: {
      id: 'call_wait_1',
      type: 'function_call',
      name: 'wait_agent',
      arguments: JSON.stringify({ targets: ['agent_1'], timeout_ms: 60_000 }),
    },
  }
  yield {
    type: 'item.completed',
    item: {
      call_id: 'call_wait_1',
      type: 'function_call_output',
      output: JSON.stringify({ status: { agent_1: { completed: 'Review passed.' } }, timed_out: false }),
    },
  }
}

function writeCodexChildSession(home: string, agentId: string) {
  const sessionDir = join(home, '.codex', 'sessions', '2026', '07', '03')
  mkdirSync(sessionDir, { recursive: true })
  writeFileSync(
    join(sessionDir, `rollout-2026-07-03T12-00-00-${agentId}.jsonl`),
    [
      JSON.stringify({
        timestamp: '2026-07-03T12:00:00.000Z',
        type: 'session_meta',
        payload: {
          id: agentId,
          thread_source: 'subagent',
          source: { subagent: { thread_spawn: { parent_thread_id: 'thread_1' } } },
        },
      }),
      JSON.stringify({
        timestamp: '2026-07-03T12:00:01.000Z',
        type: 'response_item',
        payload: {
          type: 'message',
          role: 'assistant',
          content: [{ type: 'output_text', text: 'Inspecting the patch.' }],
        },
      }),
      JSON.stringify({
        timestamp: '2026-07-03T12:00:02.000Z',
        type: 'response_item',
        payload: {
          type: 'function_call',
          call_id: 'call_child_1',
          name: 'exec_command',
          arguments: JSON.stringify({ cmd: 'pnpm test' }),
        },
      }),
      JSON.stringify({
        timestamp: '2026-07-03T12:00:03.000Z',
        type: 'response_item',
        payload: {
          type: 'function_call_output',
          call_id: 'call_child_1',
          output: 'tests passed',
        },
      }),
    ].join('\n'),
  )
}

async function* repeatedCommandEvents() {
  yield* commandEvents()
  yield { type: 'turn.completed' }
  yield* commandEvents()
}

async function* repeatedAgentMessageEvents() {
  yield { type: 'turn.started' }
  yield {
    type: 'item.completed',
    item: {
      id: 'item_1',
      type: 'agent_message',
      text: 'first turn',
    },
  }
  yield {
    type: 'item.completed',
    item: {
      id: 'item_2',
      type: 'reasoning',
      text: 'first reasoning',
    },
  }
  yield { type: 'turn.completed' }
  yield { type: 'turn.started' }
  yield {
    type: 'item.completed',
    item: {
      id: 'item_1',
      type: 'agent_message',
      text: 'second turn',
    },
  }
  yield {
    type: 'item.completed',
    item: {
      id: 'item_2',
      type: 'reasoning',
      text: 'second reasoning',
    },
  }
}

afterEach(() => {
  codexConstructorMock.mockClear()
  startThreadMock.mockClear()
  resumeThreadMock.mockClear()
  runStreamedMock.mockClear()
})

describe('codexProvider', () => {
  it('passes agent system prompt through Codex developer instructions without prefixing the user prompt', async () => {
    runStreamedMock.mockResolvedValue({ events: events() })
    startThreadMock.mockReturnValue({ runStreamed: runStreamedMock })

    const handle = await codexProvider.execute(request())

    expect(codexConstructorMock).toHaveBeenCalledWith({
      env: { HOME: '/home/agent' },
      config: {
        features: { apps: false },
        developer_instructions: expect.stringContaining('SYSTEM_PROMPT'),
      },
    })
    const firstCall = codexConstructorMock.mock.calls[0]
    expect(firstCall).toBeDefined()
    const codexOptions = firstCall![0] as {
      config: { developer_instructions: string }
    }
    expect(codexOptions.config.developer_instructions).toContain('Skills: saltbo/agent-kanban@ak-maintainer')
    expect(codexOptions.config.developer_instructions).toContain(
      'Available subagents: @reviewer (Reviews pull requests)',
    )
    expect(codexOptions.config).not.toHaveProperty('instructions')
    for await (const _event of handle.events) {
      // drain the stream so async generator cleanup runs
    }
    expect(runStreamedMock).toHaveBeenCalledWith('USER_TASK', { signal: expect.any(AbortSignal) })
  })

  it('continues the same Codex thread for injected prompts', async () => {
    runStreamedMock.mockResolvedValueOnce({ events: events() }).mockResolvedValueOnce({ events: events() })
    startThreadMock.mockReturnValue({ runStreamed: runStreamedMock })

    const handle = await codexProvider.execute(request({ runtimeConfig: { codexIdleKeepAliveMs: 10 } }))
    const drained = (async () => {
      for await (const _event of handle.events) {
        // drain events
      }
    })()
    await handle.send('FOLLOW_UP')
    await drained

    expect(startThreadMock).toHaveBeenCalledTimes(1)
    expect(runStreamedMock).toHaveBeenNthCalledWith(1, 'USER_TASK', { signal: expect.any(AbortSignal) })
    expect(runStreamedMock).toHaveBeenNthCalledWith(2, 'FOLLOW_UP', { signal: expect.any(AbortSignal) })
  })

  it('normalizes Codex command output into AMA tool results', async () => {
    runStreamedMock.mockResolvedValue({ events: commandEvents() })
    startThreadMock.mockReturnValue({ runStreamed: runStreamedMock })

    const handle = await codexProvider.execute(request())
    const events = []
    for await (const event of handle.events) {
      events.push(event)
    }

    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'message.completed',
          payload: {
            message: expect.objectContaining({
              role: 'assistant',
              content: [
                {
                  type: 'tool_call',
                  toolCall: { id: 'item_1', name: 'bash', input: { command: "printf 'ok'" } },
                },
              ],
            }),
          },
        }),
        expect.objectContaining({
          type: 'message.completed',
          payload: {
            message: expect.objectContaining({
              role: 'tool',
              parentToolCallId: 'item_1',
              content: [
                {
                  type: 'tool_result',
                  toolCallId: 'item_1',
                  result: {
                    content: [{ type: 'text', text: 'ok' }],
                    structuredContent: { aggregatedOutput: 'ok' },
                    exitCode: 0,
                  },
                },
              ],
            }),
          },
        }),
      ]),
    )
  })

  it('preserves reused Codex item ids from the SDK', async () => {
    runStreamedMock.mockResolvedValue({ events: repeatedCommandEvents() })
    startThreadMock.mockReturnValue({ runStreamed: runStreamedMock })

    const handle = await codexProvider.execute(request())
    const events = []
    for await (const event of handle.events) {
      events.push(event)
    }

    const toolCallIds = events
      .flatMap((event) => (event.payload as { message?: { content?: unknown[] } }).message?.content ?? [])
      .flatMap((block) => {
        const value = block as { type?: string; toolCall?: { id?: string }; toolCallId?: string }
        if (value.type === 'tool_call') return [value.toolCall?.id]
        if (value.type === 'tool_result') return [value.toolCallId]
        return []
      })

    expect(toolCallIds).toEqual(['item_1', 'item_1', 'item_1', 'item_1'])
  })

  it('keeps AMA message ids unique when Codex reuses text item ids across turns', async () => {
    runStreamedMock.mockResolvedValue({ events: repeatedAgentMessageEvents() })
    startThreadMock.mockReturnValue({ runStreamed: runStreamedMock })

    const handle = await codexProvider.execute(request())
    const events = []
    for await (const event of handle.events) {
      events.push(event)
    }

    const messages = events
      .map((event) => (event.payload as { message?: { id?: string; providerMessageId?: string } }).message)
      .filter((message): message is { id: string; providerMessageId?: string } => Boolean(message))

    expect(messages.map((message) => message.providerMessageId)).toEqual(['item_1', 'item_2', 'item_1', 'item_2'])
    expect(new Set(messages.map((message) => message.id)).size).toBe(messages.length)
    expect(messages.map((message) => message.id)).not.toContain('item_1')
    expect(messages.map((message) => message.id)).not.toContain('item_2')
  })

  it('does not map Codex file change observations to tool calls', async () => {
    runStreamedMock.mockResolvedValue({ events: fileChangeEvents() })
    startThreadMock.mockReturnValue({ runStreamed: runStreamedMock })

    const handle = await codexProvider.execute(request())
    const events = []
    for await (const event of handle.events) {
      events.push(event)
    }

    expect(events).toEqual([])
  })

  it('normalizes Codex sub-agent functions to the canonical AMA agent tool contract', async () => {
    const home = mkdtempSync(join(tmpdir(), 'codex-home-'))
    writeCodexChildSession(home, 'agent_1')
    runStreamedMock.mockResolvedValue({ events: subagentFunctionEvents() })
    startThreadMock.mockReturnValue({ runStreamed: runStreamedMock })

    const handle = await codexProvider.execute(
      request({ env: { HOME: '/home/agent', AMA_RUNTIME_BRIDGE_HOST_HOME: home } }),
    )
    const events = []
    for await (const event of handle.events) {
      events.push(event)
    }

    expect(JSON.stringify(events)).not.toContain('spawn_agent')
    expect(JSON.stringify(events)).not.toContain('wait_agent')
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'message.completed',
          payload: {
            message: expect.objectContaining({
              role: 'assistant',
              content: [
                {
                  type: 'tool_call',
                  toolCall: {
                    id: 'call_spawn_1',
                    name: 'agent',
                    input: { prompt: 'Check this change', subagentName: 'reviewer' },
                  },
                },
              ],
            }),
          },
        }),
        expect.objectContaining({
          type: 'message.completed',
          payload: {
            message: expect.objectContaining({
              role: 'tool',
              parentToolCallId: 'call_spawn_1',
              content: [
                {
                  type: 'tool_result',
                  toolCallId: 'call_spawn_1',
                  result: {
                    content: [{ type: 'text', text: 'Review passed.' }],
                    structuredContent: {
                      agentId: 'agent_1',
                      status: 'completed',
                      provider: 'codex',
                      rawStatus: { completed: 'Review passed.' },
                    },
                  },
                },
              ],
            }),
          },
        }),
      ]),
    )
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'message.completed',
          payload: {
            message: expect.objectContaining({
              role: 'assistant',
              parentToolCallId: 'call_spawn_1',
              content: [{ type: 'text', text: 'Inspecting the patch.' }],
            }),
          },
        }),
        expect.objectContaining({
          type: 'message.completed',
          payload: {
            message: expect.objectContaining({
              role: 'assistant',
              parentToolCallId: 'call_spawn_1',
              content: [
                {
                  type: 'tool_call',
                  toolCall: { id: 'call_child_1', name: 'bash', input: { command: 'pnpm test' } },
                },
              ],
            }),
          },
        }),
        expect.objectContaining({
          type: 'message.completed',
          payload: {
            message: expect.objectContaining({
              role: 'tool',
              parentToolCallId: 'call_child_1',
              content: [
                {
                  type: 'tool_result',
                  toolCallId: 'call_child_1',
                  result: {
                    content: [{ type: 'text', text: 'tests passed' }],
                    structuredContent: { output: 'tests passed' },
                  },
                },
              ],
            }),
          },
        }),
      ]),
    )
  })

  it('does not emit model usage when Codex SDK events do not report the actual model', async () => {
    runStreamedMock.mockResolvedValue({ events: usageEvents() })
    startThreadMock.mockReturnValue({ runStreamed: runStreamedMock })

    const handle = await codexProvider.execute(request({ provider: 'workers-ai', model: 'configured-model' }))
    const events = []
    for await (const event of handle.events) {
      events.push(event)
    }

    expect(events.some((event) => event.type === 'usage.recorded')).toBe(false)
    expect(JSON.stringify(events)).not.toContain('workers-ai')
    expect(JSON.stringify(events)).not.toContain('configured-model')
  })
})
