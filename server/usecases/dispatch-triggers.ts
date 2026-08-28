import type { ResourceMetadata } from '@server/domain/resource'
import { parseJson } from '@server/domain/runtime/session-snapshot'
import type { Trigger } from '@server/domain/trigger'
import { AMA_ANNOTATION_KEY_ROUTING_KEY_HASH } from '@server/metadata-keys'
import type { Deps } from './deps'
import {
  type HttpTriggerTemplateContext,
  PromptTemplateRenderError,
  renderHttpPromptTemplate,
} from './http-trigger-template'
import {
  type AuthScope,
  type ClaimedRun,
  type DueTrigger,
  type PendingHttpRun,
  type RuntimeSessionHandle,
  TriggerConflictError,
  type TriggerDispatchQueueMessage,
  type TriggerDispatchRepo,
  TriggerValidationError,
} from './ports'
import { createSession, reopenSession } from './runtime/sessions'
import { sendSessionMessage } from './sessions'

type SerialTriggerDispatchRepo = Pick<
  TriggerDispatchRepo,
  | 'enqueueHttpRun'
  | 'claimNextHttpRun'
  | 'requeueHttpRun'
  | 'staleHttpRuns'
  | 'hasPendingHttpRuns'
  | 'pendingHttpTriggers'
>

function serialTriggerDispatchRepo(deps: Deps): SerialTriggerDispatchRepo {
  return deps.triggerDispatch
}

export interface ScheduleDispatchResult {
  heartbeatAt: string
  claimed: number
  dispatched: number
  failed: number
  skipped: number
  runs: Array<{
    runId: string
    triggerId: string
    scheduledFor: string
    status: string
    sessionId: string | null
    errorMessage: string | null
  }>
}

function safeMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function runResult(
  run: ClaimedRun,
  triggerId: string,
  status: string,
  sessionId: string | null,
  errorMessage: string | null,
) {
  return {
    runId: run.id,
    triggerId,
    scheduledFor: run.scheduledFor,
    status,
    sessionId,
    errorMessage,
  }
}

// The scheduler dispatches as a synthetic system actor; the audit gateway maps
// `system:scheduler` to a system actor with no user id.
function systemAuth(trigger: DueTrigger, project: { id: string; name: string }): AuthScope {
  return {
    organization: { id: trigger.organizationId, name: trigger.organizationId },
    project,
    user: { id: 'system:scheduler' },
    roles: ['system'],
    permissions: ['*'],
  }
}

async function recordDispatch(
  deps: Deps,
  auth: AuthScope,
  trigger: DueTrigger,
  run: ClaimedRun,
  outcome: { ok: true; sessionId: string } | { ok: false; message: string },
) {
  await deps.audit.record(auth, {
    action: 'scheduled_trigger.dispatch',
    resourceType: 'scheduled_trigger',
    resourceId: trigger.id,
    outcome: outcome.ok ? 'success' : 'failure',
    correlationId: run.correlationId,
    ...(outcome.ok ? { sessionId: outcome.sessionId } : {}),
    metadata: outcome.ok
      ? { runId: run.id, scheduledFor: run.scheduledFor, sessionId: outcome.sessionId }
      : { runId: run.id, scheduledFor: run.scheduledFor, message: outcome.message },
  })
}

async function recordHttpDispatch(
  deps: Deps,
  auth: AuthScope,
  trigger: Trigger,
  run: ClaimedRun,
  outcome: { ok: true; sessionId: string } | { ok: false; message: string },
) {
  await deps.audit.record(auth, {
    action: 'http_trigger.dispatch',
    resourceType: 'trigger',
    resourceId: trigger.metadata.uid,
    outcome: outcome.ok ? 'success' : 'failure',
    correlationId: run.correlationId,
    ...(outcome.ok ? { sessionId: outcome.sessionId } : {}),
    metadata: outcome.ok
      ? { runId: run.id, triggeredAt: run.scheduledFor, sessionId: outcome.sessionId }
      : { runId: run.id, triggeredAt: run.scheduledFor, message: outcome.message },
  })
}

