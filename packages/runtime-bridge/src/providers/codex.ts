import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { MessageContentBlock, ToolResult } from '@ama/runtime-contracts/session-events'
import { Codex, type ThreadEvent } from '@openai/codex-sdk'
import {
  messageEvent,
  randomId,
  reasoningBlock,
  runtimeError,
  runtimeEvent,
  toolCallBlock,
  toolResultMessage,
  turnEnd,
} from '../events/ama'
import { resolveCliPath } from '../host/cli'
import {
  type AmaRuntimeEvent,
  agentSystemPrompt,
  type RuntimeProvider,
  type RuntimeProviderHandle,
  type RuntimeProviderRequest,
  type RuntimeUsageWindow,
} from '../protocol'
import { hostHome, objectValue, sdkEnv } from './cli-host'
import { codexPermissionPolicy } from './permission-policy'

const CODEX_USAGE_API = 'https://chatgpt.com/backend-api/wham/usage'

function codexAccessToken(home: string | undefined): string | null {
  if (!home) return null
  try {
    const auth = JSON.parse(readFileSync(join(home, '.codex', 'auth.json'), 'utf8')) as {
      tokens?: { access_token?: string }
      access_token?: string
    }
    return auth.tokens?.access_token ?? auth.access_token ?? null
  } catch {
    return null
  }
}

function readAccessToken(request: RuntimeProviderRequest): string | null {
  return codexAccessToken(hostHome(request.env))
}

function resolveModel(request: RuntimeProviderRequest): string | undefined {
  if (request.model) return request.model
  return readAccessToken(request) ? undefined : 'o3'
}

function positiveNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value ? value : null
}

function codexProviderItemId(item: Record<string, unknown>) {
  return stringValue(item.id)
}

function codexToolCallId(item: Record<string, unknown>) {
  switch (item.type) {
    case 'function_call':
    case 'function_call_output':
    case 'custom_tool_call':
    case 'custom_tool_call_output':
      return stringValue(item.call_id)
    case 'command_execution':
    case 'mcp_tool_call':
    case 'web_search':
    case 'collab_tool_call':
      return stringValue(item.id)
    default:
      return null
  }
}

type CodexToolShape = {
  toolName: string
  args: Record<string, unknown>
  nativeFunctionName?: string
  hiddenControl?: boolean
}

function codexToolShape(item: Record<string, unknown>): CodexToolShape | null {
  switch (item.type) {
    case 'command_execution': {
      if (typeof item.command !== 'string' || !item.command) return null
      return { toolName: 'bash', args: { command: item.command } }
    }
    case 'mcp_tool_call': {
      const name = stringValue(item.name)
      const server = stringValue(item.server)
      const tool = stringValue(item.tool)
      return {
        toolName: name ? `mcp.${name}` : server && tool ? `mcp.${server}.${tool}` : 'mcp.tool',
        args: parseJsonObject(item.arguments),
      }
    }
    case 'web_search': {
      if (typeof item.query !== 'string' || !item.query) return null
      return { toolName: 'web_search', args: { query: item.query } }
    }
    case 'collab_tool_call': {
      const nativeFunctionName = stringValue(item.tool)
      if (!nativeFunctionName) return null
      if (nativeFunctionName === 'spawn_agent') {
        return { toolName: 'agent', args: normalizeAgentToolInput(collabAgentToolInput(item)), nativeFunctionName }
      }
      return {
        toolName: nativeFunctionName,
        args: collabControlToolInput(item),
        nativeFunctionName,
        hiddenControl: true,
      }
    }
    case 'custom_tool_call': {
      const nativeFunctionName = stringValue(item.name)
      if (!nativeFunctionName) return null
      return { toolName: nativeFunctionName, args: parseCustomToolInput(item.input), nativeFunctionName }
    }
    case 'function_call': {
      const nativeFunctionName = stringValue(item.name)
      if (!nativeFunctionName) return null
      const args = parseJsonObject(item.arguments ?? item.input)
      if (nativeFunctionName === 'exec_command') {
        const command = stringValue(args.cmd) ?? stringValue(args.command)
        return {
          toolName: command ? 'bash' : nativeFunctionName,
          args: command ? { command } : args,
          nativeFunctionName,
        }
      }
      if (nativeFunctionName === 'spawn_agent' || nativeFunctionName === 'agent') {
        return { toolName: 'agent', args: normalizeAgentToolInput(args), nativeFunctionName }
      }
      if (isCodexSubagentControlFunction(nativeFunctionName)) {
        return { toolName: nativeFunctionName, args, nativeFunctionName, hiddenControl: true }
      }
      return { toolName: nativeFunctionName, args, nativeFunctionName }
    }
    default:
      return null
  }
}

