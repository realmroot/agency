import { parseEnborSandboxToolOutput } from '@enbor/runtime-contracts/tool-contracts'
import type { RunnerChannel } from '@server/usecases/ports'
import type { Env } from '../../env'

const RUNNER_SANDBOX_REQUEST_TIMEOUT_MS = 120_000

// Self-hosted runner channels live in a RunnerPool Durable Object, one pool per
// environment. This gateway resolves a session to its environment and talks to
// that pool over its internal fetch protocol.
export function createRunnerChannel(
  env: Env,
  resolveEnvironmentId: (sessionId: string) => Promise<string | null>,
): RunnerChannel {
  async function pool(sessionId: string) {
    const environmentId = await resolveEnvironmentId(sessionId)
    if (!environmentId) {
      throw new Error('Session has no runner environment')
    }
    return env.RUNNER_POOL.get(env.RUNNER_POOL.idFromName(environmentId))
  }

  async function request(sessionId: string, request: Record<string, unknown>): Promise<Record<string, unknown>> {
    const stub = await pool(sessionId)
    const response = await stub.fetch('https://runner-pool/request', {
      method: 'POST',
      body: JSON.stringify({ sessionId, request, timeoutMs: RUNNER_SANDBOX_REQUEST_TIMEOUT_MS }),
    })
    if (!response.ok) {
      throw new Error(`Runner sandbox channel request failed: ${response.status}`)
    }
    const body = (await response.json()) as { ok?: boolean; result?: Record<string, unknown>; error?: string }
    if (body.ok !== true) {
      throw new Error(body.error || 'Runner sandbox channel request failed')
    }
    return body.result ?? {}
  }

  return {
    async assignWork(input): Promise<boolean> {
      const stub = env.RUNNER_POOL.get(env.RUNNER_POOL.idFromName(input.environmentId))
      const response = await stub.fetch('https://runner-pool/assign', {
        method: 'POST',
        body: JSON.stringify(input),
      })
      return response.status === 202
    },

    async retryAvailableWork(input): Promise<void> {
      const stub = env.RUNNER_POOL.get(env.RUNNER_POOL.idFromName(input.environmentId))
      const response = await stub.fetch('https://runner-pool/retry', {
        method: 'POST',
        body: JSON.stringify(input),
      })
      if (!response.ok) {
        throw new Error(`Runner work retry failed: ${response.status}`)
      }
    },

    async isAccepted(sessionId: string): Promise<boolean> {
      const stub = await pool(sessionId)
      const response = await stub.fetch('https://runner-pool/status', {
        method: 'POST',
        body: JSON.stringify({ sessionId }),
      })
      if (!response.ok) {
        return false
      }
      const body = (await response.json()) as { active?: boolean }
      return body.active === true
    },

    async dispatch(sessionId: string, command: Record<string, unknown>, requestId?: string | null): Promise<boolean> {
      const stub = await pool(sessionId)
      const response = await stub.fetch('https://runner-pool/dispatch', {
        method: 'POST',
        body: JSON.stringify({ sessionId, command, requestId }),
      })
      return response.status === 202
    },

    async executeSandboxTool(input) {
      const result = await request(input.sessionId, {
        type: 'sandbox.execute',
        toolCallId: input.toolCallId,
        toolName: input.toolName,
        input: input.input,
        sandboxId: input.sandboxId,
        cwd: input.cwd,
      })
      return {
        toolCallId: String(result.toolCallId ?? input.toolCallId),
        toolName: input.toolName,
        output: parseEnborSandboxToolOutput(input.toolName, result.output),
        error:
          result.error && typeof result.error === 'object' && !Array.isArray(result.error)
            ? (result.error as Record<string, unknown>)
            : null,
        durationMs: typeof result.durationMs === 'number' ? result.durationMs : 0,
      }
    },

    async stopSandbox(sessionId) {
      await request(sessionId, { type: 'sandbox.stop' })
    },

    async readMemoryStoreMemories(input) {
      const result = await request(input.sessionId, {
        type: 'sandbox.readMemoryStores',
        volumes: input.volumes,
        volumeMounts: input.volumeMounts,
      })
      return Array.isArray(result.stores)
        ? (result.stores as Array<{ memoryRef: string; memories: Array<{ path: string; content: string }> }>)
        : []
    },
  }
}
