import { z } from 'zod'
import { EXTERNAL_RUNTIME_NAMES } from './runtime-names'
import {
  ENBOR_SESSION_EVENT_TYPES,
  type EnborEvent,
  type EnborSessionEventType,
  JsonObjectSchema,
  JsonValueSchema,
} from './session-events'

const EnborSessionEventTypeValues = [...ENBOR_SESSION_EVENT_TYPES] as [
  EnborSessionEventType,
  ...EnborSessionEventType[],
]

export const StringMapSchema = z.record(z.string(), z.string())
export const ExternalRuntimeNameSchema = z.enum(EXTERNAL_RUNTIME_NAMES)
export const EnborSessionEventTypeSchema = z.enum(EnborSessionEventTypeValues)

export const RuntimeBridgeRunMessageSchema = z
  .object({
    type: z.literal('run'),
    requestId: z.string(),
    runtime: ExternalRuntimeNameSchema,
    sessionId: z.string(),
    cwd: z.string(),
    env: StringMapSchema,
    prompt: z.string(),
    provider: z.string().optional(),
    model: z.string().optional(),
    agentSnapshot: JsonObjectSchema.optional(),
    runtimeConfig: JsonObjectSchema.optional(),
    resumeToken: z.string().optional(),
    resume: z.boolean().optional(),
  })
  .strict()

export const RuntimeBridgeSendMessageSchema = z
  .object({
    type: z.literal('send'),
    requestId: z.string(),
    message: z.string(),
  })
  .strict()

export const RuntimeBridgeAbortMessageSchema = z
  .object({
    type: z.literal('abort'),
    requestId: z.string(),
    reason: z.string().optional(),
  })
  .strict()

export const RuntimeBridgePermissionDecisionMessageSchema = z
  .object({
    type: z.literal('permissionDecision'),
    requestId: z.string(),
    permissionId: z.string(),
    allowed: z.boolean(),
    reason: z.string().optional(),
  })
  .strict()

export const RuntimeBridgeControlMessageSchema = z.discriminatedUnion('type', [
  RuntimeBridgeSendMessageSchema,
  RuntimeBridgeAbortMessageSchema,
  RuntimeBridgePermissionDecisionMessageSchema,
])

export const RuntimeBridgeInventoryMessageSchema = z
  .object({
    type: z.literal('inventory'),
    requestId: z.string(),
    env: StringMapSchema,
    includeUsage: z.boolean().optional(),
  })
  .strict()

export const RuntimeBridgeInputMessageSchema = z.union([
  RuntimeBridgeRunMessageSchema,
  RuntimeBridgeControlMessageSchema,
  RuntimeBridgeInventoryMessageSchema,
])

export const RuntimeUsageWindowSchema = z
  .object({
    label: z.string(),
    utilization: z.number(),
    resetsAt: z.string(),
  })
  .strict()

export const RuntimeInventoryEntrySchema = z
  .object({
    runtime: ExternalRuntimeNameSchema,
    binary: z.string(),
    installed: z.boolean(),
    fallbackModels: z.array(z.string()),
    models: z.array(z.string()),
    status: z.string(),
    version: z.string().optional(),
    detail: z.string(),
    usageWindows: z.array(RuntimeUsageWindowSchema).optional(),
    limitedDetail: z.string().optional(),
  })
  .strict()

export const RuntimeBridgeInventoryResultSchema = z
  .object({
    runtimes: z.array(RuntimeInventoryEntrySchema),
  })
  .strict()

export const RuntimeBridgeEventBodySchema = JsonObjectSchema
export const EnborRuntimeEventSchema = RuntimeBridgeEventBodySchema

export const RuntimeBridgeErrorSchema = z
  .object({
    message: z.string(),
    code: z.string().optional(),
    details: JsonValueSchema.optional(),
  })
  .strict()

export const RuntimeBridgeReadyMessageSchema = z
  .object({ type: z.literal('ready'), requestId: z.string().optional() })
  .strict()
export const RuntimeBridgeEventMessageSchema = z
  .object({
    type: z.literal('runtime.event'),
    requestId: z.string(),
    event: RuntimeBridgeEventBodySchema,
  })
  .strict()
export const RuntimeBridgeProviderEventMessageSchema = z
  .object({
    type: z.literal('provider.event'),
    requestId: z.string(),
    runtime: ExternalRuntimeNameSchema,
    event: RuntimeBridgeEventBodySchema,
  })
  .strict()
export const RuntimeBridgeResumeTokenMessageSchema = z
  .object({
    type: z.literal('resumeToken'),
    requestId: z.string(),
    resumeToken: z.string(),
  })
  .strict()
export const RuntimeBridgeResultMessageSchema = z
  .object({
    type: z.literal('result'),
    requestId: z.string(),
    result: JsonObjectSchema,
  })
  .strict()
export const RuntimeBridgeErrorMessageSchema = z
  .object({
    type: z.literal('error'),
    requestId: z.string().optional(),
    error: RuntimeBridgeErrorSchema,
  })
  .strict()

export const RuntimeBridgeOutputMessageSchema = z.discriminatedUnion('type', [
  RuntimeBridgeReadyMessageSchema,
  RuntimeBridgeEventMessageSchema,
  RuntimeBridgeProviderEventMessageSchema,
  RuntimeBridgeResumeTokenMessageSchema,
  RuntimeBridgeResultMessageSchema,
  RuntimeBridgeErrorMessageSchema,
])

export type RuntimeBridgeRunMessage = z.infer<typeof RuntimeBridgeRunMessageSchema>
export type RuntimeBridgeControlMessage = z.infer<typeof RuntimeBridgeControlMessageSchema>
export type RuntimeBridgeInventoryMessage = z.infer<typeof RuntimeBridgeInventoryMessageSchema>
export type RuntimeBridgeInputMessage = z.infer<typeof RuntimeBridgeInputMessageSchema>
export type RuntimeUsageWindow = z.infer<typeof RuntimeUsageWindowSchema>
export type RuntimeInventoryEntry = z.infer<typeof RuntimeInventoryEntrySchema>
export type EnborRuntimeEvent = EnborEvent
export type RuntimeBridgeOutputMessage = z.infer<typeof RuntimeBridgeOutputMessageSchema>