function parseCustomToolInput(value: unknown): Record<string, unknown> {
  const parsed = parseJsonObject(value)
  if (Object.keys(parsed).length > 0) return parsed
  if (typeof value === 'string') return { input: value }
  if (value === undefined) return {}
  return { input: JSON.stringify(value) }
}

function parseJsonObject(value: unknown): Record<string, unknown> {
  if (typeof value !== 'string') return objectValue(value)
  try {
    return objectValue(JSON.parse(value))
  } catch {
    return {}
  }
}

function normalizeAgentToolInput(input: Record<string, unknown>): Record<string, unknown> {
  const prompt = stringValue(input.prompt) ?? stringValue(input.message) ?? JSON.stringify(input)
  const description = stringValue(input.description)
  const subagentName =
    stringValue(input.subagentName) ??
    stringValue(input.subagent_type) ??
    stringValue(input.subagentType) ??
    stringValue(input.agent_type) ??
    stringValue(input.agentType)
  return {
    prompt,
    ...(description ? { description } : {}),
    ...(subagentName ? { subagentName } : {}),
  }
}

function isCodexSubagentControlFunction(name: string) {
  return (
    name === 'wait_agent' ||
    name === 'wait' ||
    name === 'close_agent' ||
    name === 'send_input' ||
    name === 'resume_agent'
  )
}

function collabAgentToolInput(item: Record<string, unknown>): Record<string, unknown> {
  return {
    prompt: stringValue(item.prompt) ?? 'Spawn Codex sub-agent.',
    ...(stringValue(item.subagentName) ? { subagentName: stringValue(item.subagentName) } : {}),
    ...(stringValue(item.subagent_type) ? { subagent_type: stringValue(item.subagent_type) } : {}),
    ...(stringValue(item.subagentType) ? { subagentType: stringValue(item.subagentType) } : {}),
    ...(stringValue(item.agent_type) ? { agent_type: stringValue(item.agent_type) } : {}),
    ...(stringValue(item.agentType) ? { agentType: stringValue(item.agentType) } : {}),
  }
}

function collabControlToolInput(item: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries({
      senderThreadId: item.sender_thread_id,
      receiverThreadIds: item.receiver_thread_ids,
      prompt: item.prompt,
    }).filter(([, value]) => value !== undefined && value !== null && value !== ''),
  )
}

function stringArrayValue(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === 'string' && item.length > 0)
}

function toolResult(item: Record<string, unknown>): ToolResult {
  const stdout = typeof item.stdout === 'string' ? item.stdout : ''
  const stderr = typeof item.stderr === 'string' ? item.stderr : ''
  const output =
    typeof item.output === 'string'
      ? item.output
      : typeof item.aggregated_output === 'string'
        ? item.aggregated_output
        : [stdout, stderr].filter(Boolean).join('\n')
  const structuredContent = codexToolStructuredContent(item)
  return {
    content: output ? [{ type: 'text', text: output }] : [],
    ...(structuredContent ? { structuredContent } : {}),
    ...(typeof item.exit_code === 'number'
      ? { exitCode: item.exit_code }
      : typeof item.exitCode === 'number'
        ? { exitCode: item.exitCode }
        : {}),
  }
}

