import { z } from 'zod'
import { ENBOR_RUNTIME_TOOL_NAMES } from './agent-tools'
import {
  type EnborOrchestrationToolCall,
  EnborOrchestrationToolCallSchema,
  type EnborSandboxToolCall,
  EnborSandboxToolCallSchema,
} from './tool-contracts'

// The session metadata stamp that routes a session's canonical event firehose to
// the per-session Session DO (SQLite hot + R2 cold). Written by the cloud-loop
// (ama) start path; read by the event-store router. Absent means events live on
// D1 for self-hosted runner sessions.
export const SESSION_DO_EVENT_STORE = 'session-do'

export const ENBOR_SESSION_EVENT_TYPES = [
  'runtime.started',
  'runtime.completed',
  'turn.started',
  'turn.completed',
  'message.started',
  'message.updated',
  'message.completed',
  'usage.recorded',
  'permission.requested',
  'permission.resolved',
  'permission.denied',
  'runtime.error',
] as const

export type EnborSessionEventType = (typeof ENBOR_SESSION_EVENT_TYPES)[number]

const ENBOR_SESSION_EVENT_TYPE_SET = new Set<string>(ENBOR_SESSION_EVENT_TYPES)

export type TextContentBlock = { type: 'text'; text: string }
export type ReasoningContentBlock = { type: 'reasoning'; text: string }
export type ToolCallContentBlock = { type: 'tool_call'; toolCall: ToolCall }
export type ToolResultContentBlock = {
  type: 'tool_result'
  toolCallId: string
  result: ToolResult
  error?: EventError
}
export type ImageContentBlock = {
  type: 'image'
  url?: string
  mediaType?: string
  data?: string
}
export type FileContentBlock = {
  type: 'file'
  path?: string
  name?: string
  mediaType?: string
  data?: string
}

export type MessageContentBlock =
  | TextContentBlock
  | ReasoningContentBlock
  | ToolCallContentBlock
  | ToolResultContentBlock
  | ImageContentBlock
  | FileContentBlock

export type ToolResultValueContentBlock = TextContentBlock | ImageContentBlock | FileContentBlock | JsonContentBlock

export type JsonContentBlock = { type: 'json'; value: unknown }

export type MessageRole = 'user' | 'assistant' | 'system' | 'tool'

export type Message = {
  id: string
  role: MessageRole
  content: MessageContentBlock[]
  providerMessageId?: string
  parentMessageId?: string
  parentToolCallId?: string
  stopReason?: string
}

export type ExternalToolCall = {
  id: string
  name: string
  input: Record<string, unknown>
}

export type ToolCall = EnborSandboxToolCall | EnborOrchestrationToolCall | ExternalToolCall

export type ToolResult = {
  content: ToolResultValueContentBlock[]
  structuredContent?: Record<string, unknown>
  exitCode?: number
}

export type EventError = {
  message: string
  code?: string
  category?: string
  retryable?: boolean
  retryAfterSeconds?: number
  details?: unknown
}

export type RuntimeLifecyclePayload = { reason?: string }
export type MessageEventPayload = { message: Message }
export type TurnPayload = {
  status?: string
  reason?: string
  message?: Message
}
export type UsageRecordedPayload = {
  model: string
  promptTokens?: number
  completionTokens?: number
  totalTokens?: number
  inputTokens?: number
  outputTokens?: number
  cachedInputTokens?: number
  cacheCreationInputTokens?: number
  reasoningTokens?: number
  toolTokens?: number
  costMicros?: number
  details?: Record<string, unknown>
}
export type PermissionDeniedPayload = {
  reason?: string
  resourceType?: string
  resourceId?: string
  operation?: string
  command?: string | null
  host?: string | null
  connectorId?: string
  toolName?: string
  details?: Record<string, unknown>
}
export type PermissionRequestPayload = {
  permissionId?: string
  command?: string
  toolCall?: ToolCall
  details?: Record<string, unknown>
}
export type PermissionResolvedPayload = {
  permissionId?: string
  allowed: boolean
  reason?: string
  toolCall?: ToolCall
  details?: Record<string, unknown>
}
export type RuntimeErrorPayload = EventError