async function dispatchToReusableHttpSession(
  deps: Deps,
  auth: AuthScope,
  session: RuntimeSessionHandle,
  content: string,
  requestId: string | null,
) {
  let target = session
  if (target.state === 'closed') {
    const reopened = await reopenSession(deps, auth, target, requestId)
    if (!reopened.ok) {
      return { ok: false as const, message: reopened.error.message }
    }
    const refreshed = await deps.sessions.findRuntimeRow(auth.project.id, target.id)
    if (!refreshed) {
      return { ok: false as const, message: 'Session runtime is no longer available' }
    }
    target = refreshed
  }

  if (target.state === 'pending') {
    return {
      ok: true as const,
      message: await deps.sessions.insertMessage({
        organizationId: auth.organization.id,
        projectId: auth.project.id,
        sessionId: target.id,
        content,
        delivery: 'queued',
        state: 'accepted',
        createdAt: new Date().toISOString(),
      }),
    }
  }

  return await sendSessionMessage(deps, auth, target, content, requestId)
}

function httpTriggerRoutingKey(body: unknown): string | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return null
  }
  const key = (body as Record<string, unknown>).routing_key
  return typeof key === 'string' && key.trim().length > 0 ? key : null
}

async function httpTriggerRoutingKeyHash(body: unknown): Promise<string | null> {
  const key = httpTriggerRoutingKey(body)
  if (!key) return null
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(key))
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

function stringRecordValue(value: unknown): Record<string, string> {
  const record = recordValue(value)
  if (!record) return {}
  return Object.fromEntries(
    Object.entries(record).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
  )
}

function mergeStringMaps(base: Record<string, string>, next: Record<string, string>): Record<string, string> {
  return { ...base, ...next }
}

function httpTriggerBodyMetadata(body: unknown): Pick<ResourceMetadata, 'labels' | 'annotations'> {
  const bodyObject = recordValue(body)
  const requestMetadata = recordValue(bodyObject?.metadata)
  return {
    labels: stringRecordValue(requestMetadata?.labels),
    annotations: stringRecordValue(requestMetadata?.annotations),
  }
}

async function failRun(deps: Deps, auth: AuthScope, trigger: DueTrigger, run: ClaimedRun, message: string) {
  await deps.triggerDispatch.markRunFailed(trigger, run, message)
  await recordDispatch(deps, auth, trigger, run, { ok: false, message })
}

async function dispatchTrigger(deps: Deps, trigger: DueTrigger, heartbeatAt: string) {
  const run = await deps.triggerDispatch.claimRun(trigger, heartbeatAt)
  if (!run) {
    return { skipped: true as const }
  }

  // The fallback project (id used as name) covers a missing project row; the
  // resolved name overrides it when the project is still present.
  let auth = systemAuth(trigger, { id: trigger.projectId, name: trigger.projectId })
  try {
    const projectName = await deps.triggerDispatch.projectName(trigger.projectId)
    if (!projectName) {
      throw new Error('Scheduled trigger project is unavailable')
    }
    auth = systemAuth(trigger, { id: trigger.projectId, name: projectName })

    const sessionMetadata: Pick<ResourceMetadata, 'labels' | 'annotations'> = {
      labels: trigger.template.metadata.labels,
      annotations: {
        ...trigger.template.metadata.annotations,
        source: 'scheduled-agent-trigger',
        scheduledTriggerId: trigger.id,
        scheduledRunId: run.id,
        scheduledFor: run.scheduledFor,
        correlationId: run.correlationId,
      },
    }
    const result = await createSession(deps, auth, {
      agentId: trigger.template.spec.agentId,
      // Null when the trigger is unpinned; createSession resolves an environment
      // for the runtime at dispatch time.
      environmentId: trigger.template.spec.environmentId,
      options: {
        name: trigger.name,
        metadata: sessionMetadata,
        prompt: trigger.template.spec.promptTemplate,
        env: trigger.template.spec.env,
        envFrom: trigger.template.spec.envFrom,
        volumes: trigger.template.spec.volumes,
        volumeMounts: trigger.template.spec.volumeMounts,
      },
      requestId: run.correlationId,
    })

    if (!result.ok) {
      const message = result.error.message
      await failRun(deps, auth, trigger, run, message)
      return runResult(run, trigger.id, 'failed', null, message)
    }

    const session = result.value
    await deps.triggerDispatch.markRunDispatched(trigger, run, session.metadata.uid, sessionMetadata)
    await recordDispatch(deps, auth, trigger, run, { ok: true, sessionId: session.metadata.uid })
    return runResult(run, trigger.id, 'dispatched', session.metadata.uid, null)
  } catch (error) {
    const message = safeMessage(error)
    await failRun(deps, auth, trigger, run, message)
    return runResult(run, trigger.id, 'failed', null, message)
  }
}

