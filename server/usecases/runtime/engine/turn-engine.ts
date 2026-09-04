// The Enbor turn-execution core. It drives the pi-agent-core loop,
// gates tools through the policy port, emits runtime events to the sink, and
// reaches the model and the sandbox only through the ModelClient / ToolExecutor
// ports. The loop runs in the cloud control plane; self-hosted Enbor sessions use
// the same cloud loop with a runner-backed sandbox executor.

import {
  Agent,
  type AgentEvent,
  type AgentMessage,
  type AgentTool,
  type AgentToolResult,
} from '@earendil-works/pi-agent-core'
import {
  type AssistantMessage,
  type AssistantMessageEventStream,
  type Context,
  createAssistantMessageEventStream,
  type Model,
  type StreamOptions,
  type ToolCall,
  type Usage,
} from '@earendil-works/pi-ai'
import {
  enborSandboxToolInputJsonSchema,
  parseEnborSandboxToolInput,
  parseEnborSandboxToolOutput,
} from '@enbor/runtime-contracts/tool-contracts'
import { ENBOR_SANDBOX_TOOL_NAMES, type EnborSandboxToolName } from '@shared/agent-tools'
import type {
  EnborEvent,
  ToolCall as EnborToolCall,
  Message,
  MessageContentBlock,
  ToolResult,
  ToolResultValueContentBlock,
} from '@shared/session-events'
import {
  CANCELLATION_REASON,
  isRuntimeTurnCancelled,
  ProviderCallError,
  RuntimePolicyDeniedError,
  type RuntimeProviderError,
  RuntimeTurnCancelledError,
} from './errors'
import type {
  ModelClient,
  ToolExecutor,
  ToolPolicyGate,
  ToolResultResolver,
  TurnBudget,
  TurnEngineInput,
  TurnEngineResult,
  TurnLiveness,
} from './ports'
import { subagentTools } from './subagent-tools'
import { persistedToolCallIds, reserveToolCallIds } from './tool-call-ids'
import { reduceTurnStatus, type TurnStatus } from './turn-status'

// runtimeMessagesFromEvents moved to ./transcript; re-exported here for the
// existing import paths.
export { runtimeMessagesFromEvents } from './transcript'

export const ZERO_USAGE: Usage = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
}

export function assistantMessage(
  model: Model<string>,
  content: AssistantMessage['content'],
  stopReason: AssistantMessage['stopReason'],
  usage: Usage,
  errorMessage?: string,
): AssistantMessage {
  return {
    role: 'assistant',
    content,
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage,
    stopReason,
    ...(errorMessage ? { errorMessage } : {}),
    timestamp: Date.now(),
  }
}

export function emitAssistantMessage(stream: AssistantMessageEventStream, message: AssistantMessage) {
  stream.push({ type: 'start', partial: { ...message, content: [] } })
  const partial: AssistantMessage = { ...message, content: [] }
  // contentIndex must track the position in `partial.content` (which only grows
  // for emitted text/toolCall blocks), NOT the source index — otherwise any
  // skipped block desyncs the two index spaces and the partial mutation lands on
  // the wrong (or an undefined) slot.
  for (const block of message.content) {
    if (!block) {
      continue
    }
    if (block.type === 'text') {
      const contentIndex = partial.content.length
      partial.content = [...partial.content, { type: 'text', text: '' }]
      stream.push({ type: 'text_start', contentIndex, partial: { ...partial } })
      ;(partial.content[contentIndex] as { type: 'text'; text: string }).text = block.text
      stream.push({ type: 'text_delta', contentIndex, delta: block.text, partial: { ...partial } })
      stream.push({ type: 'text_end', contentIndex, content: block.text, partial: { ...partial } })
      continue
    }
    if (block.type === 'toolCall') {
      const contentIndex = partial.content.length
      partial.content = [...partial.content, { type: 'toolCall', id: block.id, name: block.name, arguments: {} }]
      stream.push({ type: 'toolcall_start', contentIndex, partial: { ...partial } })
      ;(partial.content[contentIndex] as ToolCall).arguments = block.arguments
      stream.push({
        type: 'toolcall_delta',
        contentIndex,
        delta: JSON.stringify(block.arguments),
        partial: { ...partial },
      })
      stream.push({ type: 'toolcall_end', contentIndex, toolCall: block, partial: { ...partial } })
    }
  }
  if (message.stopReason === 'error' || message.stopReason === 'aborted') {
    stream.push({ type: 'error', reason: message.stopReason, error: message })
  } else {
    stream.push({ type: 'done', reason: message.stopReason, message })
  }
  stream.end(message)
}