export type EnborEventPayloadByType = {
  'runtime.started': RuntimeLifecyclePayload
  'runtime.completed': RuntimeLifecyclePayload
  'turn.started': TurnPayload
  'turn.completed': TurnPayload
  'message.started': MessageEventPayload
  'message.updated': MessageEventPayload
  'message.completed': MessageEventPayload
  'usage.recorded': UsageRecordedPayload
  'permission.requested': PermissionRequestPayload
  'permission.resolved': PermissionResolvedPayload
  'permission.denied': PermissionDeniedPayload
  'runtime.error': RuntimeErrorPayload
}

export type EnborEvent<TType extends EnborSessionEventType = EnborSessionEventType> = {
  [K in TType]: {
    type: K
    payload: EnborEventPayloadByType[K]
  }
}[TType]

export type SessionEvent = EnborEvent & {
  id: string
  sessionId: string
  sequence: number
  createdAt: string
}

export const JsonValueSchema: z.ZodType<unknown> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(JsonValueSchema),
    z.record(z.string(), JsonValueSchema),
  ]),
)
export const JsonObjectSchema = z.record(z.string(), JsonValueSchema)

export const EventErrorSchema = z
  .object({
    message: z.string(),
    code: z.string().optional(),
    category: z.string().optional(),
    retryable: z.boolean().optional(),
    retryAfterSeconds: z.number().optional(),
    details: JsonValueSchema.optional(),
  })
  .strict()

const ENBOR_RUNTIME_TOOL_NAME_SET = new Set<string>(ENBOR_RUNTIME_TOOL_NAMES)

export const ExternalToolCallSchema = z
  .object({
    id: z.string(),
    name: z.string().refine((value) => !ENBOR_RUNTIME_TOOL_NAME_SET.has(value), {
      message: 'known Enbor runtime tools must use their canonical input schema',
    }),
    input: JsonObjectSchema,
  })
  .strict()

export const ToolCallSchema = z.union([
  EnborSandboxToolCallSchema,
  EnborOrchestrationToolCallSchema,
  ExternalToolCallSchema,
])

export const ToolResultSchema: z.ZodTypeAny = z.lazy(() =>
  z
    .object({
      content: z.array(ToolResultValueContentBlockSchema),
      structuredContent: JsonObjectSchema.optional(),
      exitCode: z.number().optional(),
    })
    .strict(),
)

export const TextContentBlockSchema = z.object({ type: z.literal('text'), text: z.string() }).strict()
export const ReasoningContentBlockSchema = z.object({ type: z.literal('reasoning'), text: z.string() }).strict()
export const ToolCallContentBlockSchema = z.object({ type: z.literal('tool_call'), toolCall: ToolCallSchema }).strict()
export const ToolResultContentBlockSchema = z
  .object({
    type: z.literal('tool_result'),
    toolCallId: z.string(),
    result: ToolResultSchema,
    error: EventErrorSchema.optional(),
  })
  .strict()
export const ImageContentBlockSchema = z
  .object({
    type: z.literal('image'),
    url: z.string().optional(),
    mediaType: z.string().optional(),
    data: z.string().optional(),
  })
  .strict()
export const FileContentBlockSchema = z
  .object({
    type: z.literal('file'),
    path: z.string().optional(),
    name: z.string().optional(),
    mediaType: z.string().optional(),
    data: z.string().optional(),
  })
  .strict()
export const JsonContentBlockSchema = z.object({ type: z.literal('json'), value: JsonValueSchema }).strict()

export const ToolResultValueContentBlockSchema: z.ZodTypeAny = z.discriminatedUnion('type', [
  TextContentBlockSchema,
  ImageContentBlockSchema,
  FileContentBlockSchema,
  JsonContentBlockSchema,
])

export const MessageContentBlockSchema: z.ZodTypeAny = z.discriminatedUnion('type', [
  TextContentBlockSchema,
  ReasoningContentBlockSchema,
  ToolCallContentBlockSchema,
  ToolResultContentBlockSchema,
  ImageContentBlockSchema,
  FileContentBlockSchema,
])

export const MessageSchema = z
  .object({
    id: z.string(),
    role: z.enum(['user', 'assistant', 'system', 'tool']),
    content: z.array(MessageContentBlockSchema),
    providerMessageId: z.string().optional(),
    parentMessageId: z.string().optional(),
    parentToolCallId: z.string().optional(),
    stopReason: z.string().optional(),
  })
  .strict()

const RuntimeLifecyclePayloadSchema = z.object({ reason: z.string().optional() }).strict()
const TurnPayloadSchema = z
  .object({
    status: z.string().optional(),
    reason: z.string().optional(),
    message: MessageSchema.optional(),
  })
  .strict()
