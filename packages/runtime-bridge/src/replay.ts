import { readFileSync } from 'node:fs'
import { RuntimeBridgeOutputMessageSchema, type RuntimeBridgeRunMessage } from '@ama/runtime-contracts/bridge-protocol'
import { runtimeEvent, turnEnd } from './events/ama'
import type { AmaRuntimeEvent } from './protocol'
import { codexEventsFromProviderEvents } from './providers/codex'

export type RuntimeReplaySourceFormat = 'auto' | 'provider-events' | 'bridge-ndjson'

export type RuntimeReplayInput = {
  runtime?: RuntimeBridgeRunMessage['runtime']
  sourcePath: string
  sourceFormat?: RuntimeReplaySourceFormat
}

type JsonlRecord = {
  line: number
  value: unknown
}

type JsonObject = Record<string, unknown>

export function runtimeEventsFromSource(input: RuntimeReplayInput): AmaRuntimeEvent[] {
  const records = readJsonl(input.sourcePath)
  const format = resolveSourceFormat(records, input.sourceFormat ?? 'auto')
  switch (format) {
    case 'provider-events':
      return eventsFromProviderEventRecords(records, input.sourcePath, input.runtime)
    case 'bridge-ndjson':
      return eventsFromBridgeNdjson(records, input.sourcePath, input.runtime)
    default:
      throw new Error(`Unsupported replay source format: ${format}`)
  }
}

export function withRuntimeLifecycle(events: AmaRuntimeEvent[]): AmaRuntimeEvent[] {
  const output = [...events]
  if (!output.some((event) => event.type === 'runtime.started')) output.unshift(runtimeEvent('runtime.started'))
  if (!output.some((event) => event.type === 'turn.started')) {
    const runtimeIndex = output.findIndex((event) => event.type === 'runtime.started')
    output.splice(runtimeIndex >= 0 ? runtimeIndex + 1 : 0, 0, runtimeEvent('turn.started', { status: 'running' }))
  }
  if (!output.some((event) => event.type === 'turn.completed')) output.push(turnEnd())
  return output
}

function eventsFromProviderEventRecords(
  records: JsonlRecord[],
  sourcePath: string,
  runtimeOverride: RuntimeReplayInput['runtime'],
): AmaRuntimeEvent[] {
  const runtime = inferProviderEventsRuntime(records, runtimeOverride, sourcePath)
  const providerEvents = records.map((record) => providerEventFromRecord(record, sourcePath))
  return eventsFromCapturedProviderEvents(runtime, providerEvents)
}

function eventsFromBridgeNdjson(
  records: JsonlRecord[],
  sourcePath: string,
  runtimeOverride: RuntimeReplayInput['runtime'],
): AmaRuntimeEvent[] {
  const providerRecords: JsonlRecord[] = []
  for (const record of records) {
    const parsed = RuntimeBridgeOutputMessageSchema.safeParse(record.value)
    if (!parsed.success) {
      throw new Error(`read runtime bridge NDJSON ${sourcePath} line ${record.line}: invalid bridge output message`)
    }
    if (parsed.data.type === 'provider.event') providerRecords.push({ line: record.line, value: parsed.data })
  }
  if (providerRecords.length === 0) {
    throw new Error(`runtime bridge NDJSON ${sourcePath} contains no provider.event frames`)
  }
  const requestIds = [
    ...new Set(
      providerRecords
        .map((record) => stringValue(objectValue(record.value).requestId))
        .filter((requestId): requestId is string => Boolean(requestId)),
    ),
  ]
  if (requestIds.length > 1) {
    throw new Error(
      `runtime bridge NDJSON ${sourcePath} contains multiple provider request ids: ${requestIds.join(', ')}`,
    )
  }
  return eventsFromProviderEventRecords(providerRecords, sourcePath, runtimeOverride)
}

function eventsFromCapturedProviderEvents(
  runtime: RuntimeBridgeRunMessage['runtime'],
  providerEvents: unknown[],
): AmaRuntimeEvent[] {
  switch (runtime) {
    case 'codex':
      return withRuntimeLifecycle(codexEventsFromProviderEvents(providerEvents))
    default:
      throw new Error(`Rebuild from captured provider events is not implemented for runtime: ${runtime}`)
  }
}

function inferProviderEventsRuntime(
  records: JsonlRecord[],
  runtimeOverride: RuntimeReplayInput['runtime'],
  sourcePath: string,
): RuntimeBridgeRunMessage['runtime'] {
  const runtimes = [
    ...new Set(
      records
        .map((record) => stringValue(objectValue(record.value).runtime))
        .filter((runtime): runtime is RuntimeBridgeRunMessage['runtime'] => isRuntime(runtime)),
    ),
  ]
  if (runtimeOverride && runtimes.some((runtime) => runtime !== runtimeOverride)) {
    throw new Error(
      `provider events ${sourcePath} contain runtime ${runtimes.join(', ')} but --runtime is ${runtimeOverride}`,
    )
  }
  if (runtimeOverride) return runtimeOverride
  const onlyRuntime = runtimes[0]
  if (runtimes.length === 1 && onlyRuntime) return onlyRuntime
  if (runtimes.length > 1) {
    throw new Error(`provider events ${sourcePath} contain multiple runtimes: ${runtimes.join(', ')}`)
  }
  throw new Error(`provider events ${sourcePath} do not declare a runtime; pass --runtime`)
}

function providerEventFromRecord(record: JsonlRecord, sourcePath: string): JsonObject {
  const event = objectValue(objectValue(record.value).event)
  if (!event.type || typeof event.type !== 'string') {
    throw new Error(`read provider events ${sourcePath} line ${record.line}: provider event is missing type`)
  }
  return event
}

function resolveSourceFormat(
  records: JsonlRecord[],
  requested: RuntimeReplaySourceFormat,
): Exclude<RuntimeReplaySourceFormat, 'auto'> {
  if (requested !== 'auto') return requested
  if (records.some((record) => RuntimeBridgeOutputMessageSchema.safeParse(record.value).success)) return 'bridge-ndjson'
  if (records.some((record) => objectValue(record.value).event !== undefined)) return 'provider-events'
  throw new Error('Unable to infer source format; pass --source-format')
}

function objectValue(value: unknown): JsonObject {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as JsonObject) : {}
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value ? value : null
}

function isRuntime(value: string | null): value is RuntimeBridgeRunMessage['runtime'] {
  return value === 'codex' || value === 'claude-code' || value === 'copilot'
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
