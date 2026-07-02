import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RuntimeProviderRequest } from '../protocol'

const execSyncMock = vi.fn<(command: string, options?: unknown) => string>()
vi.mock('node:child_process', () => ({
  execSync: (command: string, options?: unknown) => execSyncMock(command, options),
}))

const { arrayValue, hostHome, normalizeProviderUsage, objectValue, resolveCliPath, sdkEnv } = await import('./cli-host')

function request(env: Record<string, string>): RuntimeProviderRequest {
  return {
    type: 'run',
    requestId: 'req_1',
    runtime: 'codex',
    sessionId: 'session_1',
    cwd: '/workspace',
    env,
    prompt: 'hello',
  }
}

afterEach(() => {
  vi.restoreAllMocks()
  execSyncMock.mockReset()
})

describe('hostHome', () => {
  it('returns the host home when set to a non-empty string', () => {
    expect(hostHome({ AMA_RUNTIME_BRIDGE_HOST_HOME: '/host' })).toBe('/host')
  })

  it('returns undefined when unset or empty', () => {
    expect(hostHome({})).toBeUndefined()
    expect(hostHome({ AMA_RUNTIME_BRIDGE_HOST_HOME: '' })).toBeUndefined()
  })
})

describe('sdkEnv', () => {
  it('swaps HOME to the host home and stashes the sandbox HOME', () => {
    const env = sdkEnv(request({ HOME: '/sandbox', AMA_RUNTIME_BRIDGE_HOST_HOME: '/host', FOO: 'bar' }))
    expect(env.HOME).toBe('/host')
    expect(env.AMA_WORKSPACE_HOME).toBe('/sandbox')
    expect(env.FOO).toBe('bar')
  })

  it('leaves HOME untouched when no host home is supplied', () => {
    const env = sdkEnv(request({ HOME: '/sandbox' }))
    expect(env.HOME).toBe('/sandbox')
    expect(env.AMA_WORKSPACE_HOME).toBeUndefined()
  })
})

describe('resolveCliPath', () => {
  it('shells `which <bin>` and trims the result', () => {
    execSyncMock.mockReturnValue('/usr/local/bin/codex\n')
    expect(resolveCliPath('codex')).toBe('/usr/local/bin/codex')
    expect(execSyncMock).toHaveBeenCalledWith('which codex', expect.anything())
  })

  it('returns undefined when the binary is not found', () => {
    execSyncMock.mockImplementation(() => {
      throw new Error('not found')
    })
    expect(resolveCliPath('claude')).toBeUndefined()
  })

  it('returns undefined when `which` yields an empty line', () => {
    execSyncMock.mockReturnValue('   \n')
    expect(resolveCliPath('copilot')).toBeUndefined()
  })
})

describe('objectValue / arrayValue', () => {
  it('narrows plain objects and rejects arrays, null, and primitives', () => {
    expect(objectValue({ a: 1 })).toEqual({ a: 1 })
    expect(objectValue([1, 2])).toEqual({})
    expect(objectValue(null)).toEqual({})
    expect(objectValue('x')).toEqual({})
    expect(objectValue(undefined)).toEqual({})
  })

  it('returns arrays as-is and falls back to []', () => {
    expect(arrayValue([1, 2])).toEqual([1, 2])
    expect(arrayValue({})).toEqual([])
    expect(arrayValue(null)).toEqual([])
  })
})

describe('normalizeProviderUsage', () => {
  it('coalesces snake_case variants', () => {
    expect(
      normalizeProviderUsage({
        input_tokens: 10,
        output_tokens: 5,
        cache_read_input_tokens: 3,
        total_tokens: 15,
      }),
    ).toEqual({ inputTokens: 10, outputTokens: 5, cachedInputTokens: 3, totalTokens: 15 })
  })

  it('coalesces camelCase variants', () => {
    expect(
      normalizeProviderUsage({
        inputTokens: 7,
        outputTokens: 2,
        cachedInputTokens: 1,
        totalTokens: 9,
      }),
    ).toEqual({ inputTokens: 7, outputTokens: 2, cachedInputTokens: 1, totalTokens: 9 })
  })

  it('accepts OpenAI prompt_/completion_ names and the codex cached_input_tokens key', () => {
    expect(normalizeProviderUsage({ prompt_tokens: 4, completion_tokens: 6, cached_input_tokens: 2 })).toEqual({
      inputTokens: 4,
      outputTokens: 6,
      cachedInputTokens: 2,
      totalTokens: 10,
    })
  })

  it('defaults missing fields to 0 and derives totalTokens from input+output', () => {
    expect(normalizeProviderUsage({})).toEqual({
      inputTokens: 0,
      outputTokens: 0,
      cachedInputTokens: 0,
      totalTokens: 0,
    })
    expect(normalizeProviderUsage({ input_tokens: 3, output_tokens: 4 })).toEqual({
      inputTokens: 3,
      outputTokens: 4,
      cachedInputTokens: 0,
      totalTokens: 7,
    })
  })
})