function codexToolStructuredContent(item: Record<string, unknown>): Record<string, unknown> | undefined {
  const structured = Object.fromEntries(
    Object.entries({
      result: item.result,
      stdout: item.stdout,
      stderr: item.stderr,
      output: item.output,
      aggregatedOutput: item.aggregated_output,
    }).filter(([, value]) => value !== undefined && value !== ''),
  )
  return Object.keys(structured).length > 0 ? structured : undefined
}

function codexAssistantMessage(content: MessageContentBlock[], providerMessageId: string | null) {
  return {
    id: randomId('msg'),
    role: 'assistant' as const,
    content,
    ...(providerMessageId ? { providerMessageId } : {}),
  }
}

class CodexEventMapper {
  private readonly nativeFunctionNameByCallId = new Map<string, string>()
  private readonly nativeFunctionInputByCallId = new Map<string, Record<string, unknown>>()
  private readonly agentToolCallIdByAgentId = new Map<string, string>()
  private readonly emittedCollabToolCallIds = new Set<string>()
  private readonly finalizedAgentIds = new Set<string>()

  setThreadId(threadId: string) {
    void threadId
  }

  *map(event: ThreadEvent): Generator<AmaRuntimeEvent> {
    switch (event.type) {
      case 'thread.started':
        yield runtimeEvent('runtime.started')
        return
      case 'turn.started':
        yield runtimeEvent('turn.started')
        return
      case 'item.started': {
        const item = objectValue(event.item)
        if (item.type === 'collab_tool_call') {
          for (const outputEvent of this.mapCollabToolStarted(item)) yield outputEvent
          return
        }
        const shape = codexToolShape(item)
        const id = codexToolCallId(item)
        if (shape && id && !shape.hiddenControl && item.type !== 'function_call') {
          yield messageEvent({
            id: randomId('msg'),
            role: 'assistant',
            content: [toolCallBlock({ id, name: shape.toolName, input: shape.args })],
          })
        }
        return
      }
      case 'item.completed': {
        const item = objectValue(event.item)
        if (item.type === 'file_change') {
          return
        }
        if (item.type === 'agent_message' && typeof item.text === 'string' && item.text) {
          yield messageEvent(codexAssistantMessage([{ type: 'text', text: item.text }], codexProviderItemId(item)))
          return
        }
        if (item.type === 'reasoning' && typeof item.text === 'string' && item.text) {
          yield messageEvent(codexAssistantMessage([reasoningBlock(item.text)], codexProviderItemId(item)))
          return
        }
        if (item.type === 'function_call_output' || item.type === 'custom_tool_call_output') {
          for (const outputEvent of this.mapFunctionCallOutput(item)) yield outputEvent
          return
        }
        if (item.type === 'collab_tool_call') {
          for (const outputEvent of this.mapCollabToolCompleted(item)) yield outputEvent
          return
        }
        const shape = codexToolShape(item)
        const id = codexToolCallId(item)
        this.trackFunctionCall(item, id, shape)
        if (shape && id && (item.type === 'function_call' || item.type === 'custom_tool_call')) {
          if (!shape.hiddenControl) {
            yield messageEvent({
              id: randomId('msg'),
              role: 'assistant',
              content: [toolCallBlock({ id, name: shape.toolName, input: shape.args })],
            })
          }
          return
        }
        if (shape && id) yield messageEvent(toolResultMessage(id, toolResult(item), Boolean(item.error)))
        return
      }
      case 'turn.completed': {
        // TODO(codex-usage): @openai/codex-sdk 0.142.5 exposes token usage here
        // but not the actual model used for the turn. The raw Codex JSONL has it
        // under turn_context.payload.model. Do not emit usage.recorded until the
        // bridge can read that confirmed source or the SDK exposes an equivalent
        // field; falling back to request.model would misattribute sessions where
        // Codex resolves or switches models itself.
        yield turnEnd()
        return
      }
      case 'turn.failed':
        yield runtimeError(
          String(objectValue(event.error).message ?? JSON.stringify(event)),
          String(objectValue(event.error).code ?? 'codex_error'),
          event,
        )
        return
      case 'error':
        yield runtimeError(String(event.message ?? JSON.stringify(event)), 'codex_error', event)
        return
      default:
        return
    }
  }