const MessageEventPayloadSchema = z.object({ message: MessageSchema }).strict()
const UsageRecordedPayloadSchema = z
  .object({
    model: z.string(),
    promptTokens: z.number().optional(),
    completionTokens: z.number().optional(),
    totalTokens: z.number().optional(),
    inputTokens: z.number().optional(),
    outputTokens: z.number().optional(),
    cachedInputTokens: z.number().optional(),
    cacheCreationInputTokens: z.number().optional(),
    reasoningTokens: z.number().optional(),
    toolTokens: z.number().optional(),
    costMicros: z.number().optional(),
    details: JsonObjectSchema.optional(),
  })
  .strict()
const PermissionDeniedPayloadSchema = z
  .object({
    reason: z.string().optional(),
    resourceType: z.string().optional(),
    resourceId: z.string().optional(),
    operation: z.string().optional(),
    command: z.string().nullable().optional(),
    host: z.string().nullable().optional(),
    connectorId: z.string().optional(),
    toolName: z.string().optional(),
    details: JsonObjectSchema.optional(),
  })
  .strict()
const PermissionRequestPayloadSchema = z
  .object({
    permissionId: z.string().optional(),
    command: z.string().optional(),
    toolCall: ToolCallSchema.optional(),
    details: JsonObjectSchema.optional(),
  })
  .strict()
const PermissionResolvedPayloadSchema = z
  .object({
    permissionId: z.string().optional(),
    allowed: z.boolean(),
    reason: z.string().optional(),
    toolCall: ToolCallSchema.optional(),
    details: JsonObjectSchema.optional(),
  })
  .strict()
export const EnborEventSchema = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('runtime.started'),
      payload: RuntimeLifecyclePayloadSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal('runtime.completed'),
      payload: RuntimeLifecyclePayloadSchema,
    })
    .strict(),
  z.object({ type: z.literal('turn.started'), payload: TurnPayloadSchema }).strict(),
  z.object({ type: z.literal('turn.completed'), payload: TurnPayloadSchema }).strict(),
  z
    .object({
      type: z.literal('message.started'),
      payload: MessageEventPayloadSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal('message.updated'),
      payload: MessageEventPayloadSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal('message.completed'),
      payload: MessageEventPayloadSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal('usage.recorded'),
      payload: UsageRecordedPayloadSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal('permission.requested'),
      payload: PermissionRequestPayloadSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal('permission.resolved'),
      payload: PermissionResolvedPayloadSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal('permission.denied'),
      payload: PermissionDeniedPayloadSchema,
    })
    .strict(),
  z.object({ type: z.literal('runtime.error'), payload: EventErrorSchema }).strict(),
])

function sessionEventSchema<TType extends EnborSessionEventType>(type: TType, payload: z.ZodTypeAny) {
  return z
    .object({
      id: z.string(),
      sessionId: z.string(),
      sequence: z.number(),
      createdAt: z.string(),
      type: z.literal(type),
      payload,
    })
    .strict()
}

export const SessionEventSchema = z.discriminatedUnion('type', [
  sessionEventSchema('runtime.started', RuntimeLifecyclePayloadSchema),
  sessionEventSchema('runtime.completed', RuntimeLifecyclePayloadSchema),
  sessionEventSchema('turn.started', TurnPayloadSchema),
  sessionEventSchema('turn.completed', TurnPayloadSchema),
  sessionEventSchema('message.started', MessageEventPayloadSchema),
  sessionEventSchema('message.updated', MessageEventPayloadSchema),
  sessionEventSchema('message.completed', MessageEventPayloadSchema),
  sessionEventSchema('usage.recorded', UsageRecordedPayloadSchema),
  sessionEventSchema('permission.requested', PermissionRequestPayloadSchema),
  sessionEventSchema('permission.resolved', PermissionResolvedPayloadSchema),
  sessionEventSchema('permission.denied', PermissionDeniedPayloadSchema),
  sessionEventSchema('runtime.error', EventErrorSchema),
])

export function isEnborSessionEventType(value: string): value is EnborSessionEventType {
  return ENBOR_SESSION_EVENT_TYPE_SET.has(value)
}

export function enborSessionEventTypeFromPayload(event: Record<string, unknown>): string {
  return typeof event.type === 'string' && event.type ? event.type : 'unknown'
}

export function normalizeEnborEvent(event: EnborEvent): EnborEvent {
  return { type: event.type, payload: event.payload } as EnborEvent
}
