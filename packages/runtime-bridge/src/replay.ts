import { readFileSync } from 'node:fs'
import { RuntimeBridgeOutputMessageSchema, type RuntimeBridgeRunMessage } from '@ama/runtime-contracts/bridge-protocol'
import { AmaEventSchema, SessionEventSchema } from '@ama/runtime-contracts/session-events'
import { runtimeEvent, turnEnd } from './events/ama'
import type { AmaRuntimeEvent } from './protocol'
import { claudeCodeEventsFromJsonl } from './providers/claude-code'
import { codexEventsFromJsonl } from './providers/codex'
import { copilotEventsFromJsonl } from './providers/copilot'

export type RuntimeReplaySourceFormat = 'auto' | 'ama-events' | 'bridge-ndjson' | 'provider-jsonl'

export type RuntimeReplayInput = {
  runtime?: RuntimeBridgeRunMessage['runtime']
  sourcePath: string
  sourceFormat?: RuntimeReplaySourceFormat
  home?: string
}

type JsonlRecord = {
  line: number
  value: unknown
}

type JsonObject = Record<string, unknown>

export function runtimeEventsFromSource(input: RuntimeReplayInput): AmaRuntimeEvent[] {
  const records = readJsonl(input.sourcePath)
  const format = resolveSourceFormat(records, input.sourceFormat ?? 'auto', input.runtime)
  assertSingleTargetRuntimeSession(records, format, input.runtime, input.sourcePath)
  switch (format) {
    case 'ama-events':
      return eventsFromAmaJsonl(records, input.sourcePath)
    case 'bridge-ndjson':
      return eventsFromBridgeNdjson(records, input.sourcePath)
    case 'provider-jsonl':
      return withRuntimeLifecycle(eventsFromProviderJsonl(input))
    default:
      throw new Error(`Unsupported replay source format: ${format}`)
  }
}

function assertSingleTargetRuntimeSession(
  records: JsonlRecord[],
  format: Exclude<RuntimeReplaySourceFormat, 'auto'>,
  runtime: RuntimeReplayInput['runtime'],
  sourcePath: string,
) {
  const ids =
    format === 'bridge-ndjson'
      ? bridgeRuntimeSessionIds(records)
      : format === 'provider-jsonl' && runtime
        ? providerRuntimeSessionIds(records, runtime)
        : []
  const unique = [...new Set(ids)]
  if (unique.length <= 1) {
    return
  }
  throw new Error(
    `Replay source ${sourcePath} contains multiple target runtime session ids (${unique.join(', ')}); one AMA session can be rebuilt from exactly one target runtime session`,
  )
}

export function withRuntimeLifecycle(events: AmaRuntimeEvent[]): AmaRuntimeEvent[] {
  const prefix: AmaRuntimeEvent[] = []
  if (!events.some((event) => event.type === 'runtime.started')) prefix.push(runtimeEvent('runtime.started'))
  if (!events.some((event) => event.type === 'turn.started'))
    prefix.push(runtimeEvent('turn.started', { status: 'running' }))
  const suffix = events.some((event) => event.type === 'turn.completed') ? [] : [turnEnd()]
  return [...prefix, ...events, ...suffix]
}

function bridgeRuntimeSessionIds(records: JsonlRecord[]): string[] {
  const ids: string[] = []
  for (const record of records) {
    const parsed = RuntimeBridgeOutputMessageSchema.safeParse(record.value)
    if (!parsed.success) continue
    if (parsed.data.type === 'resumeToken') {
      ids.push(parsed.data.resumeToken)
      continue
    }
    if (parsed.data.type === 'result') {
      const resumeToken = stringValue(parsed.data.result.resumeToken)
      if (resumeToken) ids.push(resumeToken)
    }
  }
  return ids
}

function providerRuntimeSessionIds(records: JsonlRecord[], runtime: RuntimeBridgeRunMessage['runtime']): string[] {
  switch (runtime) {
    case 'codex':
      return codexTopLevelSessionIds(records)
    case 'claude-code':
      return records.map((record) => stringValue(objectValue(record.value).session_id)).filter(isString)
    case 'copilot':
      return copilotSessionIds(records)
    default:
      return []
  }
}

function codexTopLevelSessionIds(records: JsonlRecord[]): string[] {
  const ids: string[] = []
  for (const record of records) {
    const raw = objectValue(record.value)
    if (raw.type !== 'session_meta') continue
    const payload = objectValue(raw.payload)
    if (isCodexSubagentSessionMeta(payload)) continue
    const id = stringValue(payload.session_id) ?? stringValue(payload.id) ?? stringValue(payload.thread_id)
    if (id) ids.push(id)
  }
  return ids
}