  private trackFunctionCall(item: Record<string, unknown>, id: string | null, shape: CodexToolShape | null) {
    if ((item.type !== 'function_call' && item.type !== 'custom_tool_call') || !id || !shape?.nativeFunctionName) {
      return
    }
    this.nativeFunctionNameByCallId.set(id, shape.nativeFunctionName)
    this.nativeFunctionInputByCallId.set(id, shape.args)
  }

  private mapFunctionCallOutput(item: Record<string, unknown>): AmaRuntimeEvent[] {
    const id = codexToolCallId(item)
    if (!id) return []
    const nativeFunctionName = this.nativeFunctionNameByCallId.get(id)
    if (nativeFunctionName === 'spawn_agent') {
      const output = parseJsonObject(item.output)
      const agentId = stringValue(output.agent_id) ?? stringValue(output.agentId)
      if (agentId) {
        this.agentToolCallIdByAgentId.set(agentId, id)
        return []
      }
      return [messageEvent(toolResultMessage(id, toolResult(item), true))]
    }
    if (nativeFunctionName && isCodexSubagentControlFunction(nativeFunctionName)) {
      return this.mapSubagentControlOutput(nativeFunctionName, item)
    }
    return [messageEvent(toolResultMessage(id, toolResult(item), Boolean(item.error)))]
  }

  private mapSubagentControlOutput(nativeFunctionName: string, item: Record<string, unknown>): AmaRuntimeEvent[] {
    if (nativeFunctionName !== 'wait_agent' && nativeFunctionName !== 'close_agent') return []
    const id = codexToolCallId(item)
    const finals = subagentFinalsFromCodexControl(
      this.nativeFunctionInputByCallId.get(id ?? '') ?? {},
      parseJsonObject(item.output),
      Boolean(item.error),
    )
    return finals.flatMap((final) => {
      const toolCallId = this.agentToolCallIdByAgentId.get(final.agentId)
      if (!toolCallId || this.finalizedAgentIds.has(final.agentId)) return []
      this.finalizedAgentIds.add(final.agentId)
      return [
        messageEvent(
          toolResultMessage(
            toolCallId,
            {
              content: final.text ? [{ type: 'text', text: final.text }] : [],
              structuredContent: {
                agentId: final.agentId,
                status: final.status,
                provider: 'codex',
                rawStatus: final.rawStatus,
              },
            },
            final.failed,
          ),
        ),
      ]
    })
  }

  private mapCollabToolStarted(item: Record<string, unknown>): AmaRuntimeEvent[] {
    const shape = codexToolShape(item)
    const id = codexToolCallId(item)
    this.trackCollabToolCall(item, id)
    if (!shape || !id || shape.hiddenControl) return []
    this.emittedCollabToolCallIds.add(id)
    return [
      messageEvent({
        id: randomId('msg'),
        role: 'assistant',
        content: [toolCallBlock({ id, name: shape.toolName, input: shape.args })],
      }),
    ]
  }

