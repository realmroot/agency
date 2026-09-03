import type {
  EnborRuntimeEvent,
  RuntimeBridgeRunMessage,
  RuntimeUsageWindow,
} from '@enbor/runtime-contracts/bridge-protocol'

export type {
  EnborRuntimeEvent,
  RuntimeBridgeControlMessage,
  RuntimeBridgeInputMessage,
  RuntimeBridgeOutputMessage,
  RuntimeBridgeRunMessage,
  RuntimeInventoryEntry,
  RuntimeUsageWindow,
} from '@enbor/runtime-contracts/bridge-protocol'

export type RuntimeProviderHandle = {
  events: AsyncIterable<EnborRuntimeEvent>
  abort(): Promise<void>
  send(message: string): Promise<void>
  getResumeToken?(): string | undefined
  resolvePermission?(permissionId: string, allowed: boolean, reason?: string): Promise<void>
}

export type RuntimeProviderRequest = RuntimeBridgeRunMessage & {
  emitProviderEvent?: (event: Record<string, unknown>) => void
}

export type RuntimeProvider = {
  readonly name: RuntimeBridgeRunMessage['runtime']
  readonly binary: string
  readonly fallbackModels: string[]
  readonly usageUnavailableDetail?: string
  execute(request: RuntimeProviderRequest): Promise<RuntimeProviderHandle>
  /**
   * Resolve the host provider account's quota/rate-limit windows for this
   * runtime (e.g. Claude 5-hour/7-day utilization). Returns null when the
   * runtime has no credentials or the plan exposes no limited quota.
   */
  fetchUsage?(input: { env: Record<string, string> }): Promise<RuntimeUsageWindow[] | null>
  /**
   * Enumerate the model ids the host CLI account can serve for this runtime.
   * Returns null when the host has no credentials or the model universe is
   * unknown; the runner then advertises its pinned fallback model.
   */
  listModels?(input: { env: Record<string, string> }): Promise<string[] | null>
}

export function bridgeError(message: string, code?: string, details?: unknown) {
  return { message, ...(code ? { code } : {}), ...(details !== undefined ? { details } : {}) }
}

/**
 * An open-ended async stream fed by push(). Used for mid-run prompt injection:
 * claude-code's query.streamInput closes the CLI's stdin once its iterable
 * finishes, so injected prompts share a single queue that stays open until the
 * run ends instead of one short-lived iterable per send.
 */
export function createAsyncPushQueue<T>() {
  const pending: T[] = []
  let notify: (() => void) | null = null
  let ended = false
  const values = (async function* () {
    while (true) {
      while (pending.length > 0) {
        yield pending.shift() as T
      }
      if (ended) {
        return
      }
      await new Promise<void>((resolve) => {
        notify = resolve
      })
      notify = null
    }
  })()
  return {
    values,
    push(value: T) {
      pending.push(value)
      notify?.()
    },
    end() {
      ended = true
      notify?.()
    },
  }
}

/**
 * Tracks a provider handle's resume token and emits it as soon as it appears
 * or changes, so the runner can persist it before the run completes. Returns a
 * function to call whenever the token may have advanced (after execute and
 * after each event).
 */
export function createResumeTokenWatcher(
  handle: Pick<RuntimeProviderHandle, 'getResumeToken'>,
  emit: (resumeToken: string) => void,
) {
  let lastToken: string | undefined
  return () => {
    const token = handle.getResumeToken?.()
    if (token && token !== lastToken) {
      lastToken = token
      emit(token)
    }
  }
}

export function agentSystemPrompt(request: RuntimeProviderRequest): string | undefined {
  const snapshot = request.agentSnapshot
  if (!snapshot || typeof snapshot !== 'object') return undefined
  const sections: string[] = []
  const systemPrompt = snapshot.systemPrompt
  if (typeof systemPrompt === 'string' && systemPrompt.trim()) {
    sections.push(systemPrompt.trim())
  }
  const capabilitySection = agentCapabilitiesSection(snapshot)
  if (capabilitySection) sections.push(capabilitySection)
  return sections.length > 0 ? sections.join('\n\n') : undefined
}

function agentCapabilitiesSection(snapshot: Record<string, unknown>): string | undefined {
  const parts: string[] = []
  const skills = stringArray(snapshot.skills)
  if (skills.length > 0) parts.push(`Skills: ${skills.join(', ')}`)
  const subagents = subagentSummaries(snapshot.subagents)
  if (subagents.length > 0) parts.push(`Available subagents: ${subagents.join(', ')}`)
  return parts.length > 0 ? `## Agent Capabilities\n\n${parts.join('\n')}` : undefined
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : []
}

function objectValue(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

function subagentSummaries(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    const subagent = objectValue(item)
    const name = typeof subagent.name === 'string' ? subagent.name.trim() : ''
    const description = typeof subagent.description === 'string' ? subagent.description.trim() : ''
    return name ? [`@${name}${description ? ` (${description})` : ''}`] : []
  })
}
