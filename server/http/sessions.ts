import { createRoute, type OpenAPIHono, z } from '@hono/zod-openapi'
import { ENBOR_SESSION_EVENT_TYPES, type EnborEvent } from '@shared/session-events'
import type { Context } from 'hono'
import { isRunnerOidcAuth, requireAuth, requireSessionEventsAuth } from '../auth/session'
import {
  EnvironmentHostingModeSchema,
  EnvironmentNetworkingSchema,
  EnvironmentPackagesSchema,
  EnvironmentScopeSchema,
  EnvironmentTypeSchema,
  RuntimeSchema,
} from '../contracts/environment-contracts'
import {
  ExecutionSpecInputSchema,
  ExecutionSpecSchema,
  type VolumeMountSchema,
  type VolumeSchema,
} from '../contracts/execution-spec'
import { IdentityRuntimeSchema } from '../contracts/identity-contracts'
import { ResourceMetadataSchema } from '../contracts/resource-contracts'
import { type PendingSessionApproval, sessionApprovalState } from '../domain/runtime/approval-state'
import type { Session, SessionApproval, SessionEvent, SessionMessage } from '../domain/session'
import type { Env } from '../env'
import { type ErrorType, errorResponse } from '../errors'
import {
  AuthenticatedOperation,
  csvResponse,
  type DepsEnv,
  ErrorResponseSchema,
  eventListQuerySchema,
  formatListCursor,
  listQuerySchema,
  listResponseSchema,
  negotiateMediaType,
  parseListCursor,
} from '../openapi'
import { wakeSerialHttpTriggerForSettledSession } from '../usecases/dispatch-triggers'
import { ResourceDeletedDuringMutationError, type SessionRuntimeError, SessionValidationError } from '../usecases/ports'
import {
  createSession as createRuntimeSession,
  decideApproval as decideRuntimeApproval,
  markExpiredPending as markRuntimeExpiredPending,
} from '../usecases/runtime/sessions'
import { deleteSessionResource, sendSessionMessage, type UpdateSessionPatch, updateSession } from '../usecases/sessions'
import { requestId } from './request-context'

type SessionRoutes = OpenAPIHono<DepsEnv>

const SESSION_STATES = ['pending', 'running', 'idle', 'closed', 'error'] as const
const MESSAGE_DELIVERIES = ['live', 'queued'] as const
const MESSAGE_STATES = ['accepted', 'delivered', 'failed'] as const
const APPROVAL_STATES = ['pending', 'approved', 'denied'] as const
const MAX_EVENT_BATCH = 100

const JsonObjectSchema = z.record(z.string(), z.unknown())
const SessionEnvironmentJsonObjectSchema = JsonObjectSchema.openapi('SessionEnvironmentJsonObject')
const SessionSubagentSchema = z
  .object({
    name: z.string(),
    description: z.string(),
    systemPrompt: z.string(),
    model: z.string().nullable(),
    allowedTools: z.array(z.string()),
    skills: z.array(z.string()),
    mcpConnectors: z.array(z.string()),
  })
  .strict()
  .openapi('SessionSubagent')

const SessionIdentityDescriptorSchema = z
  .object({
    identityId: z.string(),
    agentId: z.string().openapi({
      description:
        'Realmroot internal Identity resource id. It is not the stable OIDC subject and must not be used for Inbox addressing.',
    }),
    issuer: z.string().url(),
    subject: z.string().openapi({
      description:
        'Stable OIDC subject used for Inbox addressing. New Realmroot subjects are bare UUIDv7 values; legacy opaque snapshot values remain readable.',
    }),
    username: z.string(),
    runtime: IdentityRuntimeSchema,
  })
  .strict()
  .openapi('SessionIdentityDescriptor')

const AgentVersionSnapshotSchema = z
  .object({
    id: z.string(),
    agentId: z.string(),
    projectId: z.string(),
    version: z.number().int(),
    systemPrompt: z.string(),
    provider: z.string().nullable().openapi({ example: 'workers-ai' }),
    model: z.string().nullable(),
    skills: z.array(z.string()),
    subagents: z.array(SessionSubagentSchema),
    allowedTools: z.array(z.string()),
    mcpConnectors: z.array(z.string()),
    identity: SessionIdentityDescriptorSchema.nullable(),
    createdAt: z.string().datetime(),
  })
  .openapi('SessionAgentSnapshot')

const EnvironmentVersionSnapshotSchema = z
  .object({
    id: z.string(),
    environmentId: z.string(),
    projectId: z.string(),
    version: z.number().int(),
    scope: EnvironmentScopeSchema,
    type: EnvironmentTypeSchema,
    networking: EnvironmentNetworkingSchema,
    packages: EnvironmentPackagesSchema,
    variables: SessionEnvironmentJsonObjectSchema,
    createdAt: z.string().datetime(),
  })
  .openapi('SessionEnvironmentSnapshot')

const SessionPlacementSchema = z
  .object({
    hostingMode: EnvironmentHostingModeSchema,
    provider: z.string().nullable().openapi({ example: 'workers-ai' }),
    model: z.string().nullable().openapi({ example: '@cf/moonshotai/kimi-k2.6' }),
  })
  .openapi('SessionPlacement')

const SessionMetadataSchema = ResourceMetadataSchema.openapi('SessionMetadata')

const SessionCreateMetadataSchema = z
  .object({
    name: z.string().min(1).max(160).optional().openapi({ example: 'Implement billing export' }),
    labels: z
      .record(z.string(), z.string())
      .optional()
      .openapi({ example: { app: 'automation-service' } }),
    annotations: z
      .record(z.string(), z.string())
      .optional()
      .openapi({ example: { ticket: 'Enbor-123' } }),
  })
  .strict()
  .openapi('SessionCreateMetadata')

const SessionUpdateMetadataSchema = SessionCreateMetadataSchema.partial().strict().openapi('SessionUpdateMetadata')

const SessionSpecSchema = ExecutionSpecSchema.openapi('SessionSpec')

const SessionConditionSchema = z
  .object({
    type: z.enum(['Scheduled', 'RuntimeReady', 'Running', 'Completed']),
    status: z.enum(['True', 'False', 'Unknown']),
    reason: z.string().nullable(),
    message: z.string().nullable(),
    lastTransitionAt: z.string().datetime(),
  })
  .openapi('SessionCondition')

const SessionBindingsSchema = z
  .object({
    agent: z.object({
      versionId: z.string().openapi({ example: '0195f5d6-7c20-7000-8000-000000000003' }),
      snapshot: AgentVersionSnapshotSchema,
    }),
    environment: z.object({
      id: z.string().nullable().openapi({ example: '0195f5d6-7c20-7000-8000-000000000005' }),
      versionId: z.string().nullable().openapi({ example: '0195f5d6-7c20-7000-8000-000000000006' }),
      snapshot: EnvironmentVersionSnapshotSchema.nullable(),
    }),
    runtime: RuntimeSchema,
  })
  .openapi('SessionBindings')

const SessionStatusSchema = z
  .object({
    phase: z.enum(SESSION_STATES).openapi({ example: 'idle' }),
    reason: z.string().nullable(),
    conditions: z.array(SessionConditionSchema),
    bindings: SessionBindingsSchema,
    placement: SessionPlacementSchema.nullable(),
    startedAt: z.string().datetime().nullable(),
    closedAt: z.string().datetime().nullable(),
  })
  .openapi('SessionStatus')

const SessionSchema = z
  .object({
    metadata: SessionMetadataSchema,
    spec: SessionSpecSchema,
    status: SessionStatusSchema,
  })
  .openapi('Session')

const RuntimeLifecyclePayloadSchema = z
  .object({ reason: z.string().optional() })
  .strict()
  .openapi('RuntimeLifecyclePayload')
const TextContentBlockSchema = z.object({ type: z.literal('text'), text: z.string() }).openapi('TextContentBlock')
const ReasoningContentBlockSchema = z
  .object({ type: z.literal('reasoning'), text: z.string() })
  .openapi('ReasoningContentBlock')
const NonNegativeIntegerSchema = z.number().int().min(0)
const BashToolInputSchema = z
  .object({ command: z.string().min(1), timeout: z.number().positive().optional() })
  .strict()
  .openapi('BashToolInput')
