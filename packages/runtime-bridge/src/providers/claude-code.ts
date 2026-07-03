import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Message, MessageContentBlock, ToolResult } from '@ama/runtime-contracts/session-events'
import type { SDKMessage, SDKUserMessage } from '@anthropic-ai/claude-agent-sdk'
import { query } from '@anthropic-ai/claude-agent-sdk'
import {
  messageCompleted,
  messageEvent,
  messageStarted,
  messageUpdated,
  randomId,
  reasoningBlock,
  runtimeError,
  textBlock,
  toolCallBlock,
  toolResultBlock,
  turnEnd,
  usageEvent,
} from '../events/ama'
import {
  type AmaRuntimeEvent,
  agentSystemPrompt,
  createAsyncPushQueue,
  type RuntimeProvider,
  type RuntimeProviderHandle,
  type RuntimeProviderRequest,
  type RuntimeUsageWindow,
} from '../protocol'
import { hostHome, objectValue, resolveCliPath, sdkEnv } from './cli-host'

const CLAUDE_USAGE_API = 'https://api.anthropic.com/api/oauth/usage'
const CLAUDE_WINDOW_LABELS: Record<string, string> = {
  five_hour: '5-Hour',
  seven_day: '7-Day',
  seven_day_sonnet: '7-Day Sonnet',
  seven_day_opus: '7-Day Opus',
}

function normalizeUsagePercent(value: number): number {
  return value < 1 ? value * 100 : value
}

