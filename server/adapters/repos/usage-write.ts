import { computeModelCostMicros, isProviderErrorCategory, providerFamily } from '@server/domain/provider-adapter'
import { newPrimaryKey } from '@server/id'
import { and, asc, desc, eq } from 'drizzle-orm'
import type { drizzle } from 'drizzle-orm/d1'
import type { AmaEvent, ToolCall } from '../../../shared/session-events'
import { providerModels, providers, sessionEvents, sessions, usageRecords } from '../../db/schema'

type Db = ReturnType<typeof drizzle>

export interface UsageRecordingScope {
  organizationId: string
  projectId: string
  sessionId: string
}

// Usage-write boundary. Persists provider-domain accounting (model/tool usage
// rows + provider lastError health) hung off canonical session-event inserts.
// Write-only: the read/report side is UsageRepo. Constructed by the session-
// event-store infra, not wired into Deps (no usecase records usage directly).
export interface UsageWriteRepo {
  recordProviderSignals(scope: UsageRecordingScope, sessionEventId: string, canonicalEvent: AmaEvent): Promise<void>
}

function numberField(payload: Record<string, unknown>, key: string) {
  const value = payload[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function stringField(payload: Record<string, unknown>, key: string) {
  const value = payload[key]
  return typeof value === 'string' && value.length > 0 ? value : null
}

function objectField(payload: Record<string, unknown>, key: string): Record<string, unknown> {
  const value = payload[key]
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

async function sessionAttribution(db: Db, scope: UsageRecordingScope) {
  return (
    (await db
      .select({
        agentId: sessions.agentId,
        agentVersionId: sessions.agentVersionId,
        modelProvider: sessions.modelProvider,
        environmentSnapshot: sessions.environmentSnapshot,
      })
      .from(sessions)
      .where(and(eq(sessions.id, scope.sessionId), eq(sessions.projectId, scope.projectId)))
      .get()) ?? null
  )
}

function sessionHostingMode(session: Awaited<ReturnType<typeof sessionAttribution>>) {
  const snapshot = session?.environmentSnapshot ? safeObject(session.environmentSnapshot) : {}
  const type = snapshot.type
  return type === 'cloud' || type === 'self_hosted' ? type : null
}

// Resolves the global vendor row backing a runtime provider name: a vendor id
// matches directly, otherwise the provider family slug (e.g. runtime
// `cloudflare-workers-ai` -> the `workers-ai` vendor row).
async function resolveProviderConfig(db: Db, provider: string) {
  const byId = await db
    .select({ id: providers.id, slug: providers.slug })
    .from(providers)
    .where(eq(providers.id, provider))
    .get()
  if (byId) {
    return byId
  }
  return (
    (await db
      .select({ id: providers.id, slug: providers.slug })
      .from(providers)
      .where(eq(providers.slug, providerFamily(provider)))
      .orderBy(desc(providers.updatedAt))
      .get()) ?? null
  )
}

async function modelPricing(db: Db, providerId: string, modelId: string) {
  const row = await db
    .select({ pricing: providerModels.pricing })
    .from(providerModels)
    .where(and(eq(providerModels.providerId, providerId), eq(providerModels.modelId, modelId)))
    .get()
  if (!row?.pricing) {
    return null
  }
  return JSON.parse(row.pricing) as Record<string, unknown>
}

async function recordModelUsage(
  db: Db,
  scope: UsageRecordingScope,
  sessionEventId: string,
  payload: Record<string, unknown>,
) {
  const promptTokens = numberField(payload, 'promptTokens') ?? numberField(payload, 'inputTokens') ?? 0
  const completionTokens = numberField(payload, 'completionTokens') ?? numberField(payload, 'outputTokens') ?? 0
  const totalTokens = numberField(payload, 'totalTokens') ?? promptTokens + completionTokens
  const eventCostMicros = numberField(payload, 'costMicros')
  if (totalTokens <= 0 && eventCostMicros === null) {
    return
  }
  const session = await sessionAttribution(db, scope)
  const provider = sessionHostingMode(session) === 'cloud' ? session?.modelProvider : null
  if (!provider) {
    return
  }
  const modelId = stringField(payload, 'model') ?? 'unknown'
  const config = await resolveProviderConfig(db, provider)
  // Vendor ids carry no family information themselves; the vendor slug is the
  // authoritative family for attribution.
  const family = providerFamily(config?.slug ?? provider)
  const pricing = config ? await modelPricing(db, config.id, modelId) : null
  const pricedCostMicros = pricing ? computeModelCostMicros(pricing, { promptTokens, completionTokens }) : null
  const costMicros = eventCostMicros ?? pricedCostMicros
  await db.insert(usageRecords).values({
    id: newPrimaryKey(),
    organizationId: scope.organizationId,
    projectId: scope.projectId,
    agentId: session?.agentId ?? null,
    agentVersionId: session?.agentVersionId ?? null,
    sessionId: scope.sessionId,
    sessionEventId,
    correlationId: null,
    providerId: config?.id ?? null,
    providerType: family,
    modelId,
    state: 'success',
    promptTokens,
    completionTokens,
    totalTokens,
    durationMs: 0,
    costMicros: costMicros ?? 0,
    currency: 'USD',
    usageType: 'model',
    metadata: JSON.stringify({
      costSource: eventCostMicros !== null ? 'event' : pricedCostMicros !== null ? 'model_pricing' : 'unpriced',
    }),
    createdAt: new Date().toISOString(),
  })
}

async function recordToolUsage(
  db: Db,
  scope: UsageRecordingScope,
  sessionEventId: string,
  toolCall: ToolCall,
  payload: Record<string, unknown>,
) {
  const session = await sessionAttribution(db, scope)
  await db.insert(usageRecords).values({
    id: newPrimaryKey(),
    organizationId: scope.organizationId,
    projectId: scope.projectId,
    agentId: session?.agentId ?? null,
    agentVersionId: session?.agentVersionId ?? null,
    sessionId: scope.sessionId,
    sessionEventId,
    correlationId: `tool:${toolCall.id}`,
    providerId: null,
    providerType: 'sandbox',
    modelId: toolCall.name,
    state: payload.error ? 'error' : 'success',
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    durationMs: numberField(payload, 'durationMs') ?? 0,
    costMicros: 0,
    currency: 'USD',
    usageType: 'tool',
    metadata: '{}',
    createdAt: new Date().toISOString(),
  })
}

async function resolveToolCall(db: Db, scope: UsageRecordingScope, toolCallId: string): Promise<ToolCall | null> {
  const rows = await db
    .select({ payload: sessionEvents.payload })
    .from(sessionEvents)
    .where(and(eq(sessionEvents.projectId, scope.projectId), eq(sessionEvents.sessionId, scope.sessionId)))
    .orderBy(asc(sessionEvents.sequence))
    .all()
  for (const row of rows) {
    const payload = safeObject(row.payload)
    const message = objectField(payload, 'message')
    const content = Array.isArray(message.content) ? message.content : []
    for (const item of content) {
      const block = objectValue(item)
      if (block.type !== 'tool_call') continue
      const toolCall = objectField(block, 'toolCall')
      if (stringField(toolCall, 'id') === toolCallId) {
        const input = objectField(toolCall, 'input')
        return {
          id: toolCallId,
          name: stringField(toolCall, 'name') ?? 'tool',
          input,
        }
      }
    }
  }
  return null
}

function safeObject(value: string): Record<string, unknown> {
  try {
    return objectValue(JSON.parse(value))
  } catch {
    return {}
  }
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

// Normalized provider errors carry a stable category; persist the latest one
// on the configured provider so operators see provider health without
// digging through session events. Raw provider payloads never reach here.
async function recordProviderError(db: Db, scope: UsageRecordingScope, payload: Record<string, unknown>) {
  if (!isProviderErrorCategory(payload.category)) {
    return
  }
  const session = await sessionAttribution(db, scope)
  const provider = stringField(payload, 'provider') ?? session?.modelProvider
  if (!provider) {
    return
  }
  const config = await resolveProviderConfig(db, provider)
  if (!config) {
    return
  }
  const retryAfterSeconds = numberField(payload, 'retryAfterSeconds')
  await db
    .update(providers)
    .set({
      lastError: JSON.stringify({
        type: 'provider_error',
        category: payload.category,
        message: stringField(payload, 'message') ?? 'Provider request failed.',
        retryable: payload.retryable === true,
        ...(retryAfterSeconds !== null ? { retryAfterSeconds } : {}),
        occurredAt: new Date().toISOString(),
      }),
      updatedAt: new Date().toISOString(),
    })
    .where(eq(providers.id, config.id))
}

// Canonical-event seam for provider-domain accounting: model usage rows from
// usage.recorded events (cloud runtime turns and runner-ingested events share
// this insert path), tool usage rows from tool result message blocks, and
// provider lastError health from normalized runtime errors.
export function createUsageWriteRepo(db: Db): UsageWriteRepo {
  return {
    async recordProviderSignals(scope, sessionEventId, canonicalEvent) {
      if (canonicalEvent.type === 'usage.recorded') {
        await recordModelUsage(db, scope, sessionEventId, canonicalEvent.payload)
        return
      }
      if (canonicalEvent.type === 'message.completed') {
        for (const block of canonicalEvent.payload.message.content) {
          if (block.type === 'tool_result') {
            const toolCall = await resolveToolCall(db, scope, block.toolCallId)
            if (!toolCall) continue
            await recordToolUsage(db, scope, sessionEventId, toolCall, {
              result: block.result,
              ...(block.error ? { error: block.error } : {}),
            })
          }
        }
        return
      }
      if (canonicalEvent.type === 'runtime.error') {
        await recordProviderError(db, scope, canonicalEvent.payload)
      }
    },
  }
}