// Background dispatch orchestration: claims due trigger runs idempotently,
// creates a session per claimed run via the runtime gateway, and records the
// dispatch outcome to the audit log. Called from the worker scheduled entry and
// the e2e dispatch fixture with deps built by createDeps(env).
export async function dispatchDueScheduledTriggers(
  deps: Deps,
  options: { heartbeatAt?: string; projectId?: string; limit?: number } = {},
): Promise<ScheduleDispatchResult> {
  const heartbeatAt = options.heartbeatAt ?? new Date().toISOString()
  const dueTriggers = await deps.triggerDispatch.dueTriggers({
    heartbeatAt,
    ...(options.projectId !== undefined ? { projectId: options.projectId } : {}),
    limit: options.limit ?? 50,
  })

  const result: ScheduleDispatchResult = {
    heartbeatAt,
    claimed: 0,
    dispatched: 0,
    failed: 0,
    skipped: 0,
    runs: [],
  }

  for (const trigger of dueTriggers) {
    try {
      const run = await dispatchTrigger(deps, trigger, heartbeatAt)
      if ('skipped' in run) {
        result.skipped += 1
        continue
      }
      result.claimed += 1
      if (run.status === 'dispatched') {
        result.dispatched += 1
      } else {
        result.failed += 1
      }
      result.runs.push(run)
    } catch (error) {
      result.failed += 1
      result.runs.push({
        runId: '',
        triggerId: trigger.id,
        scheduledFor: trigger.nextDueAt,
        status: 'failed',
        sessionId: null,
        errorMessage: safeMessage(error),
      })
    }
  }

  return result
}

export interface HttpTriggerDispatchInput {
  trigger: Trigger
  context: HttpTriggerTemplateContext
  idempotencyKey?: string | null
}

type HttpDispatchResult = {
  runId: string
  triggerId: string
  triggeredAt: string
  state: 'queued' | 'dispatched' | 'failed'
  sessionId: string | null
  errorMessage: string | null
  replayed?: boolean
}