const ReadToolInputSchema = z
  .object({
    path: z.string().min(1),
    offset: NonNegativeIntegerSchema.optional(),
    limit: NonNegativeIntegerSchema.optional(),
  })
  .strict()
  .openapi('ReadToolInput')
const WriteToolInputSchema = z
  .object({ path: z.string().min(1), content: z.string() })
  .strict()
  .openapi('WriteToolInput')
const EditToolInputSchema = z
  .object({
    path: z.string().min(1),
    edits: z.array(z.object({ oldText: z.string().min(1), newText: z.string() }).strict()).min(1),
  })
  .strict()
  .openapi('EditToolInput')
const GrepToolInputSchema = z
  .object({
    pattern: z.string().min(1),
    path: z.string().min(1).optional(),
    glob: z.string().min(1).optional(),
    ignoreCase: z.boolean().optional(),
    literal: z.boolean().optional(),
    context: NonNegativeIntegerSchema.optional(),
    limit: NonNegativeIntegerSchema.optional(),
  })
  .strict()
  .openapi('GrepToolInput')
const FindToolInputSchema = z
  .object({
    pattern: z.string().min(1).optional(),
    glob: z.string().min(1).optional(),
    path: z.string().min(1).optional(),
    limit: NonNegativeIntegerSchema.optional(),
  })
  .refine((input) => input.pattern !== undefined || input.glob !== undefined, {
    message: 'find requires pattern or glob',
  })
  .strict()
  .openapi('FindToolInput')
const LsToolInputSchema = z
  .object({ path: z.string().min(1).optional(), limit: NonNegativeIntegerSchema.optional() })
  .strict()
  .openapi('LsToolInput')
const FetchToolInputSchema = z.object({ url: z.string().url() }).strict().openapi('FetchToolInput')
const WebSearchToolInputSchema = z
  .object({ query: z.string().min(1), limit: NonNegativeIntegerSchema.optional() })
  .strict()
  .openapi('WebSearchToolInput')
const KnownToolCallSchema = z
  .discriminatedUnion('name', [
    z.object({ id: z.string(), name: z.literal('bash'), input: BashToolInputSchema }).strict(),
    z.object({ id: z.string(), name: z.literal('read'), input: ReadToolInputSchema }).strict(),
    z.object({ id: z.string(), name: z.literal('write'), input: WriteToolInputSchema }).strict(),
    z.object({ id: z.string(), name: z.literal('edit'), input: EditToolInputSchema }).strict(),
    z.object({ id: z.string(), name: z.literal('grep'), input: GrepToolInputSchema }).strict(),
    z.object({ id: z.string(), name: z.literal('find'), input: FindToolInputSchema }).strict(),
    z.object({ id: z.string(), name: z.literal('ls'), input: LsToolInputSchema }).strict(),
    z.object({ id: z.string(), name: z.literal('fetch'), input: FetchToolInputSchema }).strict(),
    z.object({ id: z.string(), name: z.literal('web_search'), input: WebSearchToolInputSchema }).strict(),
  ])
  .openapi('KnownToolCall')
const ExternalToolCallSchema = z
  .object({ id: z.string(), name: z.string(), input: JsonObjectSchema })
  .strict()
  .openapi('ExternalToolCall')
const ToolCallSchema = z.union([KnownToolCallSchema, ExternalToolCallSchema]).openapi('EventToolCall')
const ToolCallContentBlockSchema = z
  .object({ type: z.literal('tool_call'), toolCall: ToolCallSchema })
  .openapi('ToolCallContentBlock')
const ImageContentBlockSchema = z
  .object({
    type: z.literal('image'),
    url: z.string().optional(),
    mediaType: z.string().optional(),
    data: z.string().optional(),
  })
  .openapi('ImageContentBlock')
const FileContentBlockSchema = z
  .object({
    type: z.literal('file'),
    path: z.string().optional(),
    name: z.string().optional(),
    mediaType: z.string().optional(),
    data: z.string().optional(),
  })
  .openapi('FileContentBlock')
const JsonContentBlockSchema = z.object({ type: z.literal('json'), value: z.unknown() }).openapi('JsonContentBlock')
const ToolResultValueContentBlockSchema = z
  .discriminatedUnion('type', [
    TextContentBlockSchema,
    ImageContentBlockSchema,
    FileContentBlockSchema,
    JsonContentBlockSchema,
  ])
  .openapi('ToolResultValueContentBlock')
const ToolResultSchema = z
  .object({
    content: z.array(ToolResultValueContentBlockSchema),
    structuredContent: JsonObjectSchema.optional(),
    exitCode: z.number().int().optional(),
  })
  .strict()
  .openapi('ToolResult')
const ToolResultContentBlockSchema = z
  .object({
    type: z.literal('tool_result'),
    toolCallId: z.string(),
    result: ToolResultSchema,
    error: z.lazy(() => EventErrorSchema).optional(),
  })
  .openapi('ToolResultContentBlock')
const MessageContentBlockSchema = z
  .discriminatedUnion('type', [
    TextContentBlockSchema,
    ReasoningContentBlockSchema,
    ToolCallContentBlockSchema,
    ToolResultContentBlockSchema,
    ImageContentBlockSchema,
    FileContentBlockSchema,
  ])
  .openapi('MessageContentBlock')
const MessageSchema = z
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
  .openapi('EventMessage')
const EventErrorSchema = z
  .object({
    message: z.string(),
    code: z.string().optional(),
    category: z.string().optional(),
    retryable: z.boolean().optional(),
    retryAfterSeconds: z.number().optional(),
    details: z.unknown().optional(),
  })
  .strict()
  .openapi('EventError')
const MessageEventPayloadSchema = z.object({ message: MessageSchema }).strict().openapi('MessageEventPayload')
const TurnPayloadSchema = z
  .object({
    status: z.string().optional(),
    reason: z.string().optional(),
    message: MessageSchema.optional(),
  })
  .strict()
  .openapi('TurnPayload')
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
  .openapi('UsageRecordedPayload')
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
  .openapi('PermissionDeniedPayload')
const PermissionRequestPayloadSchema = z
  .object({
    permissionId: z.string().optional(),
    command: z.string().optional(),
    toolCall: ToolCallSchema.optional(),
    details: JsonObjectSchema.optional(),
  })
  .strict()
  .openapi('PermissionRequestPayload')
const PermissionResolvedPayloadSchema = z
  .object({
    permissionId: z.string().optional(),
    allowed: z.boolean(),
    reason: z.string().optional(),
    toolCall: ToolCallSchema.optional(),
    details: JsonObjectSchema.optional(),
  })
  .strict()
  .openapi('PermissionResolvedPayload')
function eventSchema<TType extends (typeof ENBOR_SESSION_EVENT_TYPES)[number]>(type: TType, payload: z.ZodTypeAny) {
  return z.object({ type: z.literal(type), payload }).strict()
}

function sessionEventSchema<TType extends (typeof ENBOR_SESSION_EVENT_TYPES)[number]>(
  type: TType,
  payload: z.ZodTypeAny,
) {
  return z
    .object({
      id: z.string(),
      sessionId: z.string(),
      sequence: z.number().int(),
      createdAt: z.string().datetime(),
      type: z.literal(type),
      payload,
    })
    .strict()
}

const EnborEventSchema = z
  .discriminatedUnion('type', [
    eventSchema('runtime.started', RuntimeLifecyclePayloadSchema),
    eventSchema('runtime.completed', RuntimeLifecyclePayloadSchema),
    eventSchema('turn.started', TurnPayloadSchema),
    eventSchema('turn.completed', TurnPayloadSchema),
    eventSchema('message.started', MessageEventPayloadSchema),
    eventSchema('message.updated', MessageEventPayloadSchema),
    eventSchema('message.completed', MessageEventPayloadSchema),
    eventSchema('usage.recorded', UsageRecordedPayloadSchema),
    eventSchema('permission.requested', PermissionRequestPayloadSchema),
    eventSchema('permission.resolved', PermissionResolvedPayloadSchema),
    eventSchema('permission.denied', PermissionDeniedPayloadSchema),
    eventSchema('runtime.error', EventErrorSchema),
  ])
  .openapi('EnborEvent')

