import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Env } from '../../env'

const { getSandboxMock, mockExecutor, mockSandbox, toolExecutorMock } = vi.hoisted(() => {
  const mockSandbox = {
    exec: vi.fn(),
    writeFile: vi.fn(),
    setEnvVars: vi.fn(),
  }
  const mockExecutor = {
    execute: vi.fn(),
    stop: vi.fn(),
  }
  return {
    getSandboxMock: vi.fn(() => mockSandbox),
    mockExecutor,
    mockSandbox,
    toolExecutorMock: vi.fn(() => mockExecutor),
  }
})

vi.mock('@cloudflare/sandbox', () => ({
  getSandbox: getSandboxMock,
}))

vi.mock('./sandbox-tool-executor', () => ({
  toolExecutor: toolExecutorMock,
}))

import {
  executeRuntimeToolCalls,
  RuntimeTurnCancelledError,
  runSessionTurn,
  runtimeMessagesFromEvents,
  runtimeToolCalls,
  startSessionRuntime,
  stopSessionRuntime,
  workspaceVolumeManifest,
} from './sandbox-runtime-host'

describe('session-runtime', () => {
  beforeEach(() => {
    mockExecutor.execute.mockReset()
    mockExecutor.stop.mockReset()
    mockSandbox.exec.mockReset()
    mockSandbox.exec.mockResolvedValue({ exitCode: 0, stdout: '', stderr: '' })
    mockSandbox.writeFile.mockReset()
    mockSandbox.setEnvVars.mockReset()
    getSandboxMock.mockClear()
    toolExecutorMock.mockClear()
  })

  it('extracts only object tool calls from runtime command bodies', () => {
    expect(runtimeToolCalls(null)).toEqual([])
    expect(runtimeToolCalls({})).toEqual([])
    expect(
      runtimeToolCalls({
        toolCalls: [null, 'bad', { id: 'tool_1', name: 'bash' }],
      }),
    ).toEqual([{ id: 'tool_1', name: 'bash' }])
  })

  it('dispatches runtime tool calls through the configured executor', async () => {
    mockExecutor.execute.mockResolvedValueOnce({
      toolCallId: 'call_git_status',
      toolName: 'bash',
      output: { stdout: 'clean', stderr: '', exitCode: 0 },
      error: null,
      durationMs: 42,
    })

    const results = await executeRuntimeToolCalls({ AMA_RUNTIME_MODE: 'test' } as Env, {
      sessionId: 'session_123',
      sandboxId: 'sandbox_123',
      body: {
        toolCalls: [
          {
            id: 'call_git_status',
            name: 'bash',
            input: { command: 'git status' },
          },
        ],
      },
    })

    expect(toolExecutorMock).toHaveBeenCalledTimes(1)
    expect(mockExecutor.execute).toHaveBeenNthCalledWith(1, {
      sessionId: 'session_123',
      sandboxId: 'sandbox_123',
      toolCallId: 'call_git_status',
      toolName: 'bash',
      input: { command: 'git status' },
      cwd: '/workspace',
    })
    expect(results).toEqual([
      {
        toolCallId: 'call_git_status',
        toolName: 'bash',
        output: { stdout: 'clean', stderr: '', exitCode: 0 },
        error: null,
        durationMs: 42,
      },
    ])
  })

  it('returns cloud-owned runtime metadata in test mode', async () => {
    await expect(
      startSessionRuntime({ AMA_RUNTIME_MODE: 'test' } as Env, {
        sessionId: 'session_123',
        sandboxId: 'sandbox_123',
        provider: 'workers-ai',
        model: '@cf/moonshotai/kimi-k2.6',
        agentSnapshot: { systemPrompt: 'Test runtime' },
        environmentSnapshot: { runtimeConfig: { image: 'ama-tool-executor' } },
      }),
    ).resolves.toMatchObject({
      sandboxId: 'sandbox_123',
      metadata: expect.objectContaining({
        runtimeMode: 'test',
        runtimeDriver: 'ama-cloud',
        runtimeBackend: 'ama-cloud',
        runtimeProtocol: 'ama-runtime-rpc',
        loop: 'cloud-session-runtime',
        executor: 'cloudflare-sandbox',
        piCorePackage: '@earendil-works/pi-agent-core',
      }),
    })
  })

  it('builds a deterministic workspace volume manifest', () => {
    expect(
      workspaceVolumeManifest({
        root: '/workspace',
        mounts: [
          {
            name: 'zeta',
            type: 'git_repository',
            mountPath: '/workspace/repos/saltbo/zeta',
            url: 'https://github.com/saltbo/zeta.git',
            ref: 'main',
          },
          {
            name: 'alpha',
            type: 'git_repository',
            mountPath: '/workspace/repos/saltbo/alpha',
            url: 'https://github.com/saltbo/alpha.git',
            ref: 'release',
            credential: {
              username: 'x-access-token',
              password: 'secret-value',
            },
          },
          {
            name: 'token',
            type: 'secret',
            mountPath: '/workspace/.ama/secrets/token',
            readOnly: true,
            files: [{ path: 'value', content: 'secret-value' }],
          },
          {
            name: 'memory',
            type: 'memory',
            mountPath: '/workspace/.ama/memory-stores/store_1',
            memoryRef: 'ama://memories/store_1',
            readOnly: false,
            files: [{ path: 'notes.md', content: 'keep this out of the volume manifest' }],
          },
        ],
      }),
    ).toEqual({
      version: 1,
      workspaceRoot: '/workspace',
      volumes: [
        {
          type: 'memory',
          memoryRef: 'ama://memories/store_1',
          name: 'memory',
          mountPath: '/workspace/.ama/memory-stores/store_1',
          status: 'declared',
        },
        {
          type: 'secret',
          name: 'token',
          mountPath: '/workspace/.ama/secrets/token',
          files: [{ path: 'value' }],
          status: 'declared',
        },
        {
          type: 'git_repository',
          name: 'alpha',
          url: 'https://github.com/saltbo/alpha.git',
          ref: 'release',
          mountPath: '/workspace/repos/saltbo/alpha',
          status: 'declared',
        },
        {
          type: 'git_repository',
          name: 'zeta',
          url: 'https://github.com/saltbo/zeta.git',
          ref: 'main',
          mountPath: '/workspace/repos/saltbo/zeta',
          status: 'declared',
        },
      ],
    })
  })

  it('runs a prompt through Pi Core and dispatches model tool calls through the executor [spec: runtime/turn]', async () => {
    mockExecutor.execute.mockResolvedValueOnce({
      toolCallId: 'call_git_status',
      toolName: 'bash',
      output: { stdout: 'clean', stderr: '', exitCode: 0 },
      error: null,
      durationMs: 5,
    })
    const events: Record<string, unknown>[] = []

    await runSessionTurn({ AMA_RUNTIME_MODE: 'test' } as Env, {
      sessionId: 'session_123',
      sandboxId: 'sandbox_123',
      provider: 'workers-ai',
      model: '@cf/moonshotai/kimi-k2.6',
      agentSnapshot: { systemPrompt: 'Inspect before answering.', allowedTools: ['bash'] },
      prompt: 'Inspect repository status',
      onEvent: async (event) => {
        events.push(event)
      },
    })

    expect(mockExecutor.execute).toHaveBeenCalledWith(
      {
        sessionId: 'session_123',
        sandboxId: 'sandbox_123',
        toolCallId: 'call_git_status',
        toolName: 'bash',
        input: { command: 'git status' },
        cwd: '/workspace',
      },
      expect.any(AbortSignal),
    )
    expect(events.map((event) => event.type)).toEqual(
      expect.arrayContaining(['runtime.started', 'message.completed', 'usage.recorded', 'runtime.completed']),
    )
    expect(JSON.stringify(events)).toContain('"type":"tool_call"')
    expect(JSON.stringify(events)).toContain('"type":"tool_result"')
    expect(JSON.stringify(events)).toContain('Tool result observed: clean')
    expect(JSON.stringify(events)).not.toContain('Message accepted by AMA runtime.')
    expect(JSON.stringify(events)).not.toContain('Received:')
  })

  it('reconstructs the next turn context from persisted Pi Core events', async () => {
    const firstTurnEvents: Record<string, unknown>[] = []
    await runSessionTurn({ AMA_RUNTIME_MODE: 'test' } as Env, {
      sessionId: 'session_123',
      sandboxId: 'sandbox_123',
      provider: 'workers-ai',
      model: '@cf/moonshotai/kimi-k2.6',
      agentSnapshot: { systemPrompt: 'Remember prior turns.', allowedTools: ['bash'] },
      prompt: 'Alpha durable prompt',
      onEvent: async (event) => {
        firstTurnEvents.push(event)
      },
    })

    const secondTurnEvents: Record<string, unknown>[] = []
    await runSessionTurn({ AMA_RUNTIME_MODE: 'test' } as Env, {
      sessionId: 'session_123',
      sandboxId: 'sandbox_123',
      provider: 'workers-ai',
      model: '@cf/moonshotai/kimi-k2.6',
      agentSnapshot: { systemPrompt: 'Remember prior turns.', allowedTools: ['bash'] },
      prompt: 'What was my previous prompt?',
      messages: runtimeMessagesFromEvents(firstTurnEvents.map((event) => ({ payload: event }))),
      onEvent: async (event) => {
        secondTurnEvents.push(event)
      },
    })

    expect(JSON.stringify(secondTurnEvents)).toContain('Previous user prompt: Alpha durable prompt')
  })

  it('pauses a multi-turn run at the budget boundary and finishes via continuation', async () => {
    mockExecutor.execute.mockResolvedValue({
      toolCallId: 'call_git_status',
      toolName: 'bash',
      output: { stdout: 'clean' },
      error: null,
      durationMs: 5,
    })

    const firstEvents: Record<string, unknown>[] = []
    const first = await runSessionTurn({ AMA_RUNTIME_MODE: 'test' } as Env, {
      sessionId: 'session_123',
      sandboxId: 'sandbox_123',
      provider: 'workers-ai',
      model: '@cf/moonshotai/kimi-k2.6',
      agentSnapshot: { systemPrompt: 'Inspect before answering.', allowedTools: ['bash'] },
      prompt: 'Inspect repository status',
      shouldPause: () => true,
      onEvent: async (event) => {
        firstEvents.push(event)
      },
    })

    // The tool-call turn completed and persisted, then the run paused instead
    // of starting the next model turn.
    expect(first).toEqual({ status: 'paused' })
    expect(JSON.stringify(firstEvents)).toContain('"type":"tool_result"')
    expect(JSON.stringify(firstEvents)).not.toContain('Tool result observed')

    const secondEvents: Record<string, unknown>[] = []
    const second = await runSessionTurn({ AMA_RUNTIME_MODE: 'test' } as Env, {
      sessionId: 'session_123',
      sandboxId: 'sandbox_123',
      provider: 'workers-ai',
      model: '@cf/moonshotai/kimi-k2.6',
      agentSnapshot: { systemPrompt: 'Inspect before answering.', allowedTools: ['bash'] },
      continuation: true,
      messages: runtimeMessagesFromEvents(firstEvents.map((event) => ({ payload: event }))),
      onEvent: async (event) => {
        secondEvents.push(event)
      },
    })

    expect(second).toEqual({ status: 'idle' })
    expect(JSON.stringify(secondEvents)).toContain('Tool result observed')
  })

  it('uses completed messages as canonical persisted context', () => {
    const messages = runtimeMessagesFromEvents([
      {
        payload: {
          type: 'message.completed',
          message: { id: 'msg_user', role: 'user', content: [{ type: 'text', text: 'canonical user' }] },
        },
      },
      {
        payload: {
          type: 'message.completed',
          message: {
            id: 'msg_assistant',
            role: 'assistant',
            content: [{ type: 'text', text: 'canonical assistant' }],
            stopReason: 'stop',
          },
        },
      },
    ])

    expect(messages).toHaveLength(2)
    expect(messages[0]).toMatchObject({ role: 'user', content: 'canonical user' })
  })

  it('ignores canonical transcript deltas when rebuilding persisted context', () => {
    const messages = runtimeMessagesFromEvents([
      {
        type: 'message.updated',
        payload: {
          message: { role: 'assistant', content: [{ type: 'text', text: 'partial assistant text' }] },
        },
      },
      {
        type: 'message.completed',
        payload: {
          message: { role: 'assistant', content: [{ type: 'text', text: 'completed assistant text' }] },
        },
      },
    ])

    expect(messages).toMatchObject([
      { role: 'assistant', content: [{ type: 'text', text: 'completed assistant text' }] },
    ])
  })

  it('sends canonical string assistant history to the live provider', async () => {
    const aiRun = vi.fn().mockResolvedValue({ response: 'continued' })
    const events: Record<string, unknown>[] = []

    await runSessionTurn({ AMA_RUNTIME_MODE: 'live', AI: { run: aiRun } } as unknown as Env, {
      sessionId: 'session_123',
      sandboxId: 'sandbox_123',
      provider: 'workers-ai',
      model: '@cf/moonshotai/kimi-k2.6',
      agentSnapshot: { systemPrompt: 'Continue from history.', allowedTools: [] },
      messages: runtimeMessagesFromEvents([
        {
          type: 'message.completed',
          payload: { message: { role: 'assistant', content: [{ type: 'text', text: 'Acknowledged.' }] } },
        },
      ]),
      prompt: 'Continue',
      onEvent: async (event) => {
        events.push(event)
      },
    })

    expect(aiRun).toHaveBeenCalledWith(
      '@cf/moonshotai/kimi-k2.6',
      expect.objectContaining({
        messages: expect.arrayContaining([{ role: 'assistant', content: 'Acknowledged.' }]),
      }),
      expect.any(Object),
    )
    expect(JSON.stringify(events)).toContain('continued')
  })

  it('stops before model completion events are persisted when the DB cancellation gate trips [spec: runtime/cooperative-cancellation]', async () => {
    const events: Record<string, unknown>[] = []
    let active = true

    const result = await runSessionTurn({ AMA_RUNTIME_MODE: 'test' } as Env, {
      sessionId: 'session_123',
      sandboxId: 'sandbox_123',
      provider: 'workers-ai',
      model: '@cf/moonshotai/kimi-k2.6',
      agentSnapshot: { systemPrompt: 'Stop cleanly.', allowedTools: ['bash'] },
      prompt: 'Alpha durable prompt',
      ensureActive: async () => {
        if (!active) {
          throw new RuntimeTurnCancelledError()
        }
      },
      onEvent: async (event) => {
        if (event.type === 'turn.started') {
          active = false
        }
        events.push(event)
      },
    })

    expect(result).toEqual({ status: 'aborted' })
    expect(events.map((event) => event.type)).not.toContain('message.completed')
    expect(JSON.stringify(events)).not.toContain('AMA runtime processed: Alpha durable prompt')
  })

  it('does not dispatch sandbox tools that are absent from a non-empty allow-list [spec: runtime/error-termination] [spec: runtime/sandbox-toolset]', async () => {
    const events: Record<string, unknown>[] = []

    await expect(
      runSessionTurn({ AMA_RUNTIME_MODE: 'test' } as Env, {
        sessionId: 'session_123',
        sandboxId: 'sandbox_123',
        provider: 'workers-ai',
        model: '@cf/moonshotai/kimi-k2.6',
        agentSnapshot: { systemPrompt: 'Inspect before answering.', allowedTools: ['read'] },
        prompt: 'Inspect repository status',
        onEvent: async (event) => {
          events.push(event)
        },
      }),
    ).rejects.toThrow()

    expect(mockExecutor.execute).not.toHaveBeenCalled()
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'message.completed',
          payload: expect.any(Object),
        }),
      ]),
    )
    expect(JSON.stringify(events)).toContain('Tool bash not found')
  })

  it('grants the full sandbox toolset when the agent has no explicit allow-list', async () => {
    mockExecutor.execute.mockResolvedValueOnce({
      toolCallId: 'call_git_status',
      toolName: 'bash',
      output: { stdout: 'clean', stderr: '', exitCode: 0 },
      error: null,
      durationMs: 5,
    })

    await runSessionTurn({ AMA_RUNTIME_MODE: 'test' } as Env, {
      sessionId: 'session_123',
      sandboxId: 'sandbox_123',
      provider: 'workers-ai',
      model: '@cf/moonshotai/kimi-k2.6',
      agentSnapshot: { systemPrompt: 'Inspect before answering.' },
      prompt: 'Inspect repository status',
      onEvent: async () => {},
    })

    expect(mockExecutor.execute).toHaveBeenCalledWith(expect.objectContaining({ toolName: 'bash' }), expect.anything())
  })

  it('initializes sandbox workspace metadata in live mode without starting a Pi process [spec: runtime/workspace-contract]', async () => {
    await expect(
      startSessionRuntime({ AMA_RUNTIME_MODE: 'live', SANDBOX: {} } as Env, {
        sessionId: 'session_123',
        sandboxId: 'sandbox_123',
        provider: 'workers-ai',
        model: '@cf/moonshotai/kimi-k2.6',
        agentSnapshot: { systemPrompt: 'Test runtime' },
        environmentSnapshot: { runtimeConfig: { image: 'ama-tool-executor' } },
        mcpServers: { servers: [{ connectorId: 'github' }] },
        env: {
          AK_API_URL: 'https://ak.example.com',
          AK_AGENT_ID: 'agent_123',
          GH_TOKEN: 'platform-injected-token',
          HOME: '/workspace/.home',
        },
        workspaceManifest: {
          root: '/workspace',
          mounts: [
            {
              name: 'source',
              type: 'git_repository',
              mountPath: '/workspace/repos/saltbo/any-managed-agents',
              url: 'https://github.com/saltbo/any-managed-agents.git',
              ref: 'main',
              credential: { username: 'git-user', password: 'git-password' },
            },
            {
              name: 'memory',
              type: 'memory',
              mountPath: '/workspace/.ama/memory-stores/memstore_1',
              memoryRef: 'ama://memories/memstore_1',
              readOnly: true,
              files: [{ path: 'guides/review.md', content: 'Review carefully.' }],
            },
            {
              name: 'api-token',
              type: 'secret',
              mountPath: '/workspace/.ama/secrets/api',
              readOnly: true,
              files: [{ path: 'token', content: 'secret-token' }],
            },
          ],
        },
      }),
    ).resolves.toMatchObject({
      sandboxId: 'sandbox_123',
      metadata: expect.objectContaining({
        runtimeMode: 'live',
        runtimeDriver: 'ama-cloud',
        runtimeBackend: 'ama-cloud',
        runtimeProtocol: 'ama-runtime-rpc',
        loop: 'cloud-session-runtime',
      }),
    })

    expect(getSandboxMock).toHaveBeenCalledWith({}, 'sandbox_123', { keepAlive: true, normalizeId: true })
    expect(mockSandbox.setEnvVars).toHaveBeenCalledWith({
      AK_API_URL: 'https://ak.example.com',
      AK_AGENT_ID: 'agent_123',
      GH_TOKEN: 'platform-injected-token',
      HOME: '/workspace/.home',
    })
    expect(mockSandbox.exec).toHaveBeenCalledWith("mkdir -p '/workspace/.home'", undefined)
    expect(mockSandbox.exec).toHaveBeenCalledWith(
      "git -c credential.helper= -c credential.helper='store --file /workspace/.home/.git-clone-credentials' clone 'https://github.com/saltbo/any-managed-agents.git' '/workspace/repos/saltbo/any-managed-agents'",
      { timeout: 120_000 },
    )
    expect(mockSandbox.exec).toHaveBeenCalledWith(
      "git -C '/workspace/repos/saltbo/any-managed-agents' checkout 'main'",
      undefined,
    )
    expect(mockSandbox.exec).toHaveBeenCalledWith("rm -f '/workspace/.home/.git-clone-credentials'", undefined)
    expect(mockSandbox.exec).not.toHaveBeenCalledWith('git config --global credential.helper store', undefined)
    expect(mockSandbox.writeFile).toHaveBeenCalledWith(
      '/workspace/.home/.git-clone-credentials',
      'https://git-user:git-password@github.com\n',
      {
        encoding: 'utf-8',
      },
    )
    const setEnvOrder = mockSandbox.setEnvVars.mock.invocationCallOrder[0]
    const mkdirOrder = mockSandbox.exec.mock.invocationCallOrder.find(
      (_, index) => mockSandbox.exec.mock.calls[index]?.[0] === "mkdir -p '/workspace/.home'",
    )
    const cloneOrder = mockSandbox.exec.mock.invocationCallOrder.find((_, index) =>
      String(mockSandbox.exec.mock.calls[index]?.[0]).includes(
        " clone 'https://github.com/saltbo/any-managed-agents.git'",
      ),
    )
    expect(setEnvOrder).toBeLessThan(mkdirOrder!)
    expect(setEnvOrder).toBeLessThan(cloneOrder!)
    expect(mockSandbox.writeFile).toHaveBeenCalledWith(
      '/workspace/.ama/memory-stores/memstore_1/guides/review.md',
      'Review carefully.',
      { encoding: 'utf-8' },
    )
    expect(mockSandbox.exec).toHaveBeenCalledWith("chmod -R a-w '/workspace/.ama/memory-stores/memstore_1'", undefined)
    expect(mockSandbox.writeFile).toHaveBeenCalledWith('/workspace/.ama/secrets/api/token', 'secret-token', {
      encoding: 'utf-8',
    })
    expect(mockSandbox.exec).toHaveBeenCalledWith("chmod -R a-w '/workspace/.ama/secrets/api'", undefined)
    expect(mockSandbox.writeFile).not.toHaveBeenCalledWith(
      expect.stringMatching(/^\/workspace\/\.ama\/(session|resources|runtime-env)\.json$/),
      expect.anything(),
      expect.anything(),
    )
  })

  it('[spec: sessions/realmroot-identity] validates cloud Realmroot state and writes a private session copy', async () => {
    const issuer = 'https://realmroot.example.com/api/auth'
    const state = JSON.stringify({
      version: 18,
      agent_id: 'rr_agent_1',
      origin: 'https://realmroot.example.com',
      issuer,
      runtime: 'ama',
      host_id: 'host_1',
      agent_key_id: 'key_1',
      agent_private_key: 'BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBw',
      enrollment_idempotency_key: 'enroll_1',
    })
    mockSandbox.exec.mockImplementation(async (command: string) =>
      command.startsWith('cat ')
        ? { exitCode: 1, stdout: '', stderr: 'missing' }
        : { exitCode: 0, stdout: '', stderr: '' },
    )

    await expect(
      startSessionRuntime({ AMA_RUNTIME_MODE: 'live', SANDBOX: {} } as Env, {
        sessionId: 'session_realmroot',
        sandboxId: 'sandbox_realmroot',
        provider: 'workers-ai',
        model: '@cf/moonshotai/kimi-k2.6',
        agentSnapshot: {
          systemPrompt: 'Use Realmroot.',
          realmroot: {
            agentId: 'rr_agent_1',
            origin: 'https://realmroot.example.com',
            credentialRef: 'ama://vaults/vault_1/credentials/cred_1',
          },
        },
        environmentSnapshot: { runtimeConfig: {} },
        workspaceManifest: {
          root: '/workspace',
          mounts: [
            {
              name: 'realmroot-agent-state',
              type: 'secret',
              mountPath: '/workspace/.ama/realmroot-source',
              readOnly: true,
              files: [{ path: 'state.json', content: state }],
            },
          ],
        },
      }),
    ).resolves.toMatchObject({ sandboxId: 'sandbox_realmroot' })

    const stateWrite = mockSandbox.writeFile.mock.calls.find(([path]) => String(path).endsWith('/YW1h.json'))
    expect(stateWrite).toEqual([
      expect.stringContaining('/.ama/realmroot-state/identities/'),
      state,
      { encoding: 'utf-8' },
    ])
    expect(mockSandbox.writeFile.mock.calls.some(([path]) => String(path).endsWith('/ama.json'))).toBe(false)
    expect(mockSandbox.exec.mock.calls.map(([command]) => command).join('\n')).toContain('chmod 600')
    expect(mockSandbox.exec.mock.calls.map(([command]) => command).join('\n')).toContain('command -v realmroot')
  })

  it('[spec: sessions/realmroot-identity] rejects cloud state for a different Realmroot Agent', async () => {
    await expect(
      startSessionRuntime({ AMA_RUNTIME_MODE: 'live', SANDBOX: {} } as Env, {
        sessionId: 'session_realmroot',
        sandboxId: 'sandbox_realmroot',
        provider: 'workers-ai',
        model: '@cf/moonshotai/kimi-k2.6',
        agentSnapshot: {
          systemPrompt: 'Use Realmroot.',
          realmroot: {
            agentId: 'rr_agent_1',
            origin: 'https://realmroot.example.com',
            credentialRef: 'ama://vaults/vault_1/credentials/cred_1',
          },
        },
        environmentSnapshot: { runtimeConfig: {} },
        workspaceManifest: {
          root: '/workspace',
          mounts: [
            {
              name: 'realmroot-agent-state',
              type: 'secret',
              mountPath: '/workspace/.ama/realmroot-source',
              readOnly: true,
              files: [
                {
                  path: 'state.json',
                  content: JSON.stringify({
                    version: 18,
                    agent_id: 'rr_agent_other',
                    origin: 'https://realmroot.example.com',
                    issuer: 'https://realmroot.example.com/api/auth',
                    runtime: 'ama',
                    host_id: 'host_1',
                    agent_key_id: 'key_1',
                    agent_private_key:
                      'BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBw',
                    enrollment_idempotency_key: 'enroll_1',
                  }),
                },
              ],
            },
          ],
        },
      }),
    ).rejects.toThrow('does not match the bound Agent')
  })

  it('[spec: sessions/realmroot-identity] preserves an existing valid writable cloud state on repeated preparation', async () => {
    const sourceState = JSON.stringify({
      version: 18,
      agent_id: 'rr_agent_1',
      origin: 'https://realmroot.example.com',
      issuer: 'https://realmroot.example.com/api/auth',
      runtime: 'ama',
      host_id: 'host_1',
      agent_key_id: 'key_1',
      agent_private_key: 'BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBw',
      enrollment_idempotency_key: 'enroll_1',
    })
    const evolvedState = JSON.stringify({
      ...JSON.parse(sourceState),
      protocol_credential: {
        resource_indicator: 'https://realmroot.example.com/',
        authorization_details: [],
        credential_endpoint: 'https://realmroot.example.com/api/credentials',
        proof_target: 'https://realmroot.example.com/',
        private_key: 'AgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgI',
        access_token: 'refreshed',
        expires_at: '2026-09-01T00:00:00.000Z',
        scopes: ['agent:operate'],
      },
    })
    let existingState: string | null = null
    mockSandbox.exec.mockImplementation(async (command: string) =>
      command.startsWith('cat ')
        ? existingState === null
          ? { exitCode: 1, stdout: '', stderr: 'missing' }
          : { exitCode: 0, stdout: existingState, stderr: '' }
        : { exitCode: 0, stdout: '', stderr: '' },
    )
    mockSandbox.writeFile.mockImplementation(async (path: string) => {
      if (path.endsWith('/YW1h.json')) existingState = sourceState
    })
    const input = {
      sessionId: 'session_realmroot_repeat',
      sandboxId: 'sandbox_realmroot_repeat',
      provider: 'workers-ai',
      model: '@cf/moonshotai/kimi-k2.6',
      agentSnapshot: {
        systemPrompt: 'Use Realmroot.',
        realmroot: {
          agentId: 'rr_agent_1',
          origin: 'https://realmroot.example.com',
          credentialRef: 'ama://vaults/vault_1/credentials/cred_1',
        },
      },
      environmentSnapshot: { runtimeConfig: {} },
      workspaceManifest: {
        root: '/workspace' as const,
        mounts: [
          {
            name: 'realmroot-agent-state',
            type: 'secret' as const,
            mountPath: '/workspace/.ama/realmroot-source',
            readOnly: true,
            files: [{ path: 'state.json', content: sourceState }],
          },
        ],
      },
    }

    await startSessionRuntime({ AMA_RUNTIME_MODE: 'live', SANDBOX: {} } as Env, input)
    existingState = evolvedState
    await startSessionRuntime({ AMA_RUNTIME_MODE: 'live', SANDBOX: {} } as Env, input)

    const targetWrites = mockSandbox.writeFile.mock.calls.filter(([path]) => String(path).endsWith('/YW1h.json'))
    expect(targetWrites).toHaveLength(1)
    expect(mockSandbox.writeFile.mock.calls.some(([path]) => String(path).endsWith('/ama.json'))).toBe(false)
    expect(existingState).toBe(evolvedState)
  })

  it('stops the configured executor backend for a sandbox', async () => {
    await stopSessionRuntime({ AMA_RUNTIME_MODE: 'test' } as Env, 'sandbox_123')

    expect(toolExecutorMock).toHaveBeenCalledTimes(1)
    expect(mockExecutor.stop).toHaveBeenCalledWith('sandbox_123')
  })
})