export async function ensureTurnActive(signal: AbortSignal, ensureActive: () => Promise<void>) {
  if (signal.aborted) {
    throw new RuntimeTurnCancelledError(CANCELLATION_REASON)
  }
  await ensureActive()
  if (signal.aborted) {
    throw new RuntimeTurnCancelledError(CANCELLATION_REASON)
  }
}

function stringifyToolOutput(result: Record<string, unknown>) {
  if (typeof result.stdout === 'string' || typeof result.stderr === 'string') {
    return [result.stdout, result.stderr]
      .filter((value): value is string => typeof value === 'string' && value.length > 0)
      .join('\n')
  }
  if (typeof result.content === 'string') {
    return result.content
  }
  return JSON.stringify(result)
}

function runtimeSystemPrompt(snapshot: Record<string, unknown>) {
  const systemPrompt = typeof snapshot.systemPrompt === 'string' ? snapshot.systemPrompt.trim() : ''
  return (
    systemPrompt ||
    'You are an Enbor cloud-owned coding agent. Use tools when workspace inspection or edits are needed.'
  )
}

function runtimeTools(
  executor: ToolExecutor,
  values: {
    sessionId: string
    sandboxId: string
    agentSnapshot: Record<string, unknown>
    policy: ToolPolicyGate
    toolResults: ToolResultResolver
    liveness: TurnLiveness
    engineSignal: AbortSignal
  },
) {
  const ensure = (signal: AbortSignal | undefined) =>
    ensureTurnActive(signal ?? values.engineSignal, () => values.liveness.ensureActive())
  const tool = (name: EnborSandboxToolName, label: string, description: string): AgentTool =>
    ({
      name,
      label,
      description,
      parameters: enborSandboxToolInputJsonSchema(name) as AgentTool['parameters'],
      executionMode: 'sequential',
      async execute(toolCallId, params, signal): Promise<AgentToolResult<Record<string, unknown>>> {
        const input = parseEnborSandboxToolInput(name, params)
        await ensure(signal)
        const decision = await values.policy.approve({ toolCallId, toolName: name, input })
        if (!decision.allowed) {
          throw new RuntimePolicyDeniedError(decision.reason ?? `Tool call blocked by Enbor policy: ${name}`)
        }
        await ensure(signal)
        const providedResult = await values.toolResults.resolve({ toolCallId, toolName: name, input })
        if (providedResult) {
          return {
            content: [{ type: 'text', text: stringifyToolOutput(providedResult) }],
            details: providedResult,
          }
        }
        const result = await executor.execute(
          {
            sessionId: values.sessionId,
            sandboxId: values.sandboxId,
            toolCallId,
            toolName: name,
            input,
            cwd: '/workspace',
          },
          signal,
        )
        await ensure(signal)
        if (result.error) {
          throw new Error(JSON.stringify(result.error))
        }
        const output = parseEnborSandboxToolOutput(name, result.output)
        return {
          content: [{ type: 'text', text: stringifyToolOutput(output) }],
          details: { ...output, durationMs: result.durationMs },
        }
      },
    }) satisfies AgentTool

  const allowedTools = Array.isArray(values.agentSnapshot.allowedTools)
    ? values.agentSnapshot.allowedTools.filter((tool): tool is string => typeof tool === 'string')
    : [...ENBOR_SANDBOX_TOOL_NAMES]
  const allowsTool = (toolName: string) => allowedTools.includes(toolName)

  return [
    tool('read', 'Read file', 'Read a UTF-8 file from the session workspace.'),
    tool('bash', 'Run command', 'Run a shell command in the session workspace.'),
    tool('edit', 'Edit file', 'Replace text in a UTF-8 file under the session workspace.'),
    tool('write', 'Write file', 'Write a UTF-8 file under the session workspace.'),
    tool('grep', 'Search text', 'Search workspace files for text using ripgrep-style matching.'),
    tool('find', 'Find files', 'Find workspace files by name pattern.'),
    tool('ls', 'List files', 'List files in a workspace directory.'),
    tool('fetch', 'Fetch URL', 'Fetch an HTTP(S) URL over the sandbox network, subject to the session network policy.'),
    tool('web_search', 'Search web', 'Search the web from inside the sandbox network.'),
  ].filter((candidate) => allowsTool(candidate.name))
}

