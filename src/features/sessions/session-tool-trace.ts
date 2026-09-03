import type { SessionEvent } from '@/lib/enborrpc'

export type SessionToolTraceStatus = 'running' | 'completed' | 'failed'
export type SessionToolTraceApproval = 'approved' | 'denied' | 'approval required'

export interface SessionToolTraceEntry {
  key: string
  toolCallId: string | null
  name: string
  status: SessionToolTraceStatus
  approval: SessionToolTraceApproval
  orphanedResult: boolean
  input: unknown
  output: unknown
  errorSummary: string | null
  durationMs: number | null
  startedAt: string | null
  completedAt: string | null
}

const ERROR_SUMMARY_LIMIT = 240
const VALUE_SUMMARY_LIMIT = 160

interface TraceAccumulator extends SessionToolTraceEntry {
  startSequence: number | null
  endSequence: number | null
}

// Builds one trace entry per tool execution from canonical Enbor message content
// blocks. Pairing uses toolCall.id and tool_result.toolCallId; results without
// a recorded call degrade into explicit orphaned entries instead of being
// dropped.
export function buildSessionToolTrace(events: SessionEvent[]): SessionToolTraceEntry[] {
  const ordered = [...events].sort((left, right) => left.sequence - right.sequence)
  const entries: TraceAccumulator[] = []
  for (const record of ordered) {
    for (const block of messageContent(record)) {
      if (block.type === 'tool_call') {
        entries.push(entryFromToolCall(record, block))
      }
      if (block.type === 'tool_result') {
        const open = findOpenEntry(entries, stringField(block, 'toolCallId') ?? record.id)
        if (open) {
          completeEntry(open, record, block)
        } else {
          entries.push(orphanedEntryFromToolResult(record, block))
        }
      }
    }
  }
  const permissionEvents = ordered.filter(
    (record) =>
      record.type === 'permission.requested' ||
      record.type === 'permission.resolved' ||
      record.type === 'permission.denied',
  )
  return entries.map((entry) => ({ ...entry, approval: approvalState(entry, permissionEvents) }))
}

export function summarizeToolValue(value: unknown): string {
  const text = toolValueText(value)
  if (!text) {
    return 'None'
  }
  return truncate(text.replace(/\s+/g, ' ').trim(), VALUE_SUMMARY_LIMIT)
}

function entryFromToolCall(record: SessionEvent, block: Record<string, unknown>): TraceAccumulator {
  const toolCall = objectValue(block.toolCall)
  return {
    key: record.id,
    toolCallId: stringField(toolCall, 'id'),
    name: stringField(toolCall, 'name') ?? 'tool',
    status: 'running',
    approval: 'approved',
    orphanedResult: false,
    input: toolCall.input,
    output: undefined,
    errorSummary: null,
    durationMs: null,
    startedAt: record.createdAt,
    completedAt: null,
    startSequence: record.sequence,
    endSequence: null,
  }
}

function completeEntry(entry: TraceAccumulator, record: SessionEvent, block: Record<string, unknown>) {
  const failed = Boolean(block.error)
  entry.status = failed ? 'failed' : 'completed'
  entry.output = block.result
  entry.errorSummary = failed
    ? truncate(toolValueText(block.error ?? block.result) || 'Tool execution failed', ERROR_SUMMARY_LIMIT)
    : null
  entry.durationMs = elapsedMs(entry.startedAt, record.createdAt)
  entry.completedAt = record.createdAt
  entry.endSequence = record.sequence
}

function orphanedEntryFromToolResult(record: SessionEvent, block: Record<string, unknown>): TraceAccumulator {
  const failed = Boolean(block.error)
  return {
    key: record.id,
    toolCallId: stringField(block, 'toolCallId'),
    name: 'tool',
    status: failed ? 'failed' : 'completed',
    approval: 'approved',
    orphanedResult: true,
    input: undefined,
    output: block.result,
    errorSummary: failed
      ? truncate(toolValueText(block.error ?? block.result) || 'Tool execution failed', ERROR_SUMMARY_LIMIT)
      : null,
    durationMs: null,
    startedAt: null,
    completedAt: record.createdAt,
    startSequence: null,
    endSequence: record.sequence,
  }
}

function findOpenEntry(entries: TraceAccumulator[], key: string) {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index]
    if (entry && entry.status === 'running' && (entry.toolCallId ?? entry.key) === key) {
      return entry
    }
  }
  return null
}

// Permission events recorded inside the same turn while the tool call was in
// flight are the canonical approval outcome for that call.
function approvalState(entry: TraceAccumulator, permissionEvents: SessionEvent[]): SessionToolTraceApproval {
  const command = stringField(objectValue(entry.input), 'command')
  const relatedEvents = permissionEvents.filter((record) => {
    if (entry.startSequence === null) {
      return false
    }
    if (record.sequence < entry.startSequence || (entry.endSequence !== null && record.sequence > entry.endSequence)) {
      return false
    }
    const payload = objectValue(record.payload)
    const toolCall = objectValue(payload.toolCall)
    const permissionCommand = stringField(payload, 'command') ?? stringField(objectValue(toolCall.input), 'command')
    return !command || !permissionCommand || permissionCommand === command
  })
  const resolved = [...relatedEvents].reverse().find((record) => record.type === 'permission.resolved')
  if (resolved) {
    return objectValue(resolved.payload).allowed === false ? 'denied' : 'approved'
  }
  if (relatedEvents.some((record) => record.type === 'permission.denied')) {
    return 'denied'
  }
  if (relatedEvents.some((record) => record.type === 'permission.requested')) {
    return 'approval required'
  }
  if (relatedEvents.length === 0) {
    return 'approved'
  }
  return 'approved'
}

function toolValueText(value: unknown): string {
  if (value === undefined || value === null || value === '') {
    return ''
  }
  if (typeof value === 'string') {
    return value
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value)
  }
  const record = objectValue(value)
  if (Array.isArray(record.content)) {
    const text = record.content
      .map((item) => {
        const contentItem = objectValue(item)
        return contentItem.type === 'text' && typeof contentItem.text === 'string' ? contentItem.text : ''
      })
      .join('')
    if (text) {
      return text
    }
  }
  if (typeof record.message === 'string') {
    return record.message
  }
  return JSON.stringify(value) ?? ''
}

function messageContent(record: SessionEvent): Record<string, unknown>[] {
  if (record.type !== 'message.started' && record.type !== 'message.updated' && record.type !== 'message.completed') {
    return []
  }
  const message = objectValue(objectValue(record.payload).message)
  return Array.isArray(message.content) ? message.content.map(objectValue) : []
}

function elapsedMs(start: string | null, end: string) {
  if (!start) {
    return null
  }
  const elapsed = Date.parse(end) - Date.parse(start)
  return Number.isFinite(elapsed) ? Math.max(0, elapsed) : null
}

function truncate(value: string, limit: number) {
  return value.length > limit ? `${value.slice(0, limit)}…` : value
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

function stringField(record: Record<string, unknown>, field: string) {
  return typeof record[field] === 'string' ? (record[field] as string) : null
}
