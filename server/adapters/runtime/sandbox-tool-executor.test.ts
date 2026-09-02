import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Env } from '../../env'
import { CloudflareSandboxToolExecutor, TestToolExecutor, toolExecutor } from './sandbox-tool-executor'

const { getSandboxMock, sandboxMock } = vi.hoisted(() => {
  const sandboxMock = {
    exec: vi.fn(),
    readFile: vi.fn(),
    writeFile: vi.fn(),
    destroy: vi.fn(),
  }
  return {
    sandboxMock,
    getSandboxMock: vi.fn(() => sandboxMock),
  }
})

vi.mock('@cloudflare/sandbox', () => ({
  getSandbox: getSandboxMock,
}))

describe('tool-executor', () => {
  beforeEach(() => {
    getSandboxMock.mockClear()
    sandboxMock.exec.mockReset()
    sandboxMock.readFile.mockReset()
    sandboxMock.writeFile.mockReset()
    sandboxMock.destroy.mockReset()
  })

  it('uses the test executor when AMA runtime mode is test', () => {
    expect(toolExecutor({ AMA_RUNTIME_MODE: 'test' } as Env)).toBeInstanceOf(TestToolExecutor)
  })

  it('uses the Cloudflare Sandbox executor outside test mode', () => {
    expect(toolExecutor({ AMA_RUNTIME_MODE: 'live' } as Env)).toBeInstanceOf(CloudflareSandboxToolExecutor)
  })

  it('simulates canonical bash output in test mode', async () => {
    const executor = new TestToolExecutor()

    await expect(
      executor.execute({
        sessionId: 'session_123',
        sandboxId: 'sandbox_123',
        toolCallId: 'call_1',
        toolName: 'bash',
        input: { command: 'echo ok' },
      }),
    ).resolves.toMatchObject({
      toolCallId: 'call_1',
      toolName: 'bash',
      output: { stdout: 'ok', stderr: '', exitCode: 0 },
      error: null,
    })
  })

  it('rejects invalid test-mode tool input before simulation', async () => {
    const executor = new TestToolExecutor()

    await expect(
      executor.execute({
        sessionId: 'session_123',
        sandboxId: 'sandbox_123',
        toolCallId: 'call_1',
        toolName: 'bash',
        input: {},
      }),
    ).rejects.toThrow()
  })

  it('executes sandbox commands in /workspace through Cloudflare Sandbox', async () => {
    sandboxMock.exec.mockResolvedValue({ stdout: 'ok', stderr: '', exitCode: 0 })
    const executor = new CloudflareSandboxToolExecutor({ SANDBOX: {} } as Env)

    await expect(
      executor.execute({
        sessionId: 'session_123',
        sandboxId: 'sandbox_123',
        toolCallId: 'call_1',
        toolName: 'bash',
        input: { command: 'git status' },
      }),
    ).resolves.toMatchObject({
      toolCallId: 'call_1',
      toolName: 'bash',
      output: { stdout: 'ok', stderr: '', exitCode: 0 },
      error: null,
    })
    expect(getSandboxMock).toHaveBeenCalledWith({}, 'sandbox_123', { keepAlive: true, normalizeId: true })
    expect(sandboxMock.exec).toHaveBeenCalledWith('git status', { cwd: '/workspace', timeout: 600_000 })
  })

  it('reads and writes relative workspace files through Cloudflare Sandbox', async () => {
    sandboxMock.readFile.mockResolvedValue('hello')
    const executor = new CloudflareSandboxToolExecutor({ SANDBOX: {} } as Env)

    await expect(
      executor.execute({
        sessionId: 'session_123',
        sandboxId: 'sandbox_123',
        toolCallId: 'read_1',
        toolName: 'read',
        input: { path: 'notes/todo.txt' },
      }),
    ).resolves.toMatchObject({ output: { content: 'hello' } })
    expect(sandboxMock.readFile).toHaveBeenCalledWith('/workspace/notes/todo.txt', { encoding: 'utf-8' })

    await expect(
      executor.execute({
        sessionId: 'session_123',
        sandboxId: 'sandbox_123',
        toolCallId: 'write_1',
        toolName: 'write',
        input: { path: 'notes/todo.txt', content: 'done' },
      }),
    ).resolves.toMatchObject({ output: { ok: true } })
    expect(sandboxMock.writeFile).toHaveBeenCalledWith('/workspace/notes/todo.txt', 'done', { encoding: 'utf-8' })
  })

  it('executes web search inside the sandbox network', async () => {
    sandboxMock.exec.mockResolvedValue({ stdout: 'result', stderr: '', exitCode: 0 })
    const executor = new CloudflareSandboxToolExecutor({ SANDBOX: {} } as Env)

    await expect(
      executor.execute({
        sessionId: 'session_123',
        sandboxId: 'sandbox_123',
        toolCallId: 'search_1',
        toolName: 'web_search',
        input: { query: 'managed agents', limit: 3 },
      }),
    ).resolves.toMatchObject({ output: { stdout: 'result', stderr: '', exitCode: 0 } })
    expect(sandboxMock.exec).toHaveBeenCalledWith(expect.stringContaining('lite.duckduckgo.com'), {
      cwd: '/workspace',
      timeout: 90_000,
    })
  })

  it('executes find glob searches inside the sandbox', async () => {
    sandboxMock.exec.mockResolvedValue({ stdout: 'src/app.test.ts', stderr: '', exitCode: 0 })
    const executor = new CloudflareSandboxToolExecutor({ SANDBOX: {} } as Env)

    await expect(
      executor.execute({
        sessionId: 'session_123',
        sandboxId: 'sandbox_123',
        toolCallId: 'find_1',
        toolName: 'find',
        input: { glob: '**/*.test.ts', path: 'src', limit: 5 },
      }),
    ).resolves.toMatchObject({ output: { stdout: 'src/app.test.ts', stderr: '', exitCode: 0 } })
    expect(sandboxMock.exec).toHaveBeenCalledWith("rg --files --glob '**/*.test.ts' '/workspace/src' | head -n 5", {
      cwd: '/workspace',
      timeout: 600_000,
    })
  })

  it('simulates web search in test mode', async () => {
    const executor = new TestToolExecutor()

    await expect(
      executor.execute({
        sessionId: 'session_123',
        sandboxId: 'sandbox_123',
        toolCallId: 'search_1',
        toolName: 'web_search',
        input: { query: 'managed agents' },
      }),
    ).resolves.toMatchObject({ output: { stdout: 'simulated web search: managed agents' } })
  })

  it('rejects file paths outside /workspace before calling the sandbox', async () => {
    const executor = new CloudflareSandboxToolExecutor({ SANDBOX: {} } as Env)

    await expect(
      executor.execute({
        sessionId: 'session_123',
        sandboxId: 'sandbox_123',
        toolCallId: 'read_1',
        toolName: 'read',
        input: { path: '../secret.txt' },
      }),
    ).rejects.toThrow('sandbox file paths must stay under /workspace')
    expect(sandboxMock.readFile).not.toHaveBeenCalled()
  })

  it('rejects an already-aborted turn before acquiring the sandbox', async () => {
    const executor = new CloudflareSandboxToolExecutor({ SANDBOX: {} } as Env)

    await expect(
      executor.execute(
        {
          sessionId: 'session_123',
          sandboxId: 'sandbox_123',
          toolCallId: 'call_1',
          toolName: 'bash',
          input: { command: 'git status' },
        },
        AbortSignal.abort(),
      ),
    ).rejects.toThrow('Session runtime is no longer active')
    expect(getSandboxMock).not.toHaveBeenCalled()
    expect(sandboxMock.exec).not.toHaveBeenCalled()
  })

  it('does not forward the abort signal to the sandbox exec (Workers RPC cannot serialize it)', async () => {
    sandboxMock.exec.mockResolvedValue({ stdout: 'ok', stderr: '', exitCode: 0 })
    const executor = new CloudflareSandboxToolExecutor({ SANDBOX: {} } as Env)
    const controller = new AbortController()

    await executor.execute(
      {
        sessionId: 'session_123',
        sandboxId: 'sandbox_123',
        toolCallId: 'call_1',
        toolName: 'bash',
        input: { command: 'git status' },
      },
      controller.signal,
    )

    // The signal crosses the Sandbox binding's RPC boundary, which rejects with
    // "AbortSignal serialization is not enabled" — cancellation is handled by the
    // pre-exec abort check and stop() → destroy() instead, never over RPC.
    expect(sandboxMock.exec).toHaveBeenCalledWith('git status', {
      cwd: '/workspace',
      timeout: 600_000,
    })
  })

  it('destroys the sandbox executor backend on stop', async () => {
    const executor = new CloudflareSandboxToolExecutor({ SANDBOX: {} } as Env)

    await executor.stop('sandbox_123')

    expect(sandboxMock.destroy).toHaveBeenCalledTimes(1)
  })

  it('propagates destroy failure to the lifecycle owner so cleanup remains retryable', async () => {
    const failure = new Error('sandbox destroy unavailable')
    sandboxMock.destroy.mockRejectedValue(failure)
    const executor = new CloudflareSandboxToolExecutor({ SANDBOX: {} } as Env)

    await expect(executor.stop('sandbox_123')).rejects.toBe(failure)
    expect(sandboxMock.destroy).toHaveBeenCalledTimes(1)
  })
})