function createTurnStreamFn(
  modelClient: ModelClient,
  values: {
    liveness: TurnLiveness
    markCancelled: () => void
    onProviderError: (normalized: RuntimeProviderError) => void
    budget?: TurnBudget
    markPaused: () => void
    engineSignal: AbortSignal
    terminalStatus: () => TurnStatus
    toolCallIds: Set<string>
  },
) {
  return (model: Model<string>, context: Context, options?: StreamOptions) => {
    const signal = options?.signal ?? values.engineSignal
    const stream = createAssistantMessageEventStream()
    queueMicrotask(async () => {
      try {
        const terminal = values.terminalStatus()
        if (terminal.kind !== 'idle') {
          emitAssistantMessage(
            stream,
            assistantMessage(
              model,
              [],
              terminal.kind === 'failed' ? 'error' : 'aborted',
              ZERO_USAGE,
              terminal.kind === 'failed' ? terminal.message : 'Paused for continuation',
            ),
          )
          return
        }
        if (signal.aborted) {
          emitAssistantMessage(stream, assistantMessage(model, [], 'aborted', ZERO_USAGE, CANCELLATION_REASON))
          return
        }
        // Only pause once the transcript already contains assistant progress;
        // the first model call of an invocation always runs.
        if (values.budget?.shouldPause() && context.messages.some((message) => message.role === 'assistant')) {
          values.markPaused()
          emitAssistantMessage(stream, assistantMessage(model, [], 'aborted', ZERO_USAGE, 'Paused for continuation'))
          return
        }
        await ensureTurnActive(signal, () => values.liveness.ensureActive())
        const message = await modelClient.complete(model, context, signal)
        await ensureTurnActive(signal, () => values.liveness.ensureActive())
        emitAssistantMessage(stream, reserveToolCallIds(message, values.toolCallIds))
      } catch (error) {
        if (isRuntimeTurnCancelled(error)) {
          values.markCancelled()
        }
        const aborted = signal.aborted || isRuntimeTurnCancelled(error)
        if (!aborted && error instanceof ProviderCallError) {
          values.onProviderError(error.normalized)
        }
        emitAssistantMessage(
          stream,
          assistantMessage(
            model,
            [],
            aborted ? 'aborted' : 'error',
            ZERO_USAGE,
            error instanceof Error ? error.message : 'Model request failed',
          ),
        )
      }
    })
    return stream
  }
}

function usageEvent(message: AgentMessage, model: string): EnborEvent<'usage.recorded'> | null {
  if (message.role !== 'assistant') {
    return null
  }
  return {
    type: 'usage.recorded',
    payload: {
      model,
      promptTokens: message.usage.input,
      completionTokens: message.usage.output,
      totalTokens: message.usage.totalTokens,
    },
  }
}

class PiAgentEventMapper {
  private activeMessageId: string | null = null
  private lastMessageId: string | null = null
  private readonly toolMessageIds = new Map<string, string>()

  map(event: AgentEvent): EnborEvent[] {
    switch (event.type) {
      case 'agent_start':
        return [{ type: 'runtime.started', payload: {} }]
      case 'agent_end':
        return [{ type: 'runtime.completed', payload: {} }]
      case 'turn_start':
        return [{ type: 'turn.started', payload: {} }]
      case 'turn_end':
        return [
          {
            type: 'turn.completed',
            payload: { message: enborMessage(event.message, this.messageIdFor(event.message, this.lastMessageId)) },
          },
        ]
      case 'message_start': {
        const id = this.startMessage(event.message)
        return [{ type: 'message.started', payload: { message: enborMessage(event.message, id) } }]
      }
      case 'message_update':
        return [
          {
            type: 'message.updated',
            payload: { message: enborMessage(event.message, this.messageIdFor(event.message, this.activeMessageId)) },
          },
        ]
      case 'message_end': {
        const id = this.messageIdFor(event.message, this.activeMessageId)
        this.lastMessageId = id
        this.activeMessageId = null
        return [{ type: 'message.completed', payload: { message: enborMessage(event.message, id) } }]
      }
      case 'tool_execution_update':
        return [
          {
            type: 'message.updated',
            payload: {
              message: enborToolResultMessage(
                {
                  toolCallId: event.toolCallId,
                  result: agentToolResult(event.partialResult),
                },
                this.toolMessageId(event.toolCallId),
              ),
            },
          },
        ]
      case 'tool_execution_start':
      case 'tool_execution_end':
        return []
    }
  }