export async function dispatchHttpTrigger(
  deps: Deps,
  auth: AuthScope,
  input: HttpTriggerDispatchInput,
): Promise<HttpDispatchResult> {
  const { trigger } = input
  if (trigger.spec.source.type !== 'http') {
    throw new TriggerConflictError('Only HTTP triggers can create runs from requests')
  }
  if (trigger.metadata.archivedAt !== null) {
    throw new TriggerConflictError('Archived triggers cannot be dispatched')
  }
  if (trigger.spec.suspend) {
    throw new TriggerConflictError('Suspended triggers cannot be dispatched')
  }

  const triggeredAt = new Date().toISOString()
  const keyHash = await httpTriggerRoutingKeyHash(input.context.body)
  const existingSession = keyHash
    ? await deps.sessions.findReusableHttpTriggerSession(auth.project.id, trigger.metadata.uid, keyHash)
    : null
  let renderedPrompt: string
  try {
    renderedPrompt = renderHttpPromptTemplate(trigger.spec.template.spec.promptTemplate, {
      ...input.context,
      run: {
        session_reused: Boolean(existingSession),
        session_id: existingSession?.id ?? null,
        session_state: existingSession?.state ?? null,
      },
    })
  } catch (error) {
    if (error instanceof PromptTemplateRenderError) {
      throw new TriggerValidationError('Invalid trigger prompt template', { promptTemplate: error.message })
    }
    throw error
  }

  const requestMetadata = httpTriggerBodyMetadata(input.context.body)
  if (trigger.spec.source.concurrency?.mode === 'serial') {
    return dispatchSerialHttpTrigger(deps, auth, {
      trigger,
      triggeredAt,
      keyHash,
      renderedPrompt,
      requestMetadata,
      idempotencyKey: input.idempotencyKey ?? null,
    })
  }
  const run = await deps.triggerDispatch.claimHttpRun(
    auth,
    trigger,
    triggeredAt,
    input.idempotencyKey ?? null,
    requestMetadata,
  )
  if (!run) {
    throw new TriggerConflictError('HTTP trigger run already exists for this idempotency key')
  }

  const sessionMetadata: Pick<ResourceMetadata, 'labels' | 'annotations'> = {
    labels: mergeStringMaps(trigger.spec.template.metadata.labels, requestMetadata.labels),
    annotations: {
      ...trigger.spec.template.metadata.annotations,
      ...requestMetadata.annotations,
      ...(keyHash ? { [AMA_ANNOTATION_KEY_ROUTING_KEY_HASH]: keyHash } : {}),
      source: 'http-trigger',
      httpTriggerId: trigger.metadata.uid,
      httpRunId: run.id,
      triggeredAt,
      correlationId: run.correlationId,
    },
  }

  if (existingSession) {
    const outcome = await dispatchToReusableHttpSession(deps, auth, existingSession, renderedPrompt, run.correlationId)
    if (!outcome.ok) {
      const message = outcome.message
      await deps.triggerDispatch.markRunFailed(trigger, run, message)
      await recordHttpDispatch(deps, auth, trigger, run, { ok: false, message })
      return {
        runId: run.id,
        triggerId: trigger.metadata.uid,
        triggeredAt,
        state: 'failed',
        sessionId: null,
        errorMessage: message,
      }
    }

    await deps.triggerDispatch.markRunDispatched(trigger, run, existingSession.id, {
      ...sessionMetadata,
      annotations: {
        ...sessionMetadata.annotations,
        reusedSession: 'true',
      },
    })
    await recordHttpDispatch(deps, auth, trigger, run, { ok: true, sessionId: existingSession.id })
    return {
      runId: run.id,
      triggerId: trigger.metadata.uid,
      triggeredAt,
      state: 'dispatched',
      sessionId: existingSession.id,
      errorMessage: null,
    }
  }

  const result = await createSession(deps, auth, {
    agentId: trigger.spec.template.spec.agentId,
    environmentId: trigger.spec.template.spec.environmentId,
    options: {
      name: trigger.metadata.name,
      metadata: sessionMetadata,
      prompt: renderedPrompt,
      env: trigger.spec.template.spec.env,
      envFrom: trigger.spec.template.spec.envFrom,
      volumes: trigger.spec.template.spec.volumes,
      volumeMounts: trigger.spec.template.spec.volumeMounts,
    },
    requestId: run.correlationId,
  })

  if (!result.ok) {
    const message = result.error.message
    await deps.triggerDispatch.markRunFailed(trigger, run, message)
    await recordHttpDispatch(deps, auth, trigger, run, { ok: false, message })
    return {
      runId: run.id,
      triggerId: trigger.metadata.uid,
      triggeredAt,
      state: 'failed',
      sessionId: null,
      errorMessage: message,
    }
  }

  await deps.triggerDispatch.markRunDispatched(trigger, run, result.value.metadata.uid, sessionMetadata)
  await recordHttpDispatch(deps, auth, trigger, run, { ok: true, sessionId: result.value.metadata.uid })
  return {
    runId: run.id,
    triggerId: trigger.metadata.uid,
    triggeredAt,
    state: 'dispatched',
    sessionId: result.value.metadata.uid,
    errorMessage: null,
  }
}