function isCodexSubagentSessionMeta(payload: JsonObject): boolean {
  if (stringValue(payload.thread_source) === 'subagent') return true
  if (stringValue(payload.parent_thread_id)) return true
  const source = objectValue(payload.source)
  const subagent = objectValue(source.subagent)
  const threadSpawn = objectValue(subagent.thread_spawn)
  return Boolean(stringValue(threadSpawn.parent_thread_id))
}

function copilotSessionIds(records: JsonlRecord[]): string[] {
  const ids: string[] = []
  for (const record of records) {
    const raw = objectValue(record.value)
    const data = objectValue(raw.data)
    const id =
      stringValue(raw.sessionId) ??
      stringValue(raw.session_id) ??
      stringValue(data.sessionId) ??
      stringValue(data.session_id) ??
      stringValue(data.conversationId)
    if (id) ids.push(id)
  }
  return ids
}

function eventsFromProviderJsonl(input: RuntimeReplayInput): AmaRuntimeEvent[] {
  if (!input.runtime) {
    throw new Error('--runtime is required when replaying provider JSONL')
  }
  switch (input.runtime) {
    case 'codex':
      return codexEventsFromJsonl(input.sourcePath, input.home ? { home: input.home } : {})
    case 'claude-code':
      return claudeCodeEventsFromJsonl(input.sourcePath)
    case 'copilot':
      return copilotEventsFromJsonl(input.sourcePath)
    default:
      throw new Error(`Unsupported runtime provider: ${input.runtime}`)
  }
}

function eventsFromAmaJsonl(records: JsonlRecord[], sourcePath: string): AmaRuntimeEvent[] {
  return records.map((record) => {
    const sessionEvent = SessionEventSchema.safeParse(record.value)
    if (sessionEvent.success) {
      return AmaEventSchema.parse({
        type: sessionEvent.data.type,
        payload: sessionEvent.data.payload,
      }) as AmaRuntimeEvent
    }
    const event = AmaEventSchema.safeParse(record.value)
    if (event.success) return event.data as AmaRuntimeEvent
    throw new Error(`read AMA events JSONL ${sourcePath} line ${record.line}: not an AMA event record`)
  })
}

function eventsFromBridgeNdjson(records: JsonlRecord[], sourcePath: string): AmaRuntimeEvent[] {
  const events: AmaRuntimeEvent[] = []
  for (const record of records) {
    const parsed = RuntimeBridgeOutputMessageSchema.safeParse(record.value)
    if (!parsed.success) {
      throw new Error(`read runtime bridge NDJSON ${sourcePath} line ${record.line}: invalid bridge output message`)
    }
    if (parsed.data.type !== 'runtime.event') continue
    const event = AmaEventSchema.safeParse(parsed.data.event)
    if (!event.success) {
      throw new Error(`read runtime bridge NDJSON ${sourcePath} line ${record.line}: invalid AMA runtime event`)
    }
    events.push(event.data as AmaRuntimeEvent)
  }
  return events
}

function resolveSourceFormat(
  records: JsonlRecord[],
  requested: RuntimeReplaySourceFormat,
  runtime: RuntimeReplayInput['runtime'],
): Exclude<RuntimeReplaySourceFormat, 'auto'> {
  if (requested !== 'auto') return requested
  const first = records[0]?.value
  if (SessionEventSchema.safeParse(first).success || AmaEventSchema.safeParse(first).success) return 'ama-events'
  if (records.some((record) => RuntimeBridgeOutputMessageSchema.safeParse(record.value).success)) return 'bridge-ndjson'
  if (runtime) return 'provider-jsonl'
  throw new Error('Unable to infer source format; pass --source-format or --runtime')
}

function objectValue(value: unknown): JsonObject {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as JsonObject) : {}
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value ? value : null
}

function isString(value: string | null): value is string {
  return Boolean(value)
}

function readJsonl(filePath: string): JsonlRecord[] {
  const records: JsonlRecord[] = []
  let lineNumber = 0
  for (const line of readFileSync(filePath, 'utf8').split('\n')) {
    lineNumber += 1
    if (!line.trim()) continue
    try {
      records.push({ line: lineNumber, value: JSON.parse(line) })
    } catch (err) {
      throw new Error(`read JSONL ${filePath} line ${lineNumber}: ${err instanceof Error ? err.message : err}`)
    }
  }
  if (records.length === 0) throw new Error(`JSONL source is empty: ${filePath}`)
  return records
}