function normalizeToolInput(name: string, input: Record<string, unknown>): Record<string, unknown> {
  switch (name) {
    case 'Bash':
      return typeof input.command === 'string' ? { command: input.command } : input
    case 'Read':
      return { path: input.file_path ?? input.filePath }
    case 'Write':
      return { path: input.file_path ?? input.filePath, content: input.content }
    case 'Edit': {
      const oldText = input.old_string ?? input.oldString
      const newText = input.new_string ?? input.newString
      if (typeof oldText !== 'string' || typeof newText !== 'string') return input
      return {
        path: input.file_path ?? input.filePath,
        edits: [{ oldText, newText }],
      }
    }
    case 'Grep':
      return {
        pattern: input.pattern,
        ...(typeof input.path === 'string' ? { path: input.path } : {}),
        ...(typeof input.glob === 'string' ? { glob: input.glob } : {}),
        ...(typeof input['-i'] === 'boolean' ? { ignoreCase: input['-i'] } : {}),
      }
    case 'Glob':
      return {
        glob: input.pattern,
        ...(typeof input.path === 'string' ? { path: input.path } : {}),
      }
    case 'WebFetch':
      return { url: input.url }
    case 'WebSearch':
      return { query: input.query }
    case 'Agent':
    case 'Task':
      return normalizeAgentToolInput(input)
    default:
      return input
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

function normalizeToolName(name: string) {
  switch (name) {
    case 'Read':
      return 'read'
    case 'Bash':
      return 'bash'
    case 'Edit':
      return 'edit'
    case 'Write':
      return 'write'
    case 'Grep':
      return 'grep'
    case 'Glob':
      return 'find'
    case 'WebFetch':
      return 'fetch'
    case 'WebSearch':
      return 'web_search'
    case 'Agent':
    case 'Task':
      return 'agent'
    default:
      return name
  }
}

function numberValue(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function usageEventsFromResult(msg: Record<string, unknown>): AmaRuntimeEvent[] {
  const modelUsage = objectValue(msg.modelUsage)
  const events = Object.entries(modelUsage).flatMap(([model, value]) => {
    if (!model) return []
    const usage = objectValue(value)
    const inputTokens = numberValue(usage.inputTokens) ?? 0
    const outputTokens = numberValue(usage.outputTokens) ?? 0
    const cachedInputTokens = numberValue(usage.cacheReadInputTokens) ?? 0
    const cacheCreationInputTokens = numberValue(usage.cacheCreationInputTokens) ?? 0
    const costUSD = numberValue(usage.costUSD)
    return [
      usageEvent({
        model,
        inputTokens,
        outputTokens,
        cachedInputTokens,
        cacheCreationInputTokens,
        totalTokens: inputTokens + outputTokens + cachedInputTokens + cacheCreationInputTokens,
        ...(costUSD !== undefined ? { costMicros: Math.round(costUSD * 1_000_000) } : {}),
      }),
    ]
  })
  if (events.length > 0) return events
  return []
}

function claudeToolResult(content: unknown): ToolResult {
  if (typeof content === 'string') {
    return { content: content ? [{ type: 'text', text: content }] : [] }
  }
  if (Array.isArray(content)) {
    return {
      content: content.flatMap((value) => {
        const block = objectValue(value)
        return block.type === 'text' && typeof block.text === 'string'
          ? [{ type: 'text' as const, text: block.text }]
          : []
      }),
    }
  }
  return { content: [{ type: 'json', value: content }] }
}

function parseClaudeOAuthToken(raw: string): string | undefined {
  try {
    const creds = JSON.parse(raw) as { claudeAiOauth?: { accessToken?: string } }
    return creds.claudeAiOauth?.accessToken || undefined
  } catch {
    return undefined
  }
}

// Resolve the Claude Code OAuth token from the host login. macOS keeps it in the
// keychain, which the bundled SDK never reads; other platforms use the
// credentials file under the host home. Mirrors how the codex provider reads
// `~/.codex/auth.json`. The session runs with a sandboxed HOME, so the keychain
// lookup must point `security` at the host login keychain via HOME.
function readClaudeOAuthToken(home: string | undefined): string | undefined {
  if (process.platform === 'darwin') {
    try {
      const raw = execSync('security find-generic-password -s "Claude Code-credentials" -w', {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
        env: home ? { ...process.env, HOME: home } : process.env,
      }).trim()
      const token = parseClaudeOAuthToken(raw)
      if (token) return token
    } catch {
      // fall through to the credentials file
    }
  }
  if (!home) return undefined
  try {
    return parseClaudeOAuthToken(readFileSync(join(home, '.claude', '.credentials.json'), 'utf8'))
  } catch {
    return undefined
  }
}

function claudeSdkEnv(request: RuntimeProviderRequest) {
  const env = sdkEnv(request)
  if (!env.CLAUDE_CODE_OAUTH_TOKEN && !env.ANTHROPIC_API_KEY) {
    const token = readClaudeOAuthToken(hostHome(request.env))
    if (token) env.CLAUDE_CODE_OAUTH_TOKEN = token
  }
  return env
}

export class ClaudeEventMapper {
  private activeMessageId: string | null = null
  private text = ''
  private reasoning = ''

  map(msg: SDKMessage): AmaRuntimeEvent[] {
    switch (msg.type) {
      case 'stream_event':
        return this.mapStreamEvent(msg as unknown as Record<string, unknown>)
      case 'assistant': {
        const anyMsg = msg as unknown as Record<string, unknown>
        if (anyMsg.error) {
          return [runtimeError(String(anyMsg.error), 'claude_error', anyMsg)]
        }
        const content = claudeAssistantContent(msg.message.content)
        if (content.length > 0) {
          const message = claudeMessage('assistant', msg, content)
          const event = this.activeMessageId === message.id ? messageCompleted(message) : messageEvent(message)
          this.clearActiveMessage(message.id)
          return [event]
        }
        return []
      }
      case 'user': {
        const content = msg.message.content
        if (!Array.isArray(content)) return []
        const blocks = claudeUserContent(content)
        return blocks.length > 0 ? [messageEvent(claudeMessage('tool', msg, blocks))] : []
      }
      case 'result': {
        return [...usageEventsFromResult(msg as unknown as Record<string, unknown>), turnEnd()]
      }
      default:
        return []
    }
  }

  private mapStreamEvent(msg: Record<string, unknown>): AmaRuntimeEvent[] {
    const event = objectValue(msg.event)
    if (event.type === 'message_start') {
      const message = objectValue(event.message)
      const id = stringValue(msg.uuid) ?? stringValue(message.id) ?? randomId('msg')
      this.activeMessageId = id
      this.text = ''
      this.reasoning = ''
      return [messageStarted({ id, role: 'assistant', content: [] })]
    }
    if (event.type === 'content_block_delta') {
      const id = this.activeMessageId ?? stringValue(msg.uuid) ?? randomId('msg')
      this.activeMessageId = id
      const delta = objectValue(event.delta)
      if (delta.type === 'text_delta' && typeof delta.text === 'string') this.text += delta.text
      if (delta.type === 'thinking_delta' && typeof delta.thinking === 'string') this.reasoning += delta.thinking
      const content: MessageContentBlock[] = []
      if (this.reasoning) content.push(reasoningBlock(this.reasoning))
      if (this.text) content.push(textBlock(this.text))
      return [messageUpdated({ id, role: 'assistant', content })]
    }
    if (event.type === 'message_stop') return []
    return []
  }

  private clearActiveMessage(id: string) {
    if (this.activeMessageId !== id) return
    this.activeMessageId = null
    this.text = ''
    this.reasoning = ''
  }
}

export function claudeCodeEventsFromJsonl(filePath: string): AmaRuntimeEvent[] {
  const mapper = new ClaudeEventMapper()
  const events: AmaRuntimeEvent[] = []
  let lineNumber = 0
  for (const line of readFileSync(filePath, 'utf8').split('\n')) {
    lineNumber += 1
    if (!line.trim()) continue
    let message: SDKMessage
    try {
      message = JSON.parse(line) as SDKMessage
    } catch (err) {
      throw new Error(
        `read Claude Code JSONL ${filePath} line ${lineNumber}: ${err instanceof Error ? err.message : err}`,
      )
    }
    events.push(...mapper.map(message))
  }
  return events
}

function claudeMessage(role: Message['role'], msg: SDKMessage, content: MessageContentBlock[]): Message {
  const raw = msg as unknown as Record<string, unknown>
  const providerMessage = objectValue(raw.message)
  return {
    id: stringValue(raw.uuid) ?? randomId('msg'),
    role,
    content,
    ...(stringValue(providerMessage.id) ? { providerMessageId: stringValue(providerMessage.id)! } : {}),
    ...(stringValue(raw.parent_tool_use_id) ? { parentToolCallId: stringValue(raw.parent_tool_use_id)! } : {}),
  }
}

function claudeAssistantContent(content: unknown): MessageContentBlock[] {
  if (!Array.isArray(content)) return []
  return content.map((value): MessageContentBlock => {
    const block = objectValue(value)
    if (block.type === 'text' && typeof block.text === 'string') return textBlock(block.text)
    if (block.type === 'thinking' && typeof block.thinking === 'string') return reasoningBlock(block.thinking)
    if (block.type === 'tool_use') {
      const id = stringValue(block.id) ?? randomId('tool')
      const name = typeof block.name === 'string' ? block.name : 'tool'
      return toolCallBlock({
        id,
        name: normalizeToolName(name),
        input: normalizeToolInput(name, objectValue(block.input)),
      })
    }
    return { type: 'text', text: JSON.stringify(value) }
  })
}

function claudeUserContent(content: unknown[]): MessageContentBlock[] {
  return content
    .map((value): MessageContentBlock | null => {
      const block = objectValue(value)
      if (block.type !== 'tool_result') return null
      const toolCallId = stringValue(block.tool_use_id) ?? randomId('tool')
      return toolResultBlock(toolCallId, claudeToolResult(block.content), Boolean(block.is_error))
    })
    .filter((block): block is MessageContentBlock => Boolean(block))
}

function stringValue(value: unknown) {
  return typeof value === 'string' && value ? value : null
}

export const claudeCodeProvider: RuntimeProvider = {
  name: 'claude-code',
  binary: 'claude',
  fallbackModels: ['claude-sonnet-4-6'],
  usageUnavailableDetail: 'Claude Code quota usage unavailable; scheduling paused until the usage probe succeeds',
  execute(request: RuntimeProviderRequest): Promise<RuntimeProviderHandle> {
    const abortController = new AbortController()
    const claudePath = resolveCliPath('claude')
    const systemPrompt = agentSystemPrompt(request)
    // The AMA session id is a UUID, so it doubles as Claude Code's own session id
    // for both fresh runs and resumes — keeping the Claude session 1:1 with AMA.
    let resumeToken = request.resumeToken ?? request.sessionId
    const options = {
      ...(request.resume ? { resume: request.resumeToken ?? request.sessionId } : { sessionId: request.sessionId }),
      cwd: request.cwd,
      env: claudeSdkEnv(request),
      ...(systemPrompt ? { systemPrompt } : {}),
      ...(request.model ? { model: request.model } : {}),
      permissionMode: 'bypassPermissions' as const,
      allowDangerouslySkipPermissions: true,
      ...(claudePath ? { pathToClaudeCodeExecutable: claudePath } : {}),
      abortController,
      includePartialMessages: true,
    }
    const q = query({
      prompt: request.prompt,
      options,
    })
    // Each injected prompt produces one additional `result` message; track them
    // so a mid-run injection is processed instead of being cut off when the
    // original turn's result arrives. Every result is yielded before the break
    // check, so the final turn's output is never dropped. Known limit: a
    // prompt injected after the last expected result already ended the loop is
    // lost — the server-side queue fallback covers disconnected channels, not
    // this terminal race.
    let pendingInjectedPrompts = 0
    // Object wrapper: TS narrows captured let-bindings inside the IIFE
    // generator to their initial null, breaking optional chaining.
    const promptInput: { current: ReturnType<typeof createAsyncPushQueue<SDKUserMessage>> | null } = { current: null }
    const events = (async function* () {
      const mapper = new ClaudeEventMapper()
      for await (const msg of q) {
        const sessionId = (msg as unknown as { session_id?: unknown }).session_id
        if (typeof sessionId === 'string' && sessionId) resumeToken = sessionId
        yield* mapper.map(msg)
        if (msg.type === 'result') {
          if (pendingInjectedPrompts === 0) break
          pendingInjectedPrompts -= 1
        }
      }
      promptInput.current?.end()
      q.close()
    })()
    return Promise.resolve({
      events,
      async abort() {
        abortController.abort()
        promptInput.current?.end()
        q.close()
      },
      async send(message: string) {
        if (!promptInput.current) {
          promptInput.current = createAsyncPushQueue<SDKUserMessage>()
          void q.streamInput(promptInput.current.values)
        }
        pendingInjectedPrompts += 1
        promptInput.current.push({
          type: 'user' as const,
          message: { role: 'user' as const, content: message },
          parent_tool_use_id: null,
        })
      },
      getResumeToken() {
        return resumeToken
      },
    })
  },

  // Enumerate the models the host Claude Code login can serve via the SDK's
  // supportedModels() on an idle query (same path as the AK CLI reference).
  async listModels({ env }): Promise<string[] | null> {
    const home = hostHome(env)
    const queryEnv = { ...(process.env as Record<string, string>) }
    if (!queryEnv.CLAUDE_CODE_OAUTH_TOKEN && !queryEnv.ANTHROPIC_API_KEY) {
      const token = readClaudeOAuthToken(home ?? queryEnv.HOME)
      if (token) queryEnv.CLAUDE_CODE_OAUTH_TOKEN = token
    }
    const claudePath = resolveCliPath('claude')
    const q = query({
      prompt: '',
      options: {
        cwd: process.cwd(),
        env: queryEnv,
        permissionMode: 'bypassPermissions',
        allowDangerouslySkipPermissions: true,
        ...(claudePath ? { pathToClaudeCodeExecutable: claudePath } : {}),
      },
    })
    try {
      const models = await q.supportedModels()
      return models.length > 0 ? models.map((model) => model.value) : null
    } finally {
      q.close()
    }
  },

  async fetchUsage({ env }): Promise<RuntimeUsageWindow[] | null> {
    const token = readClaudeOAuthToken(hostHome(env))
    if (!token) return null
    const res = await fetch(CLAUDE_USAGE_API, {
      headers: { Authorization: `Bearer ${token}`, 'anthropic-beta': 'oauth-2025-04-20' },
      signal: AbortSignal.timeout(5000),
    })
    if (!res.ok) return null
    const data = (await res.json()) as Record<string, { utilization: number; resets_at: string }>
    const windows: RuntimeUsageWindow[] = []
    for (const [key, label] of Object.entries(CLAUDE_WINDOW_LABELS)) {
      const window = data[key]
      if (!window) continue
      windows.push({ label, utilization: normalizeUsagePercent(window.utilization), resetsAt: window.resets_at })
    }
    return windows
  },
}