  private startMessage(message: AgentMessage) {
    const id = this.messageIdFor(message, this.activeMessageId)
    this.activeMessageId = id
    this.lastMessageId = id
    return id
  }

  private messageIdFor(message: AgentMessage, fallback: string | null) {
    if (message.role === 'toolResult' && typeof message.toolCallId === 'string') {
      return this.toolMessageId(message.toolCallId)
    }
    return messageId(message, fallback ?? undefined)
  }

  private toolMessageId(toolCallId: string) {
    const existing = this.toolMessageIds.get(toolCallId)
    if (existing) {
      return existing
    }
    const id = crypto.randomUUID()
    this.toolMessageIds.set(toolCallId, id)
    return id
  }
}

function enborMessage(message: AgentMessage, id?: string): Message {
  if (message.role !== 'user' && message.role !== 'assistant' && message.role !== 'toolResult') {
    return {
      id: id ?? crypto.randomUUID(),
      role: 'system',
      content: [{ type: 'text', text: JSON.stringify(message) }],
    }
  }
  return {
    id: messageId(message, id),
    role: message.role === 'toolResult' ? 'tool' : message.role,
    content: enborContentBlocks(message),
    ...(message.role === 'assistant' ? { stopReason: message.stopReason } : {}),
    ...(message.role === 'toolResult' && typeof message.toolCallId === 'string'
      ? { parentToolCallId: message.toolCallId }
      : {}),
  }
}

function messageId(message: AgentMessage, fallback?: string) {
  const id = 'id' in message ? message.id : undefined
  return typeof id === 'string' && id ? id : (fallback ?? crypto.randomUUID())
}

function enborContentBlocks(message: AgentMessage): MessageContentBlock[] {
  if (message.role !== 'user' && message.role !== 'assistant' && message.role !== 'toolResult') {
    return [{ type: 'text', text: JSON.stringify(message) }]
  }
  if (message.role === 'toolResult') {
    const toolCallId = typeof message.toolCallId === 'string' ? message.toolCallId : ''
    const result = enborToolResult(message)
    return [
      {
        type: 'tool_result',
        toolCallId,
        result,
        ...(message.isError ? { error: { message: toolResultText(result) || 'Tool execution failed' } } : {}),
      },
    ]
  }
  if (message.role === 'user' && typeof message.content === 'string') {
    return message.content ? [{ type: 'text', text: message.content }] : []
  }
  const content = Array.isArray(message.content) ? message.content : []
  return content.flatMap((block): MessageContentBlock[] => {
    if (block.type === 'text') {
      return [{ type: 'text', text: block.text }]
    }
    if (block.type === 'thinking') {
      return [{ type: 'reasoning', text: block.thinking }]
    }
    if (block.type === 'toolCall') {
      return [{ type: 'tool_call', toolCall: enborToolCall(block) }]
    }
    if (block.type === 'image') {
      return [{ type: 'image', data: block.data, mediaType: block.mimeType }]
    }
    return []
  })
}

function enborToolCall(block: ToolCall): EnborToolCall {
  return { id: block.id, name: block.name, input: block.arguments }
}

function enborToolResultMessage(
  event: { toolCallId: string; result: AgentToolResult<unknown>; isError?: boolean },
  id: string = crypto.randomUUID(),
): Message {
  const result = enborToolResultFromAgentResult(event.result)
  return {
    id,
    role: 'tool',
    parentToolCallId: event.toolCallId,
    content: [
      {
        type: 'tool_result',
        toolCallId: event.toolCallId,
        result,
        ...(event.isError ? { error: { message: toolResultText(result) || 'Tool execution failed' } } : {}),
      },
    ],
  }
}

function enborToolResult(message: Extract<AgentMessage, { role: 'toolResult' }>): ToolResult {
  return {
    content: message.content.flatMap((block): ToolResultValueContentBlock[] => {
      if (block.type === 'text') {
        return [{ type: 'text', text: block.text }]
      }
      if (block.type === 'image') {
        return [{ type: 'image', data: block.data, mediaType: block.mimeType }]
      }
      return [{ type: 'json', value: block }]
    }),
    ...(isJsonObject(message.details) ? { structuredContent: message.details } : {}),
  }
}