  private mapCollabToolCompleted(item: Record<string, unknown>): AmaRuntimeEvent[] {
    const shape = codexToolShape(item)
    const id = codexToolCallId(item)
    this.trackCollabToolCall(item, id)
    const events: AmaRuntimeEvent[] = []
    if (shape && id && !shape.hiddenControl && !this.emittedCollabToolCallIds.has(id)) {
      this.emittedCollabToolCallIds.add(id)
      events.push(
        messageEvent({
          id: randomId('msg'),
          role: 'assistant',
          content: [toolCallBlock({ id, name: shape.toolName, input: shape.args })],
        }),
      )
    }
    const finalEvents = this.mapCollabAgentFinals(item)
    events.push(...finalEvents)
    if (shape && id && !shape.hiddenControl && finalEvents.length === 0 && stringValue(item.status) === 'failed') {
      events.push(
        messageEvent(
          toolResultMessage(
            id,
            {
              content: [{ type: 'text', text: 'Sub-agent spawn failed.' }],
              structuredContent: { provider: 'codex', status: 'failed' },
            },
            true,
          ),
        ),
      )
    }
    return events
  }

  private trackCollabToolCall(item: Record<string, unknown>, id: string | null) {
    if (item.type !== 'collab_tool_call' || item.tool !== 'spawn_agent' || !id) return
    for (const agentId of collabReceiverThreadIds(item)) {
      this.agentToolCallIdByAgentId.set(agentId, id)
    }
  }

  private mapCollabAgentFinals(item: Record<string, unknown>): AmaRuntimeEvent[] {
    return collabFinalsFromCodexToolCall(item).flatMap((final) => {
      const toolCallId = this.agentToolCallIdByAgentId.get(final.agentId)
      if (!toolCallId || this.finalizedAgentIds.has(final.agentId)) return []
      this.finalizedAgentIds.add(final.agentId)
      return [
        messageEvent(
          toolResultMessage(
            toolCallId,
            {
              content: final.text ? [{ type: 'text', text: final.text }] : [],
              structuredContent: {
                agentId: final.agentId,
                status: final.status,
                provider: 'codex',
                rawStatus: final.rawStatus,
              },
            },
            final.failed,
          ),
        ),
      ]
    })
  }
}

export function codexEventsFromProviderEvents(providerEvents: unknown[]): AmaRuntimeEvent[] {
  const mapper = new CodexEventMapper()
  const events: AmaRuntimeEvent[] = []
  for (const providerEvent of providerEvents) {
    for (const event of mapper.map(providerEvent as ThreadEvent)) events.push(event)
  }
  return events
}

type CodexSubagentFinal = {
  agentId: string
  status: 'completed' | 'failed' | 'stopped'
  text: string
  failed: boolean
  rawStatus: unknown
}

function subagentFinalsFromCodexControl(
  input: Record<string, unknown>,
  output: Record<string, unknown>,
  failed: boolean,
): CodexSubagentFinal[] {
  if (failed) {
    return codexControlTargets(input).map((agentId) => ({
      agentId,
      status: 'failed',
      text: 'Sub-agent control call failed.',
      failed: true,
      rawStatus: output,
    }))
  }
  const status = objectValue(output.status)
  const finals = Object.entries(status).flatMap(([agentId, value]) => {
    const rawStatus = objectValue(value)
    return codexFinalStatus(agentId, rawStatus)
  })
  if (finals.length > 0) return finals
  const previousStatus = objectValue(output.previous_status)
  const agentId = codexControlTargets(input)[0]
  return agentId ? codexFinalStatus(agentId, previousStatus) : []
}

function codexControlTargets(input: Record<string, unknown>) {
  const targets = input.targets
  if (Array.isArray(targets)) return targets.flatMap((target) => (typeof target === 'string' && target ? [target] : []))
  return [input.target, input.agent_id, input.agentId].flatMap((target) =>
    typeof target === 'string' && target ? [target] : [],
  )
}

function codexFinalStatus(agentId: string, rawStatus: Record<string, unknown>): CodexSubagentFinal[] {
  for (const status of ['completed', 'failed', 'stopped'] as const) {
    if (!(status in rawStatus)) continue
    const value = rawStatus[status]
    return [
      {
        agentId,
        status,
        text: codexStatusText(agentId, status, value),
        failed: status !== 'completed',
        rawStatus,
      },
    ]
  }
  return []
}

