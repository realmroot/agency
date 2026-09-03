import type { AssistantMessage, Context, Model, ToolCall, Usage } from '@earendil-works/pi-ai'
import { extractProviderUsage, normalizeProviderError, providerFamily } from '../../domain/provider-adapter'
import { aiGatewayFor } from '../../domain/runtime-catalog'
import type { Env } from '../../env'
import {
  isRuntimeTurnCancelled,
  ProviderCallError,
  RuntimeTurnCancelledError,
} from '../../usecases/runtime/engine/errors'
import type { ModelClient } from '../../usecases/runtime/engine/ports'
import { assistantMessage, ZERO_USAGE } from '../../usecases/runtime/engine/turn-engine'

// The Worker host's ModelClient adapter: Workers AI egress with deterministic
// test-mode simulation. Owns the OpenAI request/response mapping and
// provider-error normalization so the Enbor turn engine stays
// platform-free. Failures are normalized through the provider adapter before
// they leave this seam.

function textContent(value: unknown) {
  if (typeof value === 'string') {
    return value
  }
  if (!Array.isArray(value)) {
    return ''
  }
  return (value as unknown[])
    .map((item) => {
      if (item && typeof item === 'object' && 'type' in item && item.type === 'text' && 'text' in item) {
        return String(item.text)
      }
      return ''
    })
    .join('')
}

function openAiMessages(context: Context) {
  const messages: Array<Record<string, unknown>> = []
  if (context.systemPrompt) {
    messages.push({ role: 'system', content: context.systemPrompt })
  }
  for (const message of context.messages) {
    if (message.role === 'user') {
      messages.push({ role: 'user', content: textContent(message.content) })
      continue
    }
    if (message.role === 'assistant') {
      const content = Array.isArray(message.content) ? message.content : []
      const text =
        typeof message.content === 'string'
          ? message.content
          : content
              .filter((block) => block.type === 'text')
              .map((block) => block.text)
              .join('')
      const toolCalls = content
        .filter((block): block is ToolCall => block.type === 'toolCall')
        .map((block) => ({
          id: block.id,
          type: 'function',
          function: { name: block.name, arguments: JSON.stringify(block.arguments) },
        }))
      messages.push({
        role: 'assistant',
        content: text,
        ...(toolCalls.length ? { tool_calls: toolCalls } : {}),
      })
      continue
    }
    messages.push({
      role: 'tool',
      tool_call_id: message.toolCallId,
      name: message.toolName,
      content: textContent(message.content),
    })
  }
  return messages
}

function openAiTools(context: Context) {
  return (context.tools ?? []).map((tool) => ({
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  }))
}

function usageFromProvider(provider: string, raw: Record<string, unknown> | null): Usage {
  const usage = extractProviderUsage(providerFamily(provider), raw)
  if (!usage) {
    return ZERO_USAGE
  }
  return {
    input: usage.promptTokens,
    output: usage.completionTokens,
    cacheRead: usage.cacheReadTokens,
    cacheWrite: usage.cacheWriteTokens,
    totalTokens: usage.totalTokens,
    cost: ZERO_USAGE.cost,
  }
}

function parseToolArguments(value: unknown) {
  if (!value) {
    return {}
  }
  if (typeof value === 'string') {
    return JSON.parse(value) as Record<string, unknown>
  }
  if (typeof value === 'object') {
    return value as Record<string, unknown>
  }
  return {}
}

function providerAssistantMessage(model: Model<string>, raw: unknown) {
  const record = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : null
  const choice =
    Array.isArray(record?.choices) && record.choices[0] && typeof record.choices[0] === 'object'
      ? (record.choices[0] as Record<string, unknown>)
      : null
  const message =
    choice?.message && typeof choice.message === 'object' ? (choice.message as Record<string, unknown>) : null
  const content: AssistantMessage['content'] = []
  const text = textContent(message?.content ?? record?.response ?? record?.text ?? raw)
  if (text) {
    content.push({ type: 'text', text })
  }
  const toolCalls = Array.isArray(message?.tool_calls) ? message.tool_calls : []
  for (const toolCall of toolCalls) {
    if (!toolCall || typeof toolCall !== 'object') {
      continue
    }
    const call = toolCall as Record<string, unknown>
    const fn = call.function && typeof call.function === 'object' ? (call.function as Record<string, unknown>) : {}
    const name = typeof fn.name === 'string' ? fn.name : typeof call.name === 'string' ? call.name : null
    const id = typeof call.id === 'string' && call.id ? call.id : null
    if (!name || !id) {
      continue
    }
    content.push({
      type: 'toolCall',
      id,
      name,
      arguments: parseToolArguments(fn.arguments ?? call.arguments),
    })
  }
  return assistantMessage(
    model,
    content.length ? content : [{ type: 'text', text: '' }],
    toolCalls.length ? 'toolUse' : 'stop',
    usageFromProvider(model.provider, record),
  )
}

