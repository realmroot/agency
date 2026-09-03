import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import type { MessageContentBlock, ToolResult } from '@enbor/runtime-contracts/session-events'
import '@github/copilot/sdk'
import { approveAll, CopilotClient } from '@github/copilot-sdk'
import {
  messageEvent,
  messageStarted,
  messageUpdated,
  randomId,
  reasoningBlock,
  runtimeError,
  runtimeEvent,
  textBlock,
  toolCallBlock,
  toolResultMessage,
  turnEnd,
  usageEvent,
} from '../events/enbor'
import { resolveCliPath } from '../host/cli'
import {
  agentSystemPrompt,
  type EnborRuntimeEvent,
  type RuntimeProvider,
  type RuntimeProviderHandle,
  type RuntimeProviderRequest,
  type RuntimeUsageWindow,
} from '../protocol'
import { hostHome, objectValue, sdkEnv } from './cli-host'

const COPILOT_USER_API = 'https://api.github.com/copilot_internal/user'

function readGhToken(home: string | undefined): string | null {
  try {
    return (
      execSync('gh auth token', {
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'ignore'],
        env: home ? { ...process.env, HOME: home } : process.env,
      }).trim() || null
    )
  } catch {
    return null
  }
}

type CopilotEvent = {
  type: string
  data: {
    content?: string
    deltaContent?: string
    messageId?: string
    message?: unknown
    toolRequests?: Array<{ name: string; arguments: unknown; toolCallId: string }>
    toolCallId?: string
    result?: { content?: unknown } | unknown
    success?: boolean
    [key: string]: unknown
  }
}