function codexStatusText(agentId: string, status: CodexSubagentFinal['status'], value: unknown) {
  if (typeof value === 'string' && value) return value
  if (value !== undefined) return JSON.stringify(value)
  return `Sub-agent ${agentId} ${status}.`
}

function collabReceiverThreadIds(item: Record<string, unknown>): string[] {
  const ids = stringArrayValue(item.receiver_thread_ids)
  if (ids.length > 0) return ids
  return Object.keys(objectValue(item.agents_states))
}

function collabFinalsFromCodexToolCall(item: Record<string, unknown>): CodexSubagentFinal[] {
  return Object.entries(objectValue(item.agents_states)).flatMap(([agentId, value]) =>
    codexCollabFinalStatus(agentId, objectValue(value)),
  )
}

function codexCollabFinalStatus(agentId: string, rawStatus: Record<string, unknown>): CodexSubagentFinal[] {
  const status = stringValue(rawStatus.status)
  if (!status || status === 'pending_init' || status === 'running' || status === 'interrupted') return []
  const normalizedStatus: CodexSubagentFinal['status'] =
    status === 'completed' ? 'completed' : status === 'shutdown' ? 'stopped' : 'failed'
  const message = stringValue(rawStatus.message)
  return [
    {
      agentId,
      status: normalizedStatus,
      text: message ?? `Sub-agent ${agentId} ${normalizedStatus}.`,
      failed: normalizedStatus !== 'completed',
      rawStatus,
    },
  ]
}