const SessionEventSchema = z
  .discriminatedUnion('type', [
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
  .openapi('SessionEvent')

// ── browser session socket message schemas ───────────────────────────────────
// OpenAPI 3.x cannot describe a WebSocket message protocol, only the HTTP upgrade
// endpoint (connectSessionSocket). These component schemas type the frames the
// socket carries so the generated SDK types stay route/spec-derived (no drift);
// the transport itself is hand-wrapped in the SDK facade.

// server → client
const SessionSocketEventMessageSchema = z
  .object({ type: z.literal('event'), record: SessionEventSchema })
  .openapi('SessionSocketEventMessage')
const SessionSocketBackfillMessageSchema = z
  .object({
    type: z.literal('backfill'),
    requestId: z.string(),
    events: z.array(SessionEventSchema),
    nextCursor: z.number().int().nullable(),
    hasMore: z.boolean(),
  })
  .openapi('SessionSocketBackfillMessage')
const SessionSocketRunnerUnavailableMessageSchema = z
  .object({ type: z.literal('runner_unavailable'), message: z.string() })
  .openapi('SessionSocketRunnerUnavailableMessage')
const SessionSocketAckMessageSchema = z
  .object({ type: z.literal('ack'), requestId: z.string() })
  .openapi('SessionSocketAckMessage')
const SessionSocketErrorMessageSchema = z
  .object({ type: z.literal('error'), requestId: z.string().optional(), message: z.string() })
  .openapi('SessionSocketErrorMessage')
const SessionSocketServerMessageSchema = z
  .discriminatedUnion('type', [
    SessionSocketEventMessageSchema,
    SessionSocketBackfillMessageSchema,
    SessionSocketRunnerUnavailableMessageSchema,
    SessionSocketAckMessageSchema,
    SessionSocketErrorMessageSchema,
  ])
  .openapi('SessionSocketServerMessage')

// client → server
const SessionSocketPromptMessageSchema = z
  .object({ type: z.literal('prompt'), requestId: z.string().optional(), content: z.string() })
  .openapi('SessionSocketPromptMessage')
const SessionSocketAbortMessageSchema = z
  .object({ type: z.literal('abort'), requestId: z.string().optional() })
  .openapi('SessionSocketAbortMessage')
const SessionSocketSteerMessageSchema = z
  .object({ type: z.literal('steer'), requestId: z.string().optional(), content: z.string() })
  .openapi('SessionSocketSteerMessage')
const SessionSocketBackfillRequestMessageSchema = z
  .object({
    type: z.literal('backfill'),
    requestId: z.string().optional(),
    cursor: z.number().int().optional(),
    limit: z.number().int().optional(),
    eventType: z.string().optional(),
  })
  .openapi('SessionSocketBackfillRequestMessage')
const SessionSocketClientMessageSchema = z
  .discriminatedUnion('type', [
    SessionSocketPromptMessageSchema,
    SessionSocketAbortMessageSchema,
    SessionSocketSteerMessageSchema,
    SessionSocketBackfillRequestMessageSchema,
  ])
  .openapi('SessionSocketClientMessage')

// The component schemas above are emitted into the OpenAPI document (and so the
// generated SDK types) only when registered; connectSessionSocket is a bare
// upgrade with no body, so register them explicitly.
const SESSION_SOCKET_MESSAGE_SCHEMAS = {
  SessionSocketEventMessage: SessionSocketEventMessageSchema,
  SessionSocketBackfillMessage: SessionSocketBackfillMessageSchema,
  SessionSocketRunnerUnavailableMessage: SessionSocketRunnerUnavailableMessageSchema,
  SessionSocketAckMessage: SessionSocketAckMessageSchema,
  SessionSocketErrorMessage: SessionSocketErrorMessageSchema,
  SessionSocketServerMessage: SessionSocketServerMessageSchema,
  SessionSocketPromptMessage: SessionSocketPromptMessageSchema,
  SessionSocketAbortMessage: SessionSocketAbortMessageSchema,
  SessionSocketSteerMessage: SessionSocketSteerMessageSchema,
  SessionSocketBackfillRequestMessage: SessionSocketBackfillRequestMessageSchema,
  SessionSocketClientMessage: SessionSocketClientMessageSchema,
} as const

const CreateSessionSchema = z
  .object({
    metadata: SessionCreateMetadataSchema.optional(),
    spec: ExecutionSpecInputSchema,
    prompt: z
      .string()
      .trim()
      .min(1)
      .max(16000)
      .openapi({ example: 'Research Canadian banking bonus offers and summarize current opportunities.' }),
  })
  .strict()
  .openapi('CreateSessionRequest')

const UpdateSessionSchema = z
  .object({
    metadata: SessionUpdateMetadataSchema.optional(),
    state: z.enum(['closed', 'idle']).optional().openapi({ example: 'closed' }),
  })
  .strict()
  .refine((body) => body.metadata !== undefined || body.state !== undefined, {
    message: 'Provide metadata or state.',
  })
  .openapi('UpdateSessionRequest')

const SessionMessageSchema = z
  .object({
    id: z.string().openapi({ example: '0195f5d6-7c20-7000-8000-00000000000f' }),
    sessionId: z.string().openapi({ example: '0195f5d6-7c20-7000-8000-00000000000e' }),
    type: z.literal('prompt').openapi({ example: 'prompt' }),
    content: z.string().openapi({ example: 'Please continue the task and summarize the current blocker.' }),
    delivery: z.enum(MESSAGE_DELIVERIES).openapi({ example: 'queued' }),
    state: z.enum(MESSAGE_STATES).openapi({ example: 'accepted' }),
    error: z.string().nullable(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .openapi('SessionMessage')

const CreateSessionMessageSchema = z
  .object({
    type: z.literal('prompt').openapi({ example: 'prompt' }),
    requestId: z.string().trim().min(1).max(160).optional(),
    content: z
      .string()
      .trim()
      .min(1)
      .max(16000)
      .openapi({ example: 'Please continue the task and summarize the current blocker.' }),
  })
  .strict()
  .openapi('CreateSessionMessageRequest')

const CreateSessionEventsSchema = z
  .object({ events: z.array(EnborEventSchema).min(1).max(MAX_EVENT_BATCH) })
  .strict()
  .openapi('CreateSessionEventsRequest')

const SessionEventsAcceptedSchema = z
  .object({ accepted: z.number().int().openapi({ example: 3 }) })
  .openapi('SessionEventsAccepted')

const SessionApprovalSchema = z
  .object({
    id: z.string().openapi({ example: '0195f5d6-7c20-7000-8000-000000000010' }),
    sessionId: z.string().openapi({ example: '0195f5d6-7c20-7000-8000-00000000000e' }),
    toolCallId: z.string().openapi({ example: 'call_git_status' }),
    toolName: z.string().openapi({ example: 'bash' }),
    input: JsonObjectSchema,
    relatedEventIds: z.array(z.string()).openapi({ example: ['0195f5d6-7c20-7000-8000-000000000018'] }),
    state: z.enum(APPROVAL_STATES).openapi({ example: 'pending' }),
    reason: z.string().nullable().openapi({ example: 'Looks safe' }),
    result: JsonObjectSchema.nullable().openapi({
      description: 'Caller-provided custom tool result recorded instead of executing the tool.',
    }),
    requestedAt: z.string().datetime().openapi({ example: '2026-06-12T12:00:00.000Z' }),
    decidedAt: z.string().datetime().nullable(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .openapi('SessionApproval')

const SessionApprovalDecisionSchema = z
  .object({
    decision: z.enum(['approve', 'deny']).openapi({ example: 'approve' }),
    reason: z.string().max(500).optional().openapi({ example: 'Looks safe' }),
    result: JsonObjectSchema.optional().openapi({
      description: 'Caller-provided custom tool result recorded instead of executing the tool',
    }),
  })
  .strict()
  .openapi('SessionApprovalDecisionRequest')

const ParamsSchema = z.object({
  sessionId: z
    .string()
    .openapi({ param: { name: 'sessionId', in: 'path' }, example: '0195f5d6-7c20-7000-8000-00000000000e' }),
})
const MessageParamsSchema = ParamsSchema.extend({
  messageId: z
    .string()
    .openapi({ param: { name: 'messageId', in: 'path' }, example: '0195f5d6-7c20-7000-8000-00000000000f' }),
})
const ApprovalParamsSchema = ParamsSchema.extend({
  approvalId: z
    .string()
    .min(1)
    .openapi({ param: { name: 'approvalId', in: 'path' }, example: '0195f5d6-7c20-7000-8000-000000000010' }),
})

const ListQuerySchema = listQuerySchema().extend({
  state: z
    .enum(SESSION_STATES)
    .optional()
    .openapi({ param: { name: 'state', in: 'query' }, example: 'idle' }),
  labelSelector: z
    .string()
    .min(1)
    .max(500)
    .optional()
    .openapi({ param: { name: 'labelSelector', in: 'query' }, example: 'maintainerId=maint_abc123' }),
})
const MessageListQuerySchema = z.object({
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(100)
    .optional()
    .openapi({ param: { name: 'limit', in: 'query' }, example: 50 }),
  cursor: z
    .string()
    .min(1)
    .max(512)
    .optional()
    .openapi({ param: { name: 'cursor', in: 'query' } }),
})
const EventsQuerySchema = eventListQuerySchema().extend({
  type: z
    .enum(ENBOR_SESSION_EVENT_TYPES)
    .optional()
    .openapi({ param: { name: 'type', in: 'query' }, example: 'message.completed' }),
  createdFrom: z
    .string()
    .datetime()
    .optional()
    .openapi({ param: { name: 'createdFrom', in: 'query' }, example: '2026-05-01T00:00:00.000Z' }),
  createdTo: z
    .string()
    .datetime()
    .optional()
    .openapi({ param: { name: 'createdTo', in: 'query' }, example: '2026-05-31T23:59:59.999Z' }),
})
const SessionListResponseSchema = listResponseSchema('SessionListResponse', SessionSchema)
const SessionEventListResponseSchema = listResponseSchema('SessionEventListResponse', SessionEventSchema)
const SessionMessageListResponseSchema = listResponseSchema('SessionMessageListResponse', SessionMessageSchema)
const SessionApprovalListResponseSchema = listResponseSchema('SessionApprovalListResponse', SessionApprovalSchema)

// --- serialization (identity from records) ---
// The DTO records carry loosely-typed nested objects (Record<string, unknown>),
// while the OpenAPI response schemas describe the concrete shape. The records
// already match those shapes structurally (the repo builds them from the same
// snapshots), so serialization is identity with a cast to the schema-inferred
// type so the typed-response routes accept them.

function serializeSession(record: Session): z.infer<typeof SessionSchema> {
  return {
    metadata: serializeSessionMetadata(record.metadata),
    spec: {
      ...record.spec,
      volumes: record.spec.volumes as z.infer<typeof VolumeSchema>[],
      volumeMounts: record.spec.volumeMounts as z.infer<typeof VolumeMountSchema>[],
    },
    status: {
      ...record.status,
      bindings: {
        agent: {
          versionId: record.status.bindings.agent.versionId,
          snapshot: serializeAgentSnapshot(record.status.bindings.agent.snapshot),
        },
        environment: {
          id: record.status.bindings.environment.id,
          versionId: record.status.bindings.environment.versionId,
          snapshot: record.status.bindings.environment.snapshot as z.infer<
            typeof EnvironmentVersionSnapshotSchema
          > | null,
        },
        runtime: record.status.bindings.runtime,
      },
      placement: record.status.placement
        ? {
            hostingMode: record.status.placement.hostingMode,
            provider: record.status.placement.provider,
            model: record.status.placement.model,
          }
        : null,
    },
  }
}

function serializeSessionMetadata(metadata: Session['metadata']): z.infer<typeof SessionMetadataSchema> {
  return {
    uid: metadata.uid,
    projectId: metadata.pid,
    name: metadata.name,
    description: null,
    labels: metadata.labels,
    annotations: metadata.annotations,
    createdBy: metadata.createdBy,
    createdAt: metadata.createdAt,
    updatedAt: metadata.updatedAt,
  }
}

function serializeAgentSnapshot(
  snapshot: Session['status']['bindings']['agent']['snapshot'],
): z.infer<typeof AgentVersionSnapshotSchema> {
  if (!snapshot) throw new Error('Session Agent snapshot is unavailable')
  if (!snapshot.identity) return snapshot
  const { credentialRef: _credentialRef, ...identity } = snapshot.identity
  return { ...snapshot, identity }
}

// Forwards an authorised browser WebSocket upgrade to the Session DO, carrying the
// owning-user scope as query params (the DO trusts the upgrade since the route
// already verified ownership). The instance is `doName`: a CLI relay session's
// per-runner instance (shared across the runner's sessions, so a completed session
// still reads while the runner is online) or its own per-session instance for ama.
// The sessionId always rides in the scope so the DO multiplexes the browser to the
// right session. Mirrors the runner channel upgrade.
function upgradeSessionBrowserSocket(
  env: Env,
  request: Request,
  doName: string,
  scope: {
    sessionId: string
    organizationId: string
    projectId: string
    userId: string
    runnerEnvironmentId?: string
  },
) {
  const stub = env.SESSION.get(env.SESSION.idFromName(doName))
  const url = new URL('https://session-object/browser')
  url.searchParams.set('sessionId', scope.sessionId)
  url.searchParams.set('organizationId', scope.organizationId)
  url.searchParams.set('projectId', scope.projectId)
  url.searchParams.set('userId', scope.userId)
  if (scope.runnerEnvironmentId) {
    url.searchParams.set('runnerEnvironmentId', scope.runnerEnvironmentId)
  }
  return stub.fetch(new Request(url, request))
}

async function issueSessionBrowserSocketTicket(
  env: Env,
  doName: string,
  scope: {
    sessionId: string
    organizationId: string
    projectId: string
    userId: string
    runnerEnvironmentId?: string
  },
  origin: string,
) {
  const stub = env.SESSION.get(env.SESSION.idFromName(doName))
  const response = await stub.fetch('https://session-object/browser-tickets', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ scope, origin }),
  })
  if (!response.ok) throw new Error(`Session socket ticket issuance failed with HTTP ${response.status}`)
  return (await response.json()) as { ticket: string; expiresAt: string }
}

function upgradeSessionBrowserSocketTicket(env: Env, request: Request, doName: string) {
  const stub = env.SESSION.get(env.SESSION.idFromName(doName))
  const url = new URL('https://session-object/browser')
  url.searchParams.set('sessionId', doName)
  return stub.fetch(new Request(url, request))
}

function hasBrowserSocketTicket(request: Request) {
  return (request.headers.get('sec-websocket-protocol') ?? '')
    .split(',')
    .some((value) => value.trim().startsWith('ama-ticket.'))
}

function asSessionMessageResponse(record: SessionMessage): z.infer<typeof SessionMessageSchema> {
  return record as z.infer<typeof SessionMessageSchema>
}

function asSessionApprovalResponse(record: SessionApproval): z.infer<typeof SessionApprovalSchema> {
  return record as z.infer<typeof SessionApprovalSchema>
}

function asSessionEventResponse(record: SessionEvent): z.infer<typeof SessionEventSchema> {
  return record as z.infer<typeof SessionEventSchema>
}

function pendingApprovalResponse(
  sessionId: string,
  pending: PendingSessionApproval,
): z.infer<typeof SessionApprovalSchema> {
  return {
    id: pending.id,
    sessionId,
    toolCallId: pending.toolCallId,
    toolName: pending.toolName,
    input: pending.input,
    relatedEventIds: pending.relatedEventIds,
    state: 'pending',
    reason: null,
    result: null,
    requestedAt: pending.requestedAt,
    decidedAt: null,
    createdAt: pending.requestedAt,
    updatedAt: pending.requestedAt,
  }
}

// Maps a runtime-gateway error to an error response. The runtime status is
// dynamic, so callers cast the result to `never` (the established http escape):
// the route's OpenAPI response set stays exactly as before the migration and
// only the (un-consumed) error AppType is widened.
function runtimeErrorResponse(c: Context<DepsEnv>, error: SessionRuntimeError) {
  return errorResponse(c, error.status, error.code as ErrorType, error.message, {
    ...(error.fields ? { fields: error.fields } : {}),
    ...(error.detail ?? {}),
  })
}

// ── Events content representations ──────────────────────────────────────────

type EventsQuery = z.infer<typeof EventsQuerySchema>

function eventsQueryFor(query: EventsQuery, limit: number) {
  return {
    ...(query.type ? { type: query.type } : {}),
    ...(query.createdFrom ? { createdFrom: query.createdFrom } : {}),
    ...(query.createdTo ? { createdTo: query.createdTo } : {}),
    order: (query.order ?? 'asc') as 'asc' | 'desc',
    ...(query.cursor !== undefined ? { cursor: query.cursor } : {}),
    limit,
  }
}

async function eventsJsonResponse(c: Context<DepsEnv>, sessionId: string, query: EventsQuery) {
  const deps = c.get('deps')
  const limit = query.limit ?? 100
  const page = await deps.sessionEventStore.queryEvents(sessionId, eventsQueryFor(query, limit))
  const last = page.rows.at(-1)
  const nextCursor = page.hasMore && last ? String(last.sequence) : null
  return c.json(
    { data: page.rows.map(asSessionEventResponse), pagination: { limit, nextCursor, hasMore: page.hasMore } },
    200,
  )
}

async function eventsCsvResponse(c: Context<DepsEnv>, sessionId: string, query: EventsQuery) {
  const deps = c.get('deps')
  const limit = query.limit ?? 200
  const page = await deps.sessionEventStore.queryEvents(sessionId, eventsQueryFor(query, limit + 1))
  const rows = page.rows.slice(0, limit)
  const header = ['id', 'sessionId', 'sequence', 'type', 'createdAt', 'payload', 'metadata']
  const csvRows = rows.map((record) => [
    record.id,
    record.sessionId,
    String(record.sequence),
    record.type,
    record.createdAt,
    JSON.stringify(record.payload),
    '{}',
  ])
  return csvResponse(c, `session-${sessionId}-events.csv`, header, csvRows)
}

// SSE streams new events for ~1s of polling. The route owns the ReadableStream
// and the Response; the AbortController is fired from BOTH teardown paths (the
// request signal AND ReadableStream.cancel) so a body-consumer cancel stops the
// poll loop instead of leaking a polling cycle.
function eventsSseResponse(c: Context<DepsEnv>, sessionId: string, query: EventsQuery) {
  const limit = query.limit ?? 200
  const order = query.order ?? 'asc'
  if (order === 'desc') {
    return errorResponse(c, 400, 'validation_error', 'Descending order is not supported for live event streams', {
      fields: { order: 'Use order=asc for event streams or the JSON representation for finite historical pages.' },
    })
  }

  const deps = c.get('deps')
  const controller = new AbortController()
  const signal = controller.signal
  const onRequestAbort = () => controller.abort()
  c.req.raw.signal.addEventListener('abort', onRequestAbort)

  const encoder = new TextEncoder()
  let lastSequence = query.cursor ?? 0
  const stream = new ReadableStream({
    async start(streamController) {
      try {
        const deadline = Date.now() + 1000
        while (Date.now() <= deadline && !signal.aborted) {
          const page = await deps.sessionEventStore.queryEvents(sessionId, {
            ...(query.type ? { type: query.type } : {}),
            ...(query.createdFrom ? { createdFrom: query.createdFrom } : {}),
            ...(query.createdTo ? { createdTo: query.createdTo } : {}),
            order: 'asc',
            cursor: lastSequence,
            limit: limit + 1,
          })
          const rows = page.rows.slice(0, limit)
          for (const record of rows) {
            lastSequence = record.sequence
            streamController.enqueue(
              encoder.encode(`id: ${record.sequence}\nevent: ${record.type}\ndata: ${JSON.stringify(record)}\n\n`),
            )
          }
          if (rows.length >= limit) {
            break
          }
          await new Promise((resolve) => setTimeout(resolve, 100))
        }
      } finally {
        c.req.raw.signal.removeEventListener('abort', onRequestAbort)
        streamController.close()
      }
    },
    cancel() {
      controller.abort()
    },
  })
  return c.body(stream, 200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-store',
    connection: 'keep-alive',
  })
}

// requireAuth path-gates runner tokens away from non-runner resources, but the
// v1 design routes runner event upload through the sessions domain, so this
// endpoint resolves its own auth context and applies lease ownership as the
// runner gate.
// ── Routes ───────────────────────────────────────────────────────────────────

const createSessionRoute = createRoute({
  method: 'post',
  path: '/',
  operationId: 'createSession',
  tags: ['Sessions'],
  summary: 'Create a session',
  ...AuthenticatedOperation,
  request: { body: { required: true, content: { 'application/json': { schema: CreateSessionSchema } } } },
  responses: {
    201: { description: 'Created session', content: { 'application/json': { schema: SessionSchema } } },
    400: { description: 'Validation error', content: { 'application/json': { schema: ErrorResponseSchema } } },
    401: { description: 'Authentication required', content: { 'application/json': { schema: ErrorResponseSchema } } },
    403: { description: 'Policy denied', content: { 'application/json': { schema: ErrorResponseSchema } } },
    404: { description: 'Agent not found', content: { 'application/json': { schema: ErrorResponseSchema } } },
    409: { description: 'Conflict', content: { 'application/json': { schema: ErrorResponseSchema } } },
  },
})

const listSessionsRoute = createRoute({
  method: 'get',
  path: '/',
  operationId: 'listSessions',
  tags: ['Sessions'],
  summary: 'List sessions',
  ...AuthenticatedOperation,
  request: { query: ListQuerySchema },
  responses: {
    200: { description: 'Session list', content: { 'application/json': { schema: SessionListResponseSchema } } },
    400: { description: 'Validation error', content: { 'application/json': { schema: ErrorResponseSchema } } },
    401: { description: 'Authentication required', content: { 'application/json': { schema: ErrorResponseSchema } } },
  },
})

const readSessionRoute = createRoute({
  method: 'get',
  path: '/{sessionId}',
  operationId: 'readSession',
  tags: ['Sessions'],
  summary: 'Read a session',
  ...AuthenticatedOperation,
  request: { params: ParamsSchema },
  responses: {
    200: { description: 'Session', content: { 'application/json': { schema: SessionSchema } } },
    401: { description: 'Authentication required', content: { 'application/json': { schema: ErrorResponseSchema } } },
    404: { description: 'Session not found', content: { 'application/json': { schema: ErrorResponseSchema } } },
  },
})

const updateSessionRoute = createRoute({
  method: 'patch',
  path: '/{sessionId}',
  operationId: 'updateSession',
  tags: ['Sessions'],
  summary: 'Update a session',
  description: 'Partial update: name and metadata edits, plus close/reopen transitions (state: "closed"|"idle").',
  ...AuthenticatedOperation,
  request: {
    params: ParamsSchema,
    body: { required: true, content: { 'application/json': { schema: UpdateSessionSchema } } },
  },
  responses: {
    200: { description: 'Updated session', content: { 'application/json': { schema: SessionSchema } } },
    400: { description: 'Validation error', content: { 'application/json': { schema: ErrorResponseSchema } } },
    401: { description: 'Authentication required', content: { 'application/json': { schema: ErrorResponseSchema } } },
    404: { description: 'Session not found', content: { 'application/json': { schema: ErrorResponseSchema } } },
    409: { description: 'Conflict', content: { 'application/json': { schema: ErrorResponseSchema } } },
  },
})

const deleteSessionRoute = createRoute({
  method: 'delete',
  path: '/{sessionId}',
  operationId: 'deleteSession',
  tags: ['Sessions'],
  summary: 'Delete a session',
  description:
    'Stops any live runtime and soft-deletes the session while retaining its history. It cannot be restored.',
  ...AuthenticatedOperation,
  request: { params: ParamsSchema },
  responses: {
    204: { description: 'Session deleted' },
    401: { description: 'Authentication required', content: { 'application/json': { schema: ErrorResponseSchema } } },
    404: { description: 'Session not found', content: { 'application/json': { schema: ErrorResponseSchema } } },
    409: {
      description: 'Runtime could not be stopped',
      content: { 'application/json': { schema: ErrorResponseSchema } },
    },
  },
})

const connectSessionSocketRoute = createRoute({
  method: 'get',
  path: '/{sessionId}/socket',
  operationId: 'connectSessionSocket',
  'x-cli-ignore': true,
  tags: ['Sessions'],
  summary: 'Open the session browser WebSocket (live events + backfill + input)',
  security: [{ sessionSocketTicket: [] }, { oidcAccessToken: ['sessions:write'] }],
  request: { params: ParamsSchema },
  responses: {
    101: { description: 'Session browser socket accepted as a WebSocket upgrade' },
    401: { description: 'Authentication required', content: { 'application/json': { schema: ErrorResponseSchema } } },
    404: { description: 'Session not found', content: { 'application/json': { schema: ErrorResponseSchema } } },
    426: {
      description: 'WebSocket upgrade required',
      content: { 'application/json': { schema: ErrorResponseSchema } },
    },
  },
})

const listSessionMessagesRoute = createRoute({
  method: 'get',
  path: '/{sessionId}/messages',
  operationId: 'listSessionMessages',
  tags: ['Sessions'],
  summary: 'List session messages',
  ...AuthenticatedOperation,
  request: { params: ParamsSchema, query: MessageListQuerySchema },
  responses: {
    200: {
      description: 'Session messages',
      content: { 'application/json': { schema: SessionMessageListResponseSchema } },
    },
    400: { description: 'Validation error', content: { 'application/json': { schema: ErrorResponseSchema } } },
    401: { description: 'Authentication required', content: { 'application/json': { schema: ErrorResponseSchema } } },
    404: { description: 'Session not found', content: { 'application/json': { schema: ErrorResponseSchema } } },
  },
})

const createSessionMessageRoute = createRoute({
  method: 'post',
  path: '/{sessionId}/messages',
  operationId: 'createSessionMessage',
  tags: ['Sessions'],
  summary: 'Send a prompt message to a session',
  ...AuthenticatedOperation,
  request: {
    params: ParamsSchema,
    body: { required: true, content: { 'application/json': { schema: CreateSessionMessageSchema } } },
  },
  responses: {
    201: { description: 'Message accepted', content: { 'application/json': { schema: SessionMessageSchema } } },
    400: { description: 'Validation error', content: { 'application/json': { schema: ErrorResponseSchema } } },
    401: { description: 'Authentication required', content: { 'application/json': { schema: ErrorResponseSchema } } },
    404: { description: 'Session not found', content: { 'application/json': { schema: ErrorResponseSchema } } },
    409: { description: 'Conflict', content: { 'application/json': { schema: ErrorResponseSchema } } },
    500: { description: 'Runtime error', content: { 'application/json': { schema: ErrorResponseSchema } } },
  },
})

const readSessionMessageRoute = createRoute({
  method: 'get',
  path: '/{sessionId}/messages/{messageId}',
  operationId: 'readSessionMessage',
  tags: ['Sessions'],
  summary: 'Read a session message delivery state',
  ...AuthenticatedOperation,
  request: { params: MessageParamsSchema },
  responses: {
    200: { description: 'Session message', content: { 'application/json': { schema: SessionMessageSchema } } },
    401: { description: 'Authentication required', content: { 'application/json': { schema: ErrorResponseSchema } } },
    404: {
      description: 'Session or message not found',
      content: { 'application/json': { schema: ErrorResponseSchema } },
    },
  },
})

const listEventsRoute = createRoute({
  method: 'get',
  path: '/{sessionId}/events',
  operationId: 'listSessionEvents',
  tags: ['Sessions'],
  summary: 'List session events',
  description:
    'Content negotiation: application/json returns a paginated list, text/csv exports the filtered events, text/event-stream streams new events as SSE.',
  ...AuthenticatedOperation,
  request: { params: ParamsSchema, query: EventsQuerySchema },
  responses: {
    200: {
      description: 'Session events',
      content: {
        'application/json': { schema: SessionEventListResponseSchema },
        'text/csv': { schema: z.string() },
        'text/event-stream': { schema: z.string() },
      },
    },
    400: { description: 'Validation error', content: { 'application/json': { schema: ErrorResponseSchema } } },
    401: { description: 'Authentication required', content: { 'application/json': { schema: ErrorResponseSchema } } },
    404: { description: 'Session not found', content: { 'application/json': { schema: ErrorResponseSchema } } },
  },
})

const createSessionEventsRoute = createRoute({
  method: 'post',
  path: '/{sessionId}/events',
  operationId: 'createSessionEvents',
  tags: ['Sessions'],
  summary: 'Batch-create session events',
  description:
    'Event ingest for runners and clients. Runner OIDC tokens are accepted only while the runner holds an active lease attached to the session.',
  ...AuthenticatedOperation,
  request: {
    params: ParamsSchema,
    body: { required: true, content: { 'application/json': { schema: CreateSessionEventsSchema } } },
  },
  responses: {
    201: { description: 'Events accepted', content: { 'application/json': { schema: SessionEventsAcceptedSchema } } },
    400: { description: 'Validation error', content: { 'application/json': { schema: ErrorResponseSchema } } },
    401: { description: 'Authentication required', content: { 'application/json': { schema: ErrorResponseSchema } } },
    403: { description: 'Forbidden', content: { 'application/json': { schema: ErrorResponseSchema } } },
    404: { description: 'Session not found', content: { 'application/json': { schema: ErrorResponseSchema } } },
  },
})

const listSessionApprovalsRoute = createRoute({
  method: 'get',
  path: '/{sessionId}/approvals',
  operationId: 'listSessionApprovals',
  tags: ['Sessions'],
  summary: 'List tool approvals for a session',
  ...AuthenticatedOperation,
  request: { params: ParamsSchema },
  responses: {
    200: {
      description: 'Session approvals',
      content: { 'application/json': { schema: SessionApprovalListResponseSchema } },
    },
    401: { description: 'Authentication required', content: { 'application/json': { schema: ErrorResponseSchema } } },
    404: { description: 'Session not found', content: { 'application/json': { schema: ErrorResponseSchema } } },
  },
})

const readSessionApprovalRoute = createRoute({
  method: 'get',
  path: '/{sessionId}/approvals/{approvalId}',
  operationId: 'readSessionApproval',
  tags: ['Sessions'],
  summary: 'Read a tool approval',
  ...AuthenticatedOperation,
  request: { params: ApprovalParamsSchema },
  responses: {
    200: { description: 'Session approval', content: { 'application/json': { schema: SessionApprovalSchema } } },
    401: { description: 'Authentication required', content: { 'application/json': { schema: ErrorResponseSchema } } },
    404: {
      description: 'Session or approval not found',
      content: { 'application/json': { schema: ErrorResponseSchema } },
    },
  },
})

const decideSessionApprovalRoute = createRoute({
  method: 'patch',
  path: '/{sessionId}/approvals/{approvalId}',
  operationId: 'decideSessionApproval',
  tags: ['Sessions'],
  summary: 'Approve or deny a pending tool call',
  description:
    'Records the human decision for a paused tool call. Approval resumes the runtime and executes the tool (or records the provided custom result); denial resumes the runtime with the denial.',
  ...AuthenticatedOperation,
  request: {
    params: ApprovalParamsSchema,
    body: { required: true, content: { 'application/json': { schema: SessionApprovalDecisionSchema } } },
  },
  responses: {
    200: { description: 'Decision recorded', content: { 'application/json': { schema: SessionApprovalSchema } } },
    401: { description: 'Authentication required', content: { 'application/json': { schema: ErrorResponseSchema } } },
    404: {
      description: 'Session or pending approval not found',
      content: { 'application/json': { schema: ErrorResponseSchema } },
    },
    409: { description: 'Approval already decided', content: { 'application/json': { schema: ErrorResponseSchema } } },
  },
})

// Registration order is load-bearing: requireAuth is the per-route auth wall and
// static segments register before parameter segments. The assembler in app.ts
// calls this at the sessions resource's original mount position.
async function createSessionSocketTicket(c: Context<DepsEnv>) {
  const sessionId = c.req.param('sessionId')
  if (!sessionId) return errorResponse(c, 400, 'validation_error', 'Session id is required')
  const deps = c.get('deps')
  const auth = await requireAuth(c)
  if (auth instanceof Response) return auth
  if (auth.authenticationMethod !== 'cookie' || auth.oidc.clientId !== c.env.OIDC_CLIENT_ID) {
    return errorResponse(c, 403, 'forbidden', 'Only the Realmroot Console session may create browser socket tickets')
  }
  const requestOrigin = new URL(c.req.url).origin
  const browserOrigin = c.req.header('origin')
  if (browserOrigin !== requestOrigin) {
    return errorResponse(c, 403, 'forbidden', 'Browser socket tickets require the same-origin Realmroot Console')
  }
  const session = await deps.sessions.find(auth.project.id, sessionId)
  if (!session) return errorResponse(c, 404, 'not_found', 'Session not found')
  const ticket = await issueSessionBrowserSocketTicket(
    c.env,
    sessionId,
    {
      sessionId,
      organizationId: auth.organization.id,
      projectId: session.metadata.pid,
      userId: auth.user.id,
      ...(session.spec.runtime !== 'ama' &&
      session.status.placement?.hostingMode === 'self_hosted' &&
      session.spec.environmentId
        ? { runnerEnvironmentId: session.spec.environmentId }
        : {}),
    },
    browserOrigin,
  )
  return c.json(ticket, 201)
}

export function registerSessionRoutes(routes: SessionRoutes) {
  for (const [name, schema] of Object.entries(SESSION_SOCKET_MESSAGE_SCHEMAS)) {
    routes.openAPIRegistry.register(name, schema)
  }
  routes.post('/:sessionId/socket-tickets', createSessionSocketTicket)
  return routes
    .openapi(createSessionRoute, async (c) => {
      const body = c.req.valid('json')
      const deps = c.get('deps')
      const auth = await requireAuth(c)
      if (auth instanceof Response) {
        return auth
      }
      // Create is a single forward to the runtime boundary (snapshot,
      // provider/policy/runtime checks, session-row build, sandbox boot or
      // self-hosted work-item enqueue all live behind the runtime usecase), so
      // the route calls the runtime usecase with deps directly.
      const metadata = body.metadata ?? {}
      const spec = body.spec
      const outcome = await createRuntimeSession(deps, auth, {
        agentId: spec.agentId,
        ...(spec.environmentId !== undefined ? { environmentId: spec.environmentId } : {}),
        options: {
          ...(metadata.name !== undefined ? { name: metadata.name } : {}),
          metadata: { labels: metadata.labels ?? {}, annotations: metadata.annotations ?? {} },
          ...(spec.runtime !== undefined ? { runtime: spec.runtime } : {}),
          runtimeConfig: {},
          ...(spec.env !== undefined ? { env: spec.env } : {}),
          ...(spec.envFrom !== undefined ? { envFrom: spec.envFrom } : {}),
          ...(spec.volumes !== undefined ? { volumes: spec.volumes } : {}),
          ...(spec.volumeMounts !== undefined ? { volumeMounts: spec.volumeMounts } : {}),
          prompt: body.prompt,
        },
        requestId: requestId(c),
      })
      if (!outcome.ok) {
        return runtimeErrorResponse(c, outcome.error) as never
      }
      return c.json(serializeSession(outcome.value), 201)
    })
    .openapi(listSessionsRoute, async (c) => {
      const deps = c.get('deps')
      const auth = await requireAuth(c)
      if (auth instanceof Response) {
        return auth
      }
      const { state, search, labelSelector, createdFrom, createdTo, limit = 50, cursor } = c.req.valid('query')
      let parsedCursor: ReturnType<typeof parseListCursor> | null = null
      try {
        parsedCursor = cursor ? parseListCursor(cursor) : null
      } catch {
        return errorResponse(c, 400, 'validation_error', 'Invalid list cursor', {
          fields: { cursor: 'Cursor is invalid.' },
        })
      }
      await markRuntimeExpiredPending(deps, auth)
      const page = await deps.sessions.list({
        projectId: auth.project.id,
        ...(state ? { state } : {}),
        ...(search ? { search } : {}),
        ...(labelSelector ? { labelSelector } : {}),
        ...(createdFrom ? { createdFrom } : {}),
        ...(createdTo ? { createdTo } : {}),
        limit,
        cursor: parsedCursor,
      })
      const last = page.rows.at(-1)
      const nextCursor =
        page.hasMore && last ? formatListCursor({ createdAt: last.metadata.createdAt, id: last.metadata.uid }) : null
      return c.json(
        { data: page.rows.map(serializeSession), pagination: { limit, nextCursor, hasMore: page.hasMore } },
        200,
      )
    })
    .openapi(readSessionRoute, async (c) => {
      const { sessionId } = c.req.valid('param')
      const deps = c.get('deps')
      const auth = await requireAuth(c)
      if (auth instanceof Response) {
        return auth
      }
      await markRuntimeExpiredPending(deps, auth)
      const session = await deps.sessions.find(auth.project.id, sessionId)
      if (!session) {
        return errorResponse(c, 404, 'not_found', 'Session not found')
      }
      return c.json(serializeSession(session), 200)
    })
    .openapi(updateSessionRoute, async (c) => {
      const { sessionId } = c.req.valid('param')
      const body = c.req.valid('json')
      const deps = c.get('deps')
      const auth = await requireAuth(c)
      if (auth instanceof Response) {
        return auth
      }
      const session = await deps.sessions.findRuntimeRow(auth.project.id, sessionId)
      if (!session) {
        return errorResponse(c, 404, 'not_found', 'Session not found')
      }
      const metadataPatch = body.metadata
      const patch: UpdateSessionPatch = {
        ...(metadataPatch?.name !== undefined ? { name: metadataPatch.name } : {}),
        ...(metadataPatch !== undefined
          ? {
              metadata: {
                ...(metadataPatch.labels !== undefined ? { labels: metadataPatch.labels } : {}),
                ...(metadataPatch.annotations !== undefined ? { annotations: metadataPatch.annotations } : {}),
              },
            }
          : {}),
        ...(body.state !== undefined ? { state: body.state } : {}),
      }
      try {
        const outcome = await updateSession(deps, auth as never, session, patch, requestId(c))
        if (!outcome.ok) {
          return runtimeErrorResponse(c, outcome.error) as never
        }
        if (body.state !== undefined) {
          await wakeSerialHttpTriggerForSettledSession(deps, auth.project.id, sessionId)
        }
        return c.json(serializeSession(outcome.value), 200)
      } catch (error) {
        if (error instanceof ResourceDeletedDuringMutationError) {
          return errorResponse(c, 404, 'not_found', 'Session not found')
        }
        return sessionValidationOr(c, error)
      }
    })
    .openapi(deleteSessionRoute, async (c) => {
      const { sessionId } = c.req.valid('param')
      const deps = c.get('deps')
      const auth = await requireAuth(c)
      if (auth instanceof Response) return auth
      const session = await deps.sessions.findRuntimeRow(auth.project.id, sessionId)
      if (!session) return errorResponse(c, 404, 'not_found', 'Session not found')
      const error = await deleteSessionResource(deps, auth, session, requestId(c))
      if (error) return runtimeErrorResponse(c, error) as never
      await wakeSerialHttpTriggerForSettledSession(deps, auth.project.id, sessionId)
      return c.body(null, 204)
    })
    .openapi(connectSessionSocketRoute, async (c) => {
      // Console browsers authenticate through a single-use ticket. DPoP-native
      // SDK clients are authorised here before the scope is forwarded to the
      // per-session DO. Non-upgrade callers get an explicit 426.
      const { sessionId } = c.req.valid('param')
      if (hasBrowserSocketTicket(c.req.raw)) {
        return upgradeSessionBrowserSocketTicket(c.env, c.req.raw, sessionId)
      }
      const deps = c.get('deps')
      const auth = await requireAuth(c)
      if (auth instanceof Response) {
        return auth
      }
      if (auth.oidc.clientId === c.env.OIDC_CLIENT_ID) {
        return errorResponse(
          c,
          403,
          'forbidden',
          'Realmroot Console sessions must exchange cookie authentication for a browser socket ticket',
        )
      }
      const session = await deps.sessions.find(auth.project.id, sessionId)
      if (!session) {
        return errorResponse(c, 404, 'not_found', 'Session not found')
      }
      if (c.req.header('upgrade')?.toLowerCase() !== 'websocket') {
        return errorResponse(c, 426, 'conflict', 'WebSocket upgrade required')
      }
      return upgradeSessionBrowserSocket(c.env, c.req.raw, sessionId, {
        sessionId,
        organizationId: auth.organization.id,
        projectId: session.metadata.pid,
        userId: auth.user.id,
        ...(session.spec.runtime !== 'ama' &&
        session.status.placement?.hostingMode === 'self_hosted' &&
        session.spec.environmentId
          ? { runnerEnvironmentId: session.spec.environmentId }
          : {}),
      })
    })
    .openapi(listSessionMessagesRoute, async (c) => {
      const { sessionId } = c.req.valid('param')
      const { limit = 50, cursor } = c.req.valid('query')
      const deps = c.get('deps')
      const auth = await requireAuth(c)
      if (auth instanceof Response) {
        return auth
      }
      const session = await deps.sessions.find(auth.project.id, sessionId)
      if (!session) {
        return errorResponse(c, 404, 'not_found', 'Session not found')
      }
      let parsedCursor: ReturnType<typeof parseListCursor> | null = null
      try {
        parsedCursor = cursor ? parseListCursor(cursor) : null
      } catch {
        return errorResponse(c, 400, 'validation_error', 'Invalid list cursor', {
          fields: { cursor: 'Cursor is invalid.' },
        })
      }
      const page = await deps.sessions.listMessages({
        projectId: auth.project.id,
        sessionId,
        limit,
        cursor: parsedCursor,
      })
      const last = page.rows.at(-1)
      const nextCursor = page.hasMore && last ? formatListCursor({ createdAt: last.createdAt, id: last.id }) : null
      return c.json(
        { data: page.rows.map(asSessionMessageResponse), pagination: { limit, nextCursor, hasMore: page.hasMore } },
        200,
      )
    })
    .openapi(createSessionMessageRoute, async (c) => {
      const { sessionId } = c.req.valid('param')
      const { content, requestId: messageRequestId } = c.req.valid('json')
      const deps = c.get('deps')
      const auth = await requireAuth(c)
      if (auth instanceof Response) {
        return auth
      }
      const session = await deps.sessions.findRuntimeRow(auth.project.id, sessionId)
      if (!session) {
        return errorResponse(c, 404, 'not_found', 'Session not found')
      }
      const outcome = await sendSessionMessage(deps, auth as never, session, content, messageRequestId ?? requestId(c))
      if (!outcome.ok) {
        return errorResponse(
          c,
          outcome.status,
          outcome.status === 500 ? 'internal_error' : 'conflict',
          outcome.message,
          {
            ...('runtimeError' in outcome && outcome.runtimeError ? { runtime: outcome.runtimeError } : {}),
          },
        )
      }
      return c.json(asSessionMessageResponse(outcome.message), 201)
    })
    .openapi(readSessionMessageRoute, async (c) => {
      const { sessionId, messageId } = c.req.valid('param')
      const deps = c.get('deps')
      const auth = await requireAuth(c)
      if (auth instanceof Response) {
        return auth
      }
      const session = await deps.sessions.find(auth.project.id, sessionId)
      if (!session) {
        return errorResponse(c, 404, 'not_found', 'Session not found')
      }
      const message = await deps.sessions.findMessage(auth.project.id, sessionId, messageId)
      if (!message) {
        return errorResponse(c, 404, 'not_found', 'Session message not found')
      }
      return c.json(asSessionMessageResponse(message), 200)
    })
    .openapi(listEventsRoute, async (c) => {
      const { sessionId } = c.req.valid('param')
      const query = c.req.valid('query')
      const deps = c.get('deps')
      const auth = await requireAuth(c)
      if (auth instanceof Response) {
        return auth
      }
      const session = await deps.sessions.find(auth.project.id, sessionId)
      if (!session) {
        return errorResponse(c, 404, 'not_found', 'Session not found')
      }
      const mediaType = negotiateMediaType(c, ['text/csv', 'text/event-stream'] as const)
      if (mediaType === 'text/csv') {
        return (await eventsCsvResponse(c, sessionId, query)) as never
      }
      if (mediaType === 'text/event-stream') {
        return eventsSseResponse(c, sessionId, query) as never
      }
      return await eventsJsonResponse(c, sessionId, query)
    })
    .openapi(createSessionEventsRoute, async (c) => {
      const { sessionId } = c.req.valid('param')
      const { events } = c.req.valid('json')
      const deps = c.get('deps')
      const auth = await requireSessionEventsAuth(c)
      if (auth instanceof Response) {
        return auth
      }

      const session = await deps.sessions.findRuntimeRow(auth.project.id, sessionId)
      if (!session) {
        return errorResponse(c, 404, 'not_found', 'Session not found')
      }

      if (isRunnerOidcAuth(c.env, auth)) {
        const ownedLease = await deps.sessions.activeSessionLeaseForRunner(auth.project.id, sessionId, {
          runnerId: auth.oidc.runnerId,
          subject: auth.oidc.subject,
        })
        if (!ownedLease) {
          return errorResponse(c, 403, 'forbidden', 'Runner token does not hold an active lease for this session')
        }
      }

      const accepted = await deps.sessionEventStore.insertEvents(
        {
          organizationId: session.organizationId ?? auth.organization.id,
          projectId: auth.project.id,
          sessionId: session.id,
        },
        events.map((event) => ({ type: event.type, payload: event.payload }) as EnborEvent),
      )
      return c.json({ accepted }, 201)
    })
    .openapi(listSessionApprovalsRoute, async (c) => {
      const { sessionId } = c.req.valid('param')
      const deps = c.get('deps')
      const auth = await requireAuth(c)
      if (auth instanceof Response) {
        return auth
      }
      const session = await deps.sessions.findRuntimeRow(auth.project.id, sessionId)
      if (!session) {
        return errorResponse(c, 404, 'not_found', 'Session not found')
      }
      const { pending } = sessionApprovalState(session.metadata)
      const decided = await deps.sessions.listApprovals(auth.project.id, sessionId)
      const data = [
        ...(pending ? [pendingApprovalResponse(sessionId, pending)] : []),
        ...decided.map(asSessionApprovalResponse),
      ]
      return c.json({ data, pagination: { limit: data.length, nextCursor: null, hasMore: false } }, 200)
    })
    .openapi(readSessionApprovalRoute, async (c) => {
      const { sessionId, approvalId } = c.req.valid('param')
      const deps = c.get('deps')
      const auth = await requireAuth(c)
      if (auth instanceof Response) {
        return auth
      }
      const session = await deps.sessions.findRuntimeRow(auth.project.id, sessionId)
      if (!session) {
        return errorResponse(c, 404, 'not_found', 'Session not found')
      }
      const decided = await deps.sessions.findApproval(auth.project.id, sessionId, approvalId)
      if (decided) {
        return c.json(asSessionApprovalResponse(decided), 200)
      }
      const { pending } = sessionApprovalState(session.metadata)
      if (pending?.id === approvalId) {
        return c.json(pendingApprovalResponse(sessionId, pending), 200)
      }
      return errorResponse(c, 404, 'not_found', 'Session approval not found')
    })
    .openapi(decideSessionApprovalRoute, async (c) => {
      const { sessionId, approvalId } = c.req.valid('param')
      const body = c.req.valid('json')
      const deps = c.get('deps')
      const auth = await requireAuth(c)
      if (auth instanceof Response) {
        return auth
      }
      const session = await deps.sessions.findRuntimeRow(auth.project.id, sessionId)
      if (!session) {
        return errorResponse(c, 404, 'not_found', 'Session not found')
      }
      // Decide is a single forward to the runtime boundary (it executes the
      // approved tool or records the denial, persists the decided approval, and
      // resumes the turn), so the route calls the runtime usecase with deps directly.
      const outcome = await decideRuntimeApproval(
        deps,
        auth,
        session,
        approvalId,
        {
          decision: body.decision,
          ...(body.reason !== undefined ? { reason: body.reason } : {}),
          ...(body.result !== undefined ? { result: body.result } : {}),
        },
        requestId(c),
      )
      if (!outcome.ok) {
        return runtimeErrorResponse(c, outcome.error) as never
      }
      return c.json(asSessionApprovalResponse(outcome.value), 200)
    })
}

// --- helpers ---

// Extracts a human message from a runtime error payload.
export function runtimeErrorMessage(payload: Record<string, unknown>) {
  const error = payload.error
  let message: string
  if (typeof error === 'string') {
    message = error
  } else if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string') {
    message = error.message
  } else if (typeof payload.message === 'string') {
    message = payload.message
  } else {
    message = 'Runtime command failed'
  }
  return message
}

function sessionValidationOr(c: Context<DepsEnv>, error: unknown) {
  if (error instanceof SessionValidationError) {
    return errorResponse(c, 400, 'validation_error', error.message, { fields: error.fields })
  }
  throw error
}