function numberValue(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function normalizeTool(name: string, args: Record<string, unknown>) {
  switch (name) {
    case 'bash':
    case 'shell':
      return { toolName: 'bash', args: { command: args.command ?? args.cmd } }
    case 'read':
    case 'view':
      return { toolName: 'read', args: { path: args.path ?? args.file_path } }
    case 'write':
    case 'create':
      return {
        toolName: 'write',
        args: { path: args.path ?? args.file_path, content: args.file_text ?? args.content },
      }
    case 'edit':
      return {
        toolName: 'edit',
        args: {
          path: args.path ?? args.file_path,
          edits: Array.isArray(args.edits) ? args.edits : [{ oldText: args.old_text, newText: args.new_text }],
        },
      }
    case 'fetch':
    case 'url':
      return { toolName: 'fetch', args: { url: args.url } }
    case 'web_search':
      return { toolName: 'web_search', args: { query: args.query } }
    default:
      return { toolName: name, args }
  }
}

export class CopilotEventMapper {
  private activeMessageId: string | null = null
  private text = ''
  private reasoning = ''

  map(event: CopilotEvent): EnborRuntimeEvent[] {
    switch (event.type) {
      case 'assistant.turn.started':
        return [runtimeEvent('turn.started')]
      case 'assistant.message_delta':
        return this.messageDelta(event, 'text')
      case 'assistant.reasoning_delta':
        return this.messageDelta(event, 'reasoning')
      case 'assistant.reasoning':
        if (event.data.content) {
          const id = this.activeMessageId ?? event.data.messageId ?? randomId('msg')
          const mapped = messageEvent({ id, role: 'assistant', content: [reasoningBlock(event.data.content)] })
          this.clearActiveMessage(id)
          return [mapped]
        }
        return []
      case 'assistant.message': {
        const id = this.activeMessageId ?? event.data.messageId ?? randomId('msg')
        const content: MessageContentBlock[] = event.data.content ? [textBlock(event.data.content)] : []
        for (const request of event.data.toolRequests ?? []) {
          const normalized = normalizeTool(request.name, objectValue(request.arguments))
          content.push(toolCallBlock({ id: request.toolCallId, name: normalized.toolName, input: normalized.args }))
        }
        const mapped = content.length > 0 ? [messageEvent({ id, role: 'assistant', content })] : []
        this.clearActiveMessage(id)
        return mapped
      }
      case 'tool.execution_complete': {
        const toolCallId = typeof event.data.toolCallId === 'string' ? event.data.toolCallId : 'tool'
        return [messageEvent(toolResultMessage(toolCallId, copilotToolResult(event.data.result), !event.data.success))]
      }
      case 'assistant.usage': {
        const model = typeof event.data.model === 'string' && event.data.model ? event.data.model : null
        if (!model) return []
        const inputTokens = numberValue(event.data.inputTokens) ?? 0
        const outputTokens = numberValue(event.data.outputTokens) ?? 0
        const cachedInputTokens = numberValue(event.data.cacheReadTokens) ?? 0
        const cacheCreationInputTokens = numberValue(event.data.cacheWriteTokens) ?? 0
        const reasoningTokens = numberValue(event.data.reasoningTokens)
        return [
          usageEvent({
            model,
            inputTokens,
            outputTokens,
            cachedInputTokens,
            cacheCreationInputTokens,
            ...(reasoningTokens !== undefined ? { reasoningTokens } : {}),
            totalTokens:
              inputTokens + outputTokens + cachedInputTokens + cacheCreationInputTokens + (reasoningTokens ?? 0),
          }),
        ]
      }
      case 'session.idle':
        return [turnEnd()]
      case 'session.error':
        return [runtimeError(String(event.data.message ?? 'Copilot session error'), 'copilot_error', event.data)]
      default:
        return []
    }
  }

  private messageDelta(event: CopilotEvent, kind: 'text' | 'reasoning'): EnborRuntimeEvent[] {
    const delta = event.data.deltaContent
    if (!delta) return []
    const id = this.activeMessageId ?? event.data.messageId ?? randomId('msg')
    const events: EnborRuntimeEvent[] = []
    if (!this.activeMessageId) {
      this.activeMessageId = id
      events.push(messageStarted({ id, role: 'assistant', content: [] }))
    }
    if (kind === 'reasoning') this.reasoning += delta
    else this.text += delta
    const content: MessageContentBlock[] = []
    if (this.reasoning) content.push(reasoningBlock(this.reasoning))
    if (this.text) content.push(textBlock(this.text))
    events.push(messageUpdated({ id, role: 'assistant', content }))
    return events
  }

  private clearActiveMessage(id: string) {
    if (this.activeMessageId !== id) return
    this.activeMessageId = null
    this.text = ''
    this.reasoning = ''
  }
}

export function copilotEventsFromJsonl(filePath: string): EnborRuntimeEvent[] {
  const mapper = new CopilotEventMapper()
  const events: EnborRuntimeEvent[] = []
  let lineNumber = 0
  for (const line of readFileSync(filePath, 'utf8').split('\n')) {
    lineNumber += 1
    if (!line.trim()) continue
    let event: CopilotEvent
    try {
      event = JSON.parse(line) as CopilotEvent
    } catch (err) {
      throw new Error(`read Copilot JSONL ${filePath} line ${lineNumber}: ${err instanceof Error ? err.message : err}`)
    }
    events.push(...mapper.map(event))
  }
  return events
}

function copilotToolResult(result: unknown): ToolResult {
  const object = objectValue(result)
  const content = 'content' in object ? object.content : result
  if (typeof content === 'string') {
    return { content: content ? [{ type: 'text', text: content }] : [] }
  }
  if (Array.isArray(content)) {
    return {
      content: content.map((value) => {
        const block = objectValue(value)
        if (block.type === 'text' && typeof block.text === 'string') {
          return { type: 'text', text: block.text }
        }
        if (block.type === 'image' && typeof block.data === 'string') {
          return {
            type: 'image',
            data: block.data,
            ...(typeof block.mediaType === 'string' ? { mediaType: block.mediaType } : {}),
          }
        }
        return { type: 'json', value }
      }),
    }
  }
  return { content: [{ type: 'json', value: content }] }
}

export const copilotProvider: RuntimeProvider = {
  name: 'copilot',
  binary: 'copilot',
  fallbackModels: ['copilot-cli'],
  async execute(request: RuntimeProviderRequest): Promise<RuntimeProviderHandle> {
    const systemPrompt = agentSystemPrompt(request)
    // Without an explicit cliPath the SDK resolves @github/copilot via
    // import.meta.resolve, which throws when the bridge runs from the runner's
    // materialized temp dir (no node_modules). Point it at the host CLI instead.
    const copilotPath = resolveCliPath('copilot')
    const client = new CopilotClient({
      cwd: request.cwd,
      env: sdkEnv(request),
      useLoggedInUser: true,
      ...(copilotPath ? { cliPath: copilotPath } : {}),
    })
    await client.start()
    const sessionConfig = {
      ...(request.model ? { model: request.model } : {}),
      streaming: true,
      workingDirectory: request.cwd,
      onPermissionRequest: approveAll,
      ...(systemPrompt ? { systemMessage: { content: systemPrompt } } : {}),
    }
    const session =
      request.resume && request.resumeToken
        ? await client.resumeSession(request.resumeToken, sessionConfig)
        : await client.createSession({ sessionId: request.sessionId, ...sessionConfig })

    const queue: EnborRuntimeEvent[] = []
    const mapper = new CopilotEventMapper()
    let done = false
    let queueError: unknown
    let notify: (() => void) | null = null
    const finish = (err?: unknown) => {
      done = true
      queueError = err
      notify?.()
    }
    const unsubscribe = session.on((event) => {
      try {
        for (const mapped of mapper.map(event as CopilotEvent)) queue.push(mapped)
        if (event.type === 'session.idle') finish()
        if (event.type === 'session.error') finish()
        notify?.()
      } catch (err) {
        finish(err)
      }
    })
    await session.send({ prompt: request.prompt })
    const events = (async function* () {
      try {
        while (!done || queue.length > 0) {
          while (queue.length > 0) yield queue.shift()!
          if (done) break
          await new Promise<void>((resolve) => {
            notify = resolve
          })
          notify = null
        }
        if (queueError) throw queueError
      } finally {
        unsubscribe()
        await session.disconnect().catch(() => {})
        await client.stop().catch(() => {})
      }
    })()
    return {
      events,
      async abort() {
        await session.abort().catch(() => {})
        finish()
      },
      async send(message: string) {
        await session.send({ prompt: message })
      },
      getResumeToken() {
        return session.sessionId
      },
    }
  },

  // Enumerate the models the host Copilot login can serve via the SDK's
  // listModels() uses the same idle-query path as other clients.
  async listModels({ env }): Promise<string[] | null> {
    const home = hostHome(env)
    const clientEnv = { ...(process.env as Record<string, string>), ...(home ? { HOME: home } : {}) }
    const copilotPath = resolveCliPath('copilot')
    const client = new CopilotClient({
      env: clientEnv,
      useLoggedInUser: true,
      ...(copilotPath ? { cliPath: copilotPath } : {}),
    })
    await client.start()
    try {
      const models = await client.listModels()
      return models.length > 0 ? models.map((model) => model.id) : null
    } finally {
      await client.stop().catch(() => {})
    }
  },

  async fetchUsage({ env }): Promise<RuntimeUsageWindow[] | null> {
    const token = readGhToken(hostHome(env))
    if (!token) return null
    const res = await fetch(COPILOT_USER_API, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' },
      signal: AbortSignal.timeout(5000),
    })
    if (!res.ok) return null
    type QuotaSnapshot = { percent_remaining: number; unlimited: boolean }
    const data = (await res.json()) as {
      quota_reset_date_utc?: string
      quota_snapshots?: Record<string, QuotaSnapshot>
    }
    const resetsAt = data.quota_reset_date_utc ?? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
    const snapshots = data.quota_snapshots ?? {}
    const QUOTA_LABELS: Record<string, string> = {
      premium_interactions: 'Premium',
      chat: 'Chat',
      completions: 'Completions',
    }
    const windows: RuntimeUsageWindow[] = []
    for (const [key, label] of Object.entries(QUOTA_LABELS)) {
      const snapshot = snapshots[key]
      if (!snapshot || snapshot.unlimited) continue
      windows.push({ label, utilization: Number((100 - snapshot.percent_remaining).toFixed(2)), resetsAt })
    }
    return windows.length > 0 ? windows : null
  },
}
