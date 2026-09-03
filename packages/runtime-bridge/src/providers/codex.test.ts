import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
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

vi.mock('../host/cli', () => ({ resolveCliPath: () => undefined }))

vi.mock('./cli-host', () => ({
  arrayValue: (value: unknown) => (Array.isArray(value) ? value : []),
  hostHome: (env: Record<string, string>) => env.ENBOR_RUNTIME_BRIDGE_HOST_HOME,
  normalizeProviderUsage: (value: Record<string, unknown>) => value,
  objectValue: (value: unknown) => (value && typeof value === 'object' && !Array.isArray(value) ? value : {}),
  sdkEnv: (request: RuntimeProviderRequest) => {
    const hostHome = request.env.ENBOR_RUNTIME_BRIDGE_HOST_HOME
    return hostHome
      ? {
          ...request.env,
          HOME: hostHome,
          ENBOR_WORKSPACE_HOME: request.env.HOME,
          GH_CONFIG_DIR: `${request.env.HOME}/.config/gh`,
          GIT_CONFIG_GLOBAL: `${request.env.HOME}/.gitconfig`,
          GIT_CONFIG_NOSYSTEM: '1',
        }
      : request.env
  },
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
      skills: ['saltbo/downstream-service@downstream-operator'],
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
      id: 'fc_spawn_1',
      call_id: 'call_spawn_1',
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
      id: 'fc_wait_1',
      call_id: 'call_wait_1',
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

async function* collabSubagentEvents() {
  yield {
    type: 'item.started',
    item: {
      id: 'collab_spawn_1',
      type: 'collab_tool_call',
      tool: 'spawn_agent',
      sender_thread_id: 'thread_parent',
      receiver_thread_ids: [],
      prompt: 'Review the patch',
      agents_states: {},
      status: 'in_progress',
    },
  }
  yield {
    type: 'item.completed',
    item: {
      id: 'collab_spawn_1',
      type: 'collab_tool_call',
      tool: 'spawn_agent',
      sender_thread_id: 'thread_parent',
      receiver_thread_ids: ['agent_1'],
      prompt: 'Review the patch',
      agents_states: { agent_1: { status: 'pending_init' } },
      status: 'completed',
    },
  }
  yield {
    type: 'item.completed',
    item: {
      id: 'collab_wait_1',
      type: 'collab_tool_call',
      tool: 'wait',
      sender_thread_id: 'thread_parent',
      receiver_thread_ids: ['agent_1'],
      agents_states: { agent_1: { status: 'completed', message: 'Review passed.' } },
      status: 'completed',
    },
  }
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
  vi.unstubAllEnvs()
})

describe('codexProvider', () => {
  it('[spec: runtime/provider-permission-policy] applies runner-owned Codex permission settings', async () => {
    vi.stubEnv('ENBOR_CODEX_SANDBOX_MODE', 'workspace-write')
    vi.stubEnv('ENBOR_CODEX_APPROVAL_POLICY', 'on-request')
    runStreamedMock.mockResolvedValue({ events: events() })
    startThreadMock.mockReturnValue({ runStreamed: runStreamedMock })

    const handle = await codexProvider.execute(request())
    for await (const _event of handle.events) {
      // drain
    }

    expect(startThreadMock).toHaveBeenCalledWith(
      expect.objectContaining({ sandboxMode: 'workspace-write', approvalPolicy: 'on-request' }),
    )
  })

  it('passes agent system prompt through Codex developer instructions without prefixing the user prompt', async () => {
    runStreamedMock.mockResolvedValue({ events: events() })
    startThreadMock.mockReturnValue({ runStreamed: runStreamedMock })

    const handle = await codexProvider.execute(request())

    expect(codexConstructorMock).toHaveBeenCalledWith({
      env: { HOME: '/home/agent' },
      config: {
        features: { apps: false, multi_agent: true, unified_exec: false },
        allow_login_shell: false,
        shell_environment_policy: {
          inherit: 'all',
          set: { HOME: '/home/agent' },
        },
        developer_instructions: expect.stringContaining('SYSTEM_PROMPT'),
      },
    })
    const firstCall = codexConstructorMock.mock.calls[0]
    expect(firstCall).toBeDefined()
    const codexOptions = firstCall![0] as {
      config: { developer_instructions: string }
    }
    expect(codexOptions.config.developer_instructions).toContain(
      'Skills: saltbo/downstream-service@downstream-operator',
    )
    expect(codexOptions.config.developer_instructions).toContain(
      'Available subagents: @reviewer (Reviews pull requests)',
    )
    expect(codexOptions.config.developer_instructions).toContain(
      'When spawning a configured named subagent, set fork_turns to "none"',
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

  it('passes an explicitly configured model when the host uses ChatGPT authentication', async () => {
    const hostHome = mkdtempSync(join(tmpdir(), 'enbor-codex-provider-'))
    mkdirSync(join(hostHome, '.codex'))
    writeFileSync(join(hostHome, '.codex', 'auth.json'), JSON.stringify({ tokens: { access_token: 'test-token' } }))
    runStreamedMock.mockResolvedValue({ events: events() })
    startThreadMock.mockReturnValue({ runStreamed: runStreamedMock })

    try {
      const handle = await codexProvider.execute(
        request({
          env: { HOME: '/home/agent', ENBOR_RUNTIME_BRIDGE_HOST_HOME: hostHome },
          model: 'gpt-5.3-codex-spark',
        }),
      )
      for await (const _event of handle.events) {
        // drain
      }

      expect(startThreadMock).toHaveBeenCalledWith(expect.objectContaining({ model: 'gpt-5.3-codex-spark' }))
    } finally {
      rmSync(hostHome, { recursive: true, force: true })
    }
  })

  it('[spec: runtime/codex-shell-isolation] keeps Codex authentication on the host home and shell tools in the session environment', async () => {
    runStreamedMock.mockResolvedValue({ events: events() })
    startThreadMock.mockReturnValue({ runStreamed: runStreamedMock })

    const handle = await codexProvider.execute(
      request({
        env: {
          HOME: '/session/home',
          TMPDIR: '/session/tmp',
          TEMP: '/session/tmp',
          TMP: '/session/tmp',
          ENBOR_RUNTIME_BRIDGE_HOST_HOME: '/host/home',
        },
      }),
    )
    for await (const _event of handle.events) {
      // drain
    }

    expect(codexConstructorMock).toHaveBeenCalledWith({
      env: expect.objectContaining({
        HOME: '/host/home',
        ENBOR_WORKSPACE_HOME: '/session/home',
        GH_CONFIG_DIR: '/session/home/.config/gh',
        GIT_CONFIG_GLOBAL: '/session/home/.gitconfig',
      }),
      config: expect.objectContaining({
        allow_login_shell: false,
        shell_environment_policy: {
          inherit: 'all',
          set: {
            HOME: '/session/home',
            TMPDIR: '/session/tmp',
            TEMP: '/session/tmp',
            TMP: '/session/tmp',
          },
        },
      }),
    })
  })

  it('normalizes Codex command output into Enbor tool results', async () => {
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

  it('keeps Enbor message ids unique when Codex reuses text item ids across turns', async () => {
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

  it('normalizes Codex sub-agent functions to the canonical Enbor agent tool contract', async () => {
    runStreamedMock.mockResolvedValue({ events: subagentFunctionEvents() })
    startThreadMock.mockReturnValue({ runStreamed: runStreamedMock })

    const handle = await codexProvider.execute(request())
    const events = []
    for await (const event of handle.events) {
      events.push(event)
    }

    expect(JSON.stringify(events)).not.toContain('spawn_agent')
    expect(JSON.stringify(events)).not.toContain('wait_agent')
    expect(JSON.stringify(events)).not.toContain('fc_spawn_1')
    expect(JSON.stringify(events)).not.toContain('fc_wait_1')
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
    expect(JSON.stringify(events)).not.toContain('Inspecting the patch.')
    expect(JSON.stringify(events)).not.toContain('call_child_1')
  })

  it('normalizes Codex live collab tool calls to the canonical Enbor agent tool contract', async () => {
    runStreamedMock.mockResolvedValue({ events: collabSubagentEvents() })
    startThreadMock.mockReturnValue({ runStreamed: runStreamedMock })

    const handle = await codexProvider.execute(request())
    const events = []
    for await (const event of handle.events) {
      events.push(event)
    }

    expect(JSON.stringify(events)).not.toContain('"spawn_agent"')
    expect(JSON.stringify(events)).not.toContain('"wait"')
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
                    id: 'collab_spawn_1',
                    name: 'agent',
                    input: { prompt: 'Review the patch' },
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
              parentToolCallId: 'collab_spawn_1',
              content: [
                {
                  type: 'tool_result',
                  toolCallId: 'collab_spawn_1',
                  result: {
                    content: [{ type: 'text', text: 'Review passed.' }],
                    structuredContent: {
                      agentId: 'agent_1',
                      status: 'completed',
                      provider: 'codex',
                      rawStatus: { status: 'completed', message: 'Review passed.' },
                    },
                  },
                },
              ],
            }),
          },
        }),
      ]),
    )
  })

  it('emits raw Codex SDK stream events for rebuild sidecar capture', async () => {
    runStreamedMock.mockResolvedValue({ events: commandEvents() })
    startThreadMock.mockReturnValue({ runStreamed: runStreamedMock })
    const providerEvents: Record<string, unknown>[] = []

    const handle = await codexProvider.execute(request({ emitProviderEvent: (event) => providerEvents.push(event) }))
    for await (const _event of handle.events) {
      // drain
    }

    expect(providerEvents).toEqual([
      expect.objectContaining({ type: 'turn.started' }),
      expect.objectContaining({ type: 'item.started' }),
      expect.objectContaining({ type: 'item.completed' }),
    ])
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