function testToolCallMessage(model: Model<string>, toolCall: ToolCall) {
  return assistantMessage(model, [toolCall], 'toolUse', {
    ...ZERO_USAGE,
    input: 10,
    output: 4,
    totalTokens: 14,
  })
}

// Deterministic tool-call grammar for AMA_RUNTIME_MODE=test prompts, so e2e
// scenarios can drive specific sandbox operations through the real agent loop.
function testPromptToolCall(prompt: string): ToolCall | null {
  const write = prompt.match(/write the file (\S+) with content (.+)$/i)
  if (write?.[1] && write[2]) {
    return {
      type: 'toolCall',
      id: 'call_write_file',
      name: 'write',
      arguments: { path: write[1], content: write[2].trim() },
    }
  }
  const read = prompt.match(/read the file (\S+)/i)
  if (read?.[1]) {
    return { type: 'toolCall', id: 'call_read_file', name: 'read', arguments: { path: read[1] } }
  }
  const url = prompt.match(/https?:\/\/[^\s"']+/)
  if (url && /fetch|download|outbound/i.test(prompt)) {
    return { type: 'toolCall', id: 'call_fetch_url', name: 'fetch', arguments: { url: url[0] } }
  }
  const search = prompt.match(/(?:search|web search|look up)\s+(.+)$/i)
  if (search?.[1]) {
    return { type: 'toolCall', id: 'call_web_search', name: 'web_search', arguments: { query: search[1].trim() } }
  }
  const command = prompt.match(/run the sandbox command "([^"]+)"/i)
  if (command?.[1]) {
    return { type: 'toolCall', id: 'call_sandbox_command', name: 'bash', arguments: { command: command[1] } }
  }
  if (/status|inspect|whoami|command|sandbox/i.test(prompt)) {
    return { type: 'toolCall', id: 'call_git_status', name: 'bash', arguments: { command: 'git status' } }
  }
  return null
}

// Test-mode provider failure simulation: prompts of the form
// "simulate provider <category> error" throw a raw, provider-shaped error so
// the real adapter normalization path is exercised end to end. The raw
// payload deliberately embeds marker text that must never surface.
const SIMULATED_PROVIDER_ERROR_RE =
  /simulate provider (auth|quota|rate limit|model unavailable|invalid request|network|unknown) error/i

function simulatedProviderFailure(prompt: string): unknown | null {
  const match = SIMULATED_PROVIDER_ERROR_RE.exec(prompt)
  if (!match?.[1]) {
    return null
  }
  const marker = 'raw-provider-error-detail'
  switch (match[1].toLowerCase()) {
    case 'auth':
      return Object.assign(new Error(`401 invalid api key sk-${marker}`), { status: 401, code: 'invalid_api_key' })
    case 'quota':
      return Object.assign(new Error(`429 insufficient_quota ${marker}`), { status: 429, code: 'insufficient_quota' })
    case 'rate limit':
      return Object.assign(new Error(`429 too many requests ${marker}`), {
        status: 429,
        code: 'rate_limit_exceeded',
        retryAfterSeconds: 7,
      })
    case 'model unavailable':
      return Object.assign(new Error(`404 model_not_found ${marker}`), { status: 404, code: 'model_not_found' })
    case 'invalid request':
      return Object.assign(new Error(`400 invalid_request_error ${marker}`), {
        status: 400,
        code: 'invalid_request_error',
      })
    case 'network':
      return new TypeError(`fetch failed ${marker}`)
    default:
      return new Error(`provider call collapsed without diagnostics ${marker}`)
  }
}

function testAssistantMessage(model: Model<string>, context: Context) {
  const latestMessage = context.messages.at(-1)
  if (latestMessage?.role === 'toolResult') {
    const resultText = textContent(latestMessage.content)
    return assistantMessage(model, [{ type: 'text', text: `Tool result observed: ${resultText || 'ok'}` }], 'stop', {
      ...ZERO_USAGE,
      input: 12,
      output: 7,
      totalTokens: 19,
    })
  }
  const latestUser = [...context.messages].reverse().find((message) => message.role === 'user')
  const prompt = latestUser && latestUser.role === 'user' ? textContent(latestUser.content) : ''
  // The explicit tool-call grammar wins over the fuzzy previous-prompt echo:
  // a quoted sandbox command may legitimately contain words like "history".
  const explicitToolCall = testPromptToolCall(prompt)
  if (explicitToolCall) {
    return testToolCallMessage(model, explicitToolCall)
  }
  if (/previous prompt|prior prompt|history/i.test(prompt)) {
    const previousUser = [...context.messages]
      .reverse()
      .filter((message) => message.role === 'user')
      .at(1)
    const previousPrompt = previousUser && previousUser.role === 'user' ? textContent(previousUser.content) : ''
    return assistantMessage(
      model,
      [{ type: 'text', text: `Previous user prompt: ${previousPrompt || 'none'}` }],
      'stop',
      {
        ...ZERO_USAGE,
        input: 11,
        output: 6,
        totalTokens: 17,
      },
    )
  }
  const toolCall = testPromptToolCall(prompt)
  if (toolCall) {
    return testToolCallMessage(model, toolCall)
  }
  return assistantMessage(model, [{ type: 'text', text: `Enbor runtime processed: ${prompt}` }], 'stop', {
    ...ZERO_USAGE,
    input: 9,
    output: 5,
    totalTokens: 14,
  })
}

// A single transient Workers AI failure (capacity, 5xx, or an opaque "unknown"
// with no status) must not kill a multi-turn cloud session: the turn engine
// treats any ProviderCallError as terminal, so transient errors are retried
// here in the adapter before one is surfaced.
const PROVIDER_MAX_ATTEMPTS = 3

function providerRetryBackoffMs(attempt: number): number {
  return Math.min(500 * 2 ** (attempt - 1), 4000)
}

function isRetryableProviderError(error: ProviderCallError): boolean {
  const { category, retryable } = error.normalized
  // rate_limit/network are already flagged retryable. This adapter only ever
  // talks to Workers AI, which surfaces transient upstream/capacity failures
  // as an opaque 'unknown' (no status/code), so treat those as retryable too.
  return retryable || category === 'unknown'
}

export function workersAiModelClient(env: Env): ModelClient {
  return {
    async complete(model, context, signal) {
      if (env.AMA_RUNTIME_MODE === 'test') {
        try {
          const latestUser = [...context.messages].reverse().find((message) => message.role === 'user')
          const prompt = latestUser && latestUser.role === 'user' ? textContent(latestUser.content) : ''
          if (/wait for cancellation/i.test(prompt)) {
            await new Promise((resolve) => setTimeout(resolve, 100))
          }
          const simulated = simulatedProviderFailure(prompt)
          if (simulated) {
            throw simulated
          }
          return testAssistantMessage(model, context)
        } catch (error) {
          if (isRuntimeTurnCancelled(error) || error instanceof ProviderCallError) {
            throw error
          }
          throw new ProviderCallError(normalizeProviderError(providerFamily(model.provider), error))
        }
      }
      const gateway = aiGatewayFor(model.id, env.AMA_AI_GATEWAY_ID)
      let lastError: ProviderCallError | null = null
      for (let attempt = 1; attempt <= PROVIDER_MAX_ATTEMPTS; attempt += 1) {
        if (signal?.aborted) {
          throw new RuntimeTurnCancelledError()
        }
        try {
          return providerAssistantMessage(
            model,
            await env.AI.run(
              model.id,
              {
                model: model.id,
                messages: openAiMessages(context),
                tools: openAiTools(context),
              },
              { ...(gateway ? { gateway } : {}), ...(signal ? { signal } : {}) },
            ),
          )
        } catch (error) {
          if (isRuntimeTurnCancelled(error)) {
            throw error
          }
          lastError =
            error instanceof ProviderCallError
              ? error
              : new ProviderCallError(normalizeProviderError(providerFamily(model.provider), error))
          if (attempt >= PROVIDER_MAX_ATTEMPTS || !isRetryableProviderError(lastError)) {
            throw lastError
          }
          await new Promise((resolve) => setTimeout(resolve, providerRetryBackoffMs(attempt)))
        }
      }
      throw (
        lastError ??
        new ProviderCallError(
          normalizeProviderError(providerFamily(model.provider), new Error('provider request failed')),
        )
      )
    },
  }
}
