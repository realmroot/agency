import type { RuntimeProviderRequest } from '../protocol'

// Shared CLI-host plumbing for the SDK-backed providers (claude-code, codex,
// copilot). Each provider keeps its own API URLs and response mapping; only the
// host/env/usage plumbing they all duplicated lives here.

/** Narrows an env-supplied host home to a non-empty string, else undefined. */
export function hostHome(env: Record<string, string>): string | undefined {
  return typeof env.ENBOR_RUNTIME_BRIDGE_HOST_HOME === 'string' && env.ENBOR_RUNTIME_BRIDGE_HOST_HOME
    ? env.ENBOR_RUNTIME_BRIDGE_HOST_HOME
    : undefined
}

/**
 * The env handed to a provider SDK: when a host home is supplied, swap the
 * sandbox HOME for the host's so the SDK reads the host login, and stash the
 * original sandbox HOME so the session still knows it.
 */
export function sdkEnv(request: RuntimeProviderRequest): Record<string, string> {
  const home = hostHome(request.env)
  const sessionHome = request.env.HOME
  return {
    ...request.env,
    ...(home
      ? {
          HOME: home,
          ENBOR_WORKSPACE_HOME: sessionHome,
          GH_CONFIG_DIR: `${sessionHome}/.config/gh`,
          GIT_CONFIG_GLOBAL: `${sessionHome}/.gitconfig`,
          GIT_CONFIG_NOSYSTEM: '1',
        }
      : {}),
  }
}

/** True iff value is a plain (non-array) object; returns it narrowed, else {}. */
export function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

/** Returns value when it is an array, else an empty array. */
export function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

export type ProviderUsage = {
  inputTokens: number
  outputTokens: number
  cachedInputTokens: number
  totalTokens: number
}

/**
 * Canonical token-usage normalization across the SDK providers: coalesces the
 * snake_case and camelCase (and OpenAI prompt_/completion_) variants into the
 * Enbor usage shape. totalTokens falls back to input+output when absent.
 */
export function normalizeProviderUsage(raw: Record<string, unknown>): ProviderUsage {
  const inputTokens = Number(raw.input_tokens ?? raw.inputTokens ?? raw.prompt_tokens ?? 0)
  const outputTokens = Number(raw.output_tokens ?? raw.outputTokens ?? raw.completion_tokens ?? 0)
  const cachedInputTokens = Number(raw.cache_read_input_tokens ?? raw.cached_input_tokens ?? raw.cachedInputTokens ?? 0)
  return {
    inputTokens,
    outputTokens,
    cachedInputTokens,
    totalTokens: Number(raw.total_tokens ?? raw.totalTokens ?? inputTokens + outputTokens),
  }
}