async function dispatchSerialHttpTrigger(
  deps: Deps,
  auth: AuthScope,
  input: {
    trigger: Trigger
    triggeredAt: string
    keyHash: string | null
    renderedPrompt: string
    requestMetadata: Pick<ResourceMetadata, 'labels' | 'annotations'>
    idempotencyKey: string | null
  },
): Promise<HttpDispatchResult> {
  const repo = serialTriggerDispatchRepo(deps)
  const enqueued = await repo.enqueueHttpRun(
    auth,
    input.trigger,
    input.triggeredAt,
    input.idempotencyKey,
    input.requestMetadata,
    { routingKeyHash: input.keyHash, renderedPrompt: input.renderedPrompt },
  )
  if (enqueued.replayed) {
    await wakeHttpTrigger(deps, auth.project.id, input.trigger.metadata.uid)
    return {
      runId: enqueued.runId,
      triggerId: input.trigger.metadata.uid,
      triggeredAt: input.triggeredAt,
      state: 'queued',
      sessionId: null,
      errorMessage: null,
      replayed: true,
    }
  }

  const claimed = await repo.claimNextHttpRun(input.trigger.metadata.uid)

  if (claimed) {
    const result = await dispatchClaimedSerialHttpRunWithRecovery(deps, input.trigger, claimed)
    if (await repo.hasPendingHttpRuns(input.trigger.metadata.uid)) {
      await wakeHttpTrigger(deps, auth.project.id, input.trigger.metadata.uid, 5)
    }
    if (claimed.run.id === enqueued.run.id) return result
  }

  if (enqueued.wake) {
    await wakeHttpTrigger(deps, auth.project.id, input.trigger.metadata.uid, 5)
  }
  return {
    runId: enqueued.run.id,
    triggerId: input.trigger.metadata.uid,
    triggeredAt: input.triggeredAt,
    state: 'queued',
    sessionId: null,
    errorMessage: null,
  }
}

function pendingRunAuth(run: PendingHttpRun): AuthScope {
  return {
    organization: { id: run.organizationId, name: run.organizationName },
    project: { id: run.projectId, name: run.projectName },
    user: { id: run.requestedByUserId },
    roles: ['system'],
    permissions: ['*'],
  }
}