function enborToolResultFromAgentResult(result: AgentToolResult<unknown>): ToolResult {
  return {
    content: result.content.flatMap((block): ToolResultValueContentBlock[] => {
      if (block.type === 'text') {
        return [{ type: 'text', text: block.text }]
      }
      if (block.type === 'image') {
        return [{ type: 'image', data: block.data, mediaType: block.mimeType }]
      }
      return [{ type: 'json', value: block }]
    }),
    ...(isJsonObject(result.details) ? { structuredContent: result.details } : {}),
  }
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function agentToolResult(result: unknown): AgentToolResult<unknown> {
  if (!isAgentToolResult(result)) {
    throw new TypeError('tool execution update partialResult must be an AgentToolResult')
  }
  return result
}

function isAgentToolResult(result: unknown): result is AgentToolResult<unknown> {
  return result !== null && typeof result === 'object' && Array.isArray((result as { content?: unknown }).content)
}

function toolResultText(result: ToolResult) {
  return result.content.map((block) => (block.type === 'text' ? block.text : '')).join('')
}

function turnFailureMessage(event: AgentEvent) {
  if (event.type === 'message_end' && event.message.role === 'assistant') {
    if (event.message.stopReason === 'aborted') {
      return CANCELLATION_REASON
    }
    if (event.message.stopReason === 'error') {
      return event.message.errorMessage ?? 'Runtime model request failed'
    }
  }
  return null
}

// Maps the accumulated terminal status to the engine result. A 'failed' status
// throws (the caller's catch rethrows it); cancelled surfaces as 'aborted'. Kept
// as a function so its TurnStatus param holds the full union — the `status` local
// in runTurn is narrowed to its initializer by control-flow analysis because it
// is only reassigned inside callbacks.
function resolveTurnResult(status: TurnStatus): TurnEngineResult {
  switch (status.kind) {
    case 'paused':
      return { status: 'paused' }
    case 'cancelled':
      return { status: 'aborted' }
    case 'failed':
      throw new Error(status.message)
    default:
      return { status: 'idle' }
  }
}

export async function runTurn(
  input: TurnEngineInput,
  toolCallIds = persistedToolCallIds([
    ...(input.messages ?? []),
    ...Object.values(input.subagentMessages ?? {}).flat(),
  ]),
): Promise<TurnEngineResult> {
  const controller = new AbortController()
  const abortFromParent = () => controller.abort()
  // Link an external cancellation source (session stop / client disconnect) to
  // the engine controller so it aborts the in-flight agent loop. Additive: when
  // no signal is supplied the engine still relies on the cooperative liveness
  // check, but cancellation is never silently disabled by a throwaway signal.
  if (input.signal) {
    if (input.signal.aborted) {
      controller.abort()
    } else {
      input.signal.addEventListener('abort', abortFromParent, { once: true })
    }
  }
  const { model } = input
  const modelId = input.modelLabel
  let status: TurnStatus = { kind: 'idle' }
  let providerError: RuntimeProviderError | null = null
  let policyFailure: string | null = null
  let requiresAction = false
  const policy: ToolPolicyGate = {
    approve: async (toolCall) => {
      if (status.kind === 'failed') throw new RuntimePolicyDeniedError(status.message)
      if (status.kind !== 'idle') throw new RuntimeTurnCancelledError()
      const decision = await input.policy.approve(toolCall)
      if (!decision.allowed) policyFailure = decision.reason ?? 'Tool call blocked by Enbor policy'
      if (decision.requiresAction) requiresAction = true
      return decision
    },
  }
  const agent = new Agent({
    initialState: {
      systemPrompt: runtimeSystemPrompt(input.agentSnapshot),
      model,
      tools: [
        ...runtimeTools(input.executor, {
          sessionId: input.sessionId,
          sandboxId: input.sandboxId,
          agentSnapshot: input.agentSnapshot,
          policy,
          toolResults: input.toolResults,
          liveness: input.liveness,
          engineSignal: controller.signal,
        }),
        ...subagentTools(
          { ...input, policy },
          (child) => runTurn(child, toolCallIds),
          controller.signal,
          () => {
            status = reduceTurnStatus(status, { type: 'pause' })
            controller.abort()
          },
        ),
      ],
      messages: input.messages ?? [],
    },
    streamFn: createTurnStreamFn(input.modelClient, {
      liveness: input.liveness,
      markCancelled: () => {
        status = reduceTurnStatus(status, { type: 'cancel' })
      },
      onProviderError: (normalized) => {
        providerError = normalized
      },
      ...(input.budget ? { budget: input.budget } : {}),
      markPaused: () => {
        status = reduceTurnStatus(status, { type: 'pause' })
      },
      engineSignal: controller.signal,
      terminalStatus: () => status,
      toolCallIds,
    }),
    toolExecution: 'sequential',
    sessionId: input.sessionId,
  })

  const eventMapper = new PiAgentEventMapper()

  agent.subscribe(async (event: AgentEvent) => {
    // Everything after a pause is filler from the synthetic paused message;
    // completed turns are already persisted and the continuation rebuilds them.
    const deniedToolResult =
      status.kind === 'failed' && !requiresAction && event.type === 'message_end' && event.message.role === 'toolResult'
    if (status.kind === 'paused' || (status.kind === 'failed' && !deniedToolResult)) {
      return
    }
    try {
      await ensureTurnActive(controller.signal, () => input.liveness.ensureActive())
    } catch (error) {
      if (isRuntimeTurnCancelled(error)) {
        status = reduceTurnStatus(status, { type: 'cancel' })
        agent.abort()
        return
      }
      throw error
    }
    const eventFailure = turnFailureMessage(event)
    const policyEventFailure = event.type === 'tool_execution_end' && event.isError ? policyFailure : null
    if (policyEventFailure) {
      policyFailure = null
      status = reduceTurnStatus(status, { type: 'fail', message: policyEventFailure })
      return
    } else if (eventFailure) {
      status = reduceTurnStatus(
        status,
        eventFailure === CANCELLATION_REASON ? { type: 'cancel' } : { type: 'fail', message: eventFailure },
      )
    }
    for (const enborEvent of eventMapper.map(event)) {
      await input.sink.emit(enborEvent)
    }
    if (event.type === 'message_end') {
      const usage = usageEvent(event.message, modelId)
      if (usage) {
        await input.sink.emit(usage)
      }
      // Surface adapter-normalized provider failures as canonical runtime.error
      // events: stable category, safe message, retry metadata.
      if (event.message.role === 'assistant' && event.message.stopReason === 'error' && providerError) {
        const normalized: RuntimeProviderError = providerError
        providerError = null
        await input.sink.emit({
          type: 'runtime.error',
          payload: {
            message: normalized.message,
            category: normalized.category,
            retryable: normalized.retryable,
            ...(normalized.retryAfterSeconds !== undefined ? { retryAfterSeconds: normalized.retryAfterSeconds } : {}),
          },
        })
      }
    }
  })

  controller.signal.addEventListener('abort', () => agent.abort(), { once: true })
  try {
    await ensureTurnActive(controller.signal, () => input.liveness.ensureActive())
    if (input.continuation) {
      // A delegation can yield while its caller is still awaiting a result.
      // Re-enter the exact pending call, with its persisted child conversation.
      const messages = agent.state.messages
      let lastAssistantIndex = messages.length - 1
      while (lastAssistantIndex >= 0 && messages[lastAssistantIndex]?.role !== 'assistant') lastAssistantIndex--
      const lastAssistant = messages[lastAssistantIndex]
      if (lastAssistant?.role === 'assistant') {
        for (const call of lastAssistant.content) {
          if (
            call.type !== 'toolCall' ||
            messages
              .slice(lastAssistantIndex + 1)
              .some((message) => message.role === 'toolResult' && message.toolCallId === call.id)
          )
            continue
          const tool = agent.state.tools.find((candidate) => candidate.name === call.name)
          if (!tool) throw new Error(`Cannot resume unavailable tool: ${call.name}`)
          let result: AgentToolResult<unknown>
          try {
            result = await tool.execute(call.id, call.arguments, controller.signal)
          } catch (error) {
            if (status.kind !== 'idle') return resolveTurnResult(status)
            throw error
          }
          const message: AgentMessage = {
            role: 'toolResult',
            toolCallId: call.id,
            toolName: call.name,
            content: result.content,
            details: result.details,
            isError: false,
            timestamp: Date.now(),
          }
          await input.sink.emit({ type: 'message.completed', payload: { message: enborMessage(message) } })
          agent.state.messages = [...agent.state.messages, message]
        }
      }
      await agent.continue()
    } else {
      if (typeof input.prompt !== 'string') {
        throw new Error('Session turn requires a prompt unless it is a continuation')
      }
      await agent.prompt(input.prompt)
    }
    await agent.waitForIdle()
    // A pause only fires when the loop was about to start another model call,
    // so by construction the run still has work for a continuation.
    return resolveTurnResult(status)
  } catch (error) {
    if (isRuntimeTurnCancelled(error)) {
      return { status: 'aborted' }
    }
    throw error
  } finally {
    input.signal?.removeEventListener('abort', abortFromParent)
    agent.abort()
  }
}