export const codexProvider: RuntimeProvider = {
  name: 'codex',
  binary: 'codex',
  fallbackModels: ['gpt-5.3-codex'],
  async execute(request: RuntimeProviderRequest): Promise<RuntimeProviderHandle> {
    let resumeToken = request.resumeToken
    const abortController = new AbortController()
    let stopped = false
    const queuedPrompts: string[] = [request.prompt]
    let wakePrompt: (() => void) | undefined
    const codexPathOverride = resolveCliPath('codex')
    const systemPrompt = agentSystemPrompt(request)
    const sessionHome = request.env.HOME
    const shellEnvironment = Object.fromEntries(
      [
        'HOME',
        'AMA_WORKSPACE_HOME',
        'GH_CONFIG_DIR',
        'GIT_CONFIG_GLOBAL',
        'GIT_CONFIG_NOSYSTEM',
        'TMPDIR',
        'TEMP',
        'TMP',
      ]
        .map((key) => [key, key === 'HOME' ? sessionHome : request.env[key]] as const)
        .filter((entry): entry is readonly [string, string] => Boolean(entry[1])),
    )
    const configuredSubagents = objectValue(request.agentSnapshot).subagents
    const hasNamedSubagents = Array.isArray(configuredSubagents) && configuredSubagents.length > 0
    const developerInstructions = [
      systemPrompt,
      hasNamedSubagents
        ? 'When spawning a configured named subagent, set fork_turns to "none"; full-history forks cannot select a named agent type.'
        : undefined,
    ]
      .filter((value): value is string => Boolean(value))
      .join('\n\n')
    const codex = new Codex({
      env: sdkEnv(request),
      // Managed sessions must not inherit the host user's personal Codex Apps
      // connectors (e.g. the GitHub connector creates PRs as the host user
      // instead of with the session-scoped git credential).
      config: {
        // Codex exec --json omits unified custom-tool events, while the standard shell
        // path emits correlated command_execution events that AMA can persist and relay.
        features: { apps: false, multi_agent: true, unified_exec: false },
        // The Codex process needs the host HOME for its provider login, but tool
        // subprocesses belong to the session and must never load host shell state.
        allow_login_shell: false,
        shell_environment_policy: {
          inherit: 'all',
          set: shellEnvironment,
        },
        ...(developerInstructions ? { developer_instructions: developerInstructions } : {}),
      },
      ...(codexPathOverride ? { codexPathOverride } : {}),
    })
    const model = resolveModel(request)
    const threadOptions = {
      workingDirectory: request.cwd,
      skipGitRepoCheck: true,
      ...codexPermissionPolicy(),
      ...(model ? { model } : {}),
    }
    const thread =
      request.resume && resumeToken ? codex.resumeThread(resumeToken, threadOptions) : codex.startThread(threadOptions)
    const idleKeepAliveMs = positiveNumber(request.runtimeConfig?.codexIdleKeepAliveMs)
    const mapper = new CodexEventMapper()
    const nextPrompt = async (): Promise<string | undefined> => {
      const queued = queuedPrompts.shift()
      if (queued !== undefined) return queued
      if (!idleKeepAliveMs || stopped) return undefined
      return await new Promise<string | undefined>((resolve) => {
        const timer = setTimeout(() => {
          wakePrompt = undefined
          resolve(undefined)
        }, idleKeepAliveMs)
        wakePrompt = () => {
          clearTimeout(timer)
          wakePrompt = undefined
          resolve(queuedPrompts.shift())
        }
      })
    }
    const events = (async function* () {
      while (!stopped) {
        const prompt = await nextPrompt()
        if (prompt === undefined) return
        const streamed = await thread.runStreamed(prompt, { signal: abortController.signal })
        for await (const event of streamed.events) {
          request.emitProviderEvent?.(objectValue(event))
          if (event.type === 'thread.started') {
            resumeToken = event.thread_id
            mapper.setThreadId(event.thread_id)
          }
          yield* mapper.map(event)
        }
      }
    })()
    return {
      events,
      async abort() {
        stopped = true
        wakePrompt?.()
        abortController.abort()
      },
      async send(message: string) {
        if (stopped) throw new Error('Codex runtime is stopped')
        queuedPrompts.push(message)
        wakePrompt?.()
      },
      getResumeToken() {
        return resumeToken
      },
    }
  },

  // Enumerate the models the host Codex login can serve from the CLI's own
  // models cache (~/.codex/models_cache.json, populated when Codex runs).
  // There is no SDK listing call; the cache is the host's model universe.
  async listModels({ env }): Promise<string[] | null> {
    const home = hostHome(env) ?? process.env.HOME
    if (!home) return null
    let raw: string
    try {
      raw = readFileSync(join(home, '.codex', 'models_cache.json'), 'utf8')
    } catch {
      return null
    }
    const data = JSON.parse(raw) as { models?: Array<{ slug?: string; visibility?: string; priority?: number }> }
    const models = (data.models ?? [])
      .filter((model) => typeof model.slug === 'string' && model.slug && model.visibility !== 'hide')
      .sort((left, right) => (left.priority ?? 0) - (right.priority ?? 0))
      .map((model) => model.slug as string)
    return models.length > 0 ? models : null
  },

  async fetchUsage({ env }): Promise<RuntimeUsageWindow[] | null> {
    const token = codexAccessToken(hostHome(env))
    if (!token) return null
    const res = await fetch(CODEX_USAGE_API, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(5000),
    })
    if (!res.ok) return null
    type RateLimitWindow = { used_percent: number; reset_at: number; limit_window_seconds: number }
    const data = (await res.json()) as {
      rate_limit?: { primary_window?: RateLimitWindow; secondary_window?: RateLimitWindow }
    }
    const windowLabel = (secs: number) => (secs <= 18000 ? '5-Hour' : 'Weekly')
    const windows: RuntimeUsageWindow[] = []
    for (const window of [data.rate_limit?.primary_window, data.rate_limit?.secondary_window]) {
      if (!window) continue
      windows.push({
        label: windowLabel(window.limit_window_seconds),
        utilization: window.used_percent,
        resetsAt: new Date(window.reset_at * 1000).toISOString(),
      })
    }
    return windows
  },
}