async function dispatchClaimedSerialHttpRun(
  deps: Deps,
  trigger: Trigger,
  pending: PendingHttpRun,
): Promise<HttpDispatchResult> {
  const auth = pendingRunAuth(pending)
  const requestMetadata = pending.run.metadata as Pick<ResourceMetadata, 'labels' | 'annotations'>
  const existingSession = pending.routingKeyHash
    ? await deps.sessions.findReusableHttpTriggerSession(auth.project.id, trigger.metadata.uid, pending.routingKeyHash)
    : null
  const sessionMetadata: Pick<ResourceMetadata, 'labels' | 'annotations'> = {
    labels: mergeStringMaps(trigger.spec.template.metadata.labels, requestMetadata.labels ?? {}),
    annotations: {
      ...trigger.spec.template.metadata.annotations,
      ...(requestMetadata.annotations ?? {}),
      ...(pending.routingKeyHash ? { [AMA_ANNOTATION_KEY_ROUTING_KEY_HASH]: pending.routingKeyHash } : {}),
      source: 'http-trigger',
      httpTriggerId: trigger.metadata.uid,
      httpRunId: pending.run.id,
      triggeredAt: pending.run.scheduledFor,
      correlationId: pending.run.correlationId,
    },
  }

  if (existingSession) {
    const outcome = await dispatchToReusableHttpSession(
      deps,
      auth,
      existingSession,
      pending.renderedPrompt,
      pending.run.correlationId,
    )
    if (!outcome.ok) {
      await deps.triggerDispatch.markRunFailed(trigger, pending.run, outcome.message)
      await recordHttpDispatch(deps, auth, trigger, pending.run, { ok: false, message: outcome.message })
      return {
        runId: pending.run.id,
        triggerId: trigger.metadata.uid,
        triggeredAt: pending.run.scheduledFor,
        state: 'failed',
        sessionId: null,
        errorMessage: outcome.message,
      }
    }
    await deps.triggerDispatch.markRunDispatched(trigger, pending.run, existingSession.id, {
      ...sessionMetadata,
      annotations: { ...sessionMetadata.annotations, reusedSession: 'true' },
    })
    await recordHttpDispatch(deps, auth, trigger, pending.run, { ok: true, sessionId: existingSession.id })
    return {
      runId: pending.run.id,
      triggerId: trigger.metadata.uid,
      triggeredAt: pending.run.scheduledFor,
      state: 'dispatched',
      sessionId: existingSession.id,
      errorMessage: null,
    }
  }

  const result = await createSession(deps, auth, {
    agentId: trigger.spec.template.spec.agentId,
    environmentId: trigger.spec.template.spec.environmentId,
    options: {
      name: trigger.metadata.name,
      metadata: sessionMetadata,
      prompt: pending.renderedPrompt,
      env: trigger.spec.template.spec.env,
      envFrom: trigger.spec.template.spec.envFrom,
      volumes: trigger.spec.template.spec.volumes,
      volumeMounts: trigger.spec.template.spec.volumeMounts,
    },
    requestId: pending.run.correlationId,
  })
  if (!result.ok) {
    const message = result.error.message
    await deps.triggerDispatch.markRunFailed(trigger, pending.run, message)
    await recordHttpDispatch(deps, auth, trigger, pending.run, { ok: false, message })
    return {
      runId: pending.run.id,
      triggerId: trigger.metadata.uid,
      triggeredAt: pending.run.scheduledFor,
      state: 'failed',
      sessionId: null,
      errorMessage: message,
    }
  }
  await deps.triggerDispatch.markRunDispatched(trigger, pending.run, result.value.metadata.uid, sessionMetadata)
  await recordHttpDispatch(deps, auth, trigger, pending.run, { ok: true, sessionId: result.value.metadata.uid })
  return {
    runId: pending.run.id,
    triggerId: trigger.metadata.uid,
    triggeredAt: pending.run.scheduledFor,
    state: 'dispatched',
    sessionId: result.value.metadata.uid,
    errorMessage: null,
  }
}

async function dispatchClaimedSerialHttpRunWithRecovery(
  deps: Deps,
  trigger: Trigger,
  pending: PendingHttpRun,
): Promise<HttpDispatchResult> {
  try {
    return await dispatchClaimedSerialHttpRun(deps, trigger, pending)
  } catch (error) {
    await serialTriggerDispatchRepo(deps).requeueHttpRun(pending.run.id)
    await wakeHttpTrigger(deps, pending.projectId, pending.triggerId, 5)
    throw error
  }
}

async function wakeHttpTrigger(deps: Deps, projectId: string, triggerId: string, delaySeconds = 0) {
  await deps.triggerDispatchQueue?.enqueue(
    { type: 'trigger.dispatch', triggerId, projectId },
    delaySeconds > 0 ? { delaySeconds } : undefined,
  )
}

