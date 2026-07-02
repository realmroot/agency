import {
  type HttpTriggerTemplateContext,
  PromptTemplateRenderError,
  renderHttpPromptTemplate,
  type Trigger,
} from '@server/domain/trigger'
import type { Deps } from './deps'
import { type AuthScope, type ClaimedRun, type DueTrigger, TriggerConflictError, TriggerValidationError } from './ports'
import { createSession } from './runtime/sessions'
import { sendSessionMessage } from './sessions'

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

function httpTriggerSessionKey(body: unknown): string | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return null
  }
  const key = (body as Record<string, unknown>).key
  return typeof key === 'string' && key.trim().length > 0 ? key : null
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

function mergeLabels(base: unknown, next: unknown): Record<string, unknown> | undefined {
  const baseLabels = recordValue(base)
  const nextLabels = recordValue(next)
  if (!baseLabels && !nextLabels) return undefined
  return { ...(baseLabels ?? {}), ...(nextLabels ?? {}) }
}

function httpTriggerBodyMetadata(body: unknown): Record<string, unknown> {
  const bodyObject = recordValue(body)
  const requestMetadata = recordValue(bodyObject?.metadata)
  if (!requestMetadata) return {}
  return requestMetadata
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

    const sessionMetadata = {
      labels: trigger.template.metadata.labels,
      annotations: {
        ...trigger.template.metadata.annotations,
        source: 'scheduled-agent-trigger',
        scheduledTriggerId: trigger.id,
        scheduledRunId: run.id,
      },
      source: 'scheduled-agent-trigger',
      scheduledTriggerId: trigger.id,
      scheduledRunId: run.id,
      scheduledFor: run.scheduledFor,
      correlationId: run.correlationId,
    }
    const result = await createSession(deps, auth, {
      agentId: trigger.template.spec.agentId,
      // Null when the trigger is unpinned; createSession resolves an environment
      // for the runtime at dispatch time.
      environmentId: trigger.template.spec.environmentId,
      options: {
        name: trigger.name,
        metadata: sessionMetadata,
        runtime: trigger.template.spec.runtime,
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

export async function dispatchHttpTrigger(
  deps: Deps,
  auth: AuthScope,
  input: HttpTriggerDispatchInput,
): Promise<{
  runId: string
  triggerId: string
  triggeredAt: string
  state: 'dispatched' | 'failed'
  sessionId: string | null
  errorMessage: string | null
}> {
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
  let renderedPrompt: string
  try {
    renderedPrompt = renderHttpPromptTemplate(trigger.spec.template.spec.promptTemplate, input.context)
  } catch (error) {
    if (error instanceof PromptTemplateRenderError) {
      throw new TriggerValidationError('Invalid trigger prompt template', { promptTemplate: error.message })
    }
    throw error
  }

  const run = await deps.triggerDispatch.claimHttpRun(auth, trigger, triggeredAt, input.idempotencyKey ?? null)
  if (!run) {
    throw new TriggerConflictError('HTTP trigger run already exists for this idempotency key')
  }

  const requestMetadata = httpTriggerBodyMetadata(input.context.body)
  const key = httpTriggerSessionKey(input.context.body)
  const requestLabels = {
    ...(recordValue(requestMetadata.labels) ?? {}),
    ...(key ? { key } : {}),
  }
  const labels = mergeLabels(trigger.spec.template.metadata.labels, requestLabels)
  const sessionMetadata = {
    labels: trigger.spec.template.metadata.labels,
    annotations: trigger.spec.template.metadata.annotations,
    ...requestMetadata,
    ...(labels ? { labels } : {}),
    source: 'http-trigger',
    httpTriggerId: trigger.metadata.uid,
    httpRunId: run.id,
    triggeredAt,
    correlationId: run.correlationId,
  }
  const existingSession = key
    ? await deps.sessions.findActiveHttpTriggerSession(auth.project.id, trigger.metadata.uid, key)
    : null

  if (existingSession) {
    const outcome =
      existingSession.state === 'pending'
        ? {
            ok: true as const,
            message: await deps.sessions.insertMessage({
              organizationId: auth.organization.id,
              projectId: auth.project.id,
              sessionId: existingSession.id,
              content: renderedPrompt,
              delivery: 'queued',
              state: 'accepted',
              createdAt: new Date().toISOString(),
            }),
          }
        : await sendSessionMessage(deps, auth, existingSession, renderedPrompt)
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
      reusedSession: true,
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
      runtime: trigger.spec.template.spec.runtime,
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

  await deps.triggerDispatch.markRunDispatched(
    trigger,
    run,
    result.value.metadata.uid,
    sessionMetadata,
  )
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
