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

export function runtimeEventsFromSource(input: RuntimeReplayInput): AmaRuntimeEvent[] {
  const records = readJsonl(input.sourcePath)
  const format = resolveSourceFormat(records, input.sourceFormat ?? 'auto', input.runtime)
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

export function withRuntimeLifecycle(events: AmaRuntimeEvent[]): AmaRuntimeEvent[] {
  const prefix: AmaRuntimeEvent[] = []
  if (!events.some((event) => event.type === 'runtime.started')) prefix.push(runtimeEvent('runtime.started'))
  if (!events.some((event) => event.type === 'turn.started'))
    prefix.push(runtimeEvent('turn.started', { status: 'running' }))
  const suffix = events.some((event) => event.type === 'turn.completed') ? [] : [turnEnd()]
  return [...prefix, ...events, ...suffix]
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