export async function wakeSerialHttpTriggerForSettledSession(
  deps: Deps,
  projectId: string,
  sessionId: string,
): Promise<boolean> {
  const session = await deps.sessionOrchestration.findSession(projectId, sessionId)
  if (!session || session.state === 'pending' || session.state === 'running') return false

  const metadata = parseJson<{ annotations?: Record<string, unknown> }>(session.metadata)
  const annotations = metadata?.annotations
  const triggerId = annotations?.source === 'http-trigger' ? annotations.httpTriggerId : null
  if (typeof triggerId !== 'string' || !triggerId) return false

  const trigger = await deps.triggers.find(projectId, triggerId)
  if (trigger?.spec.source.type !== 'http' || trigger.spec.source.concurrency?.mode !== 'serial') return false

  if (deps.triggerDispatchQueue?.configured()) {
    await wakeHttpTrigger(deps, projectId, triggerId)
  } else {
    await dispatchNextSerialHttpTrigger(deps, projectId, triggerId)
  }
  return true
}

export async function dispatchNextSerialHttpTrigger(
  deps: Deps,
  projectId: string,
  triggerId: string,
): Promise<{ pending: boolean; blocked: boolean }> {
  const repo = serialTriggerDispatchRepo(deps)
  const trigger = await deps.triggers.find(projectId, triggerId)
  if (trigger?.spec.source.type !== 'http') {
    return { pending: false, blocked: false }
  }
  if (trigger.metadata.archivedAt !== null || trigger.spec.suspend) {
    return { pending: await repo.hasPendingHttpRuns(triggerId), blocked: true }
  }
  const claimed = await repo.claimNextHttpRun(triggerId)
  if (!claimed) {
    return { pending: await repo.hasPendingHttpRuns(triggerId), blocked: true }
  }
  await dispatchClaimedSerialHttpRunWithRecovery(deps, trigger, claimed)
  return { pending: await repo.hasPendingHttpRuns(triggerId), blocked: false }
}

export async function consumeSerialHttpTriggerWake(deps: Deps, message: TriggerDispatchQueueMessage): Promise<void> {
  const result = await dispatchNextSerialHttpTrigger(deps, message.projectId, message.triggerId)
  if (result.pending && !result.blocked) {
    await deps.triggerDispatchQueue?.enqueue(message)
  }
}

const SERIAL_HTTP_DISPATCH_STALE_MS = 5 * 60 * 1000

async function recoverStaleSerialHttpRuns(deps: Deps, limit: number, now: Date): Promise<void> {
  const repo = serialTriggerDispatchRepo(deps)
  const staleBefore = new Date(now.getTime() - SERIAL_HTTP_DISPATCH_STALE_MS).toISOString()
  const staleRuns = await repo.staleHttpRuns(staleBefore, limit)
  for (const pending of staleRuns) {
    const trigger = await deps.triggers.find(pending.projectId, pending.triggerId)
    if (!trigger) continue
    if (pending.existingSession) {
      const auth = pendingRunAuth(pending)
      await deps.triggerDispatch.markRunDispatched(
        trigger,
        pending.run,
        pending.existingSession.id,
        pending.existingSession.metadata,
      )
      await recordHttpDispatch(deps, auth, trigger, pending.run, {
        ok: true,
        sessionId: pending.existingSession.id,
      })
      continue
    }
    await repo.requeueHttpRun(pending.run.id)
  }
}

export async function recoverSerialHttpTriggers(deps: Deps, limit = 100, now = new Date()): Promise<number> {
  const repo = serialTriggerDispatchRepo(deps)
  await recoverStaleSerialHttpRuns(deps, limit, now)
  const pending = await repo.pendingHttpTriggers(limit)
  for (const item of pending) {
    if (deps.triggerDispatchQueue?.configured()) {
      await wakeHttpTrigger(deps, item.projectId, item.triggerId)
    } else {
      await dispatchNextSerialHttpTrigger(deps, item.projectId, item.triggerId)
    }
  }
  return pending.length
}
