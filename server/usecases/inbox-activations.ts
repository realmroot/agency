import type { ResourceMetadata } from '@server/domain/resource'
import { newPrimaryKey } from '@server/id'
import type { Deps } from './deps'
import { dispatchToReusableSession } from './dispatch-triggers'
import { inboxTokenHash } from './inbox-subscriptions'
import type { AuthScope, InboxNotification, RuntimeSessionHandle } from './ports'
import { createSession } from './runtime/sessions'

export class InboxNotificationError extends Error {
  constructor(
    readonly status: 400 | 401 | 403,
    readonly code: 'invalid_notification' | 'invalid_callback_token' | 'agent_mismatch',
    message: string,
  ) {
    super(message)
    this.name = 'InboxNotificationError'
  }
}

function activationRepo(deps: Deps) {
  if (!deps.inboxActivations) throw new Error('Inbox activation persistence is unavailable')
  return deps.inboxActivations
}

function bearerToken(authorization: string | undefined) {
  const match = authorization?.match(/^Bearer ([A-Za-z0-9_-]{43})$/)
  if (!match?.[1]) {
    throw new InboxNotificationError(401, 'invalid_callback_token', 'Inbox callback Bearer token is missing or invalid')
  }
  return match[1]
}

function constantTimeEqual(left: string, right: string) {
  const length = Math.max(left.length, right.length)
  let difference = left.length ^ right.length
  for (let index = 0; index < length; index += 1) {
    difference |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0)
  }
  return difference === 0
}

async function routingKeyHash(routingKey: string | undefined) {
  if (routingKey === undefined) return null
  return inboxTokenHash(routingKey)
}

export async function receiveInboxNotification(
  deps: Deps,
  authorization: string | undefined,
  notification: InboxNotification,
) {
  const repo = activationRepo(deps)
  const binding = await repo.findSubscription(notification.subscriptionId)
  const presentedHash = await inboxTokenHash(bearerToken(authorization))
  if (!binding || !constantTimeEqual(presentedHash, binding.callbackTokenHash)) {
    throw new InboxNotificationError(401, 'invalid_callback_token', 'Inbox callback Bearer token is invalid')
  }
  const subscriptionPhase = binding.subscriptionPhase
  const reconciling = subscriptionPhase === 'pending' || subscriptionPhase === 'error'
  const transitioning = reconciling && binding.transitionTargetSubject !== null
  const uncalibrated = reconciling && binding.registeredAgentSubject === null && binding.subscriptionEtag !== null
  const admitted =
    notification.agentId === binding.registeredAgentSubject ||
    (transitioning && notification.agentId === binding.transitionTargetSubject) ||
    uncalibrated
  if (!admitted) {
    throw new InboxNotificationError(403, 'agent_mismatch', 'Inbox notification Agent does not match the Subscription')
  }
  const { routingKey: _, ...storedNotification } = notification
  return repo.claimNotification(
    binding,
    storedNotification,
    await routingKeyHash(notification.routingKey),
    new Date().toISOString(),
  )
}

function activationAuth(activation: { organizationId: string; projectId: string; projectName: string }): AuthScope {
  return {
    organization: { id: activation.organizationId, name: activation.organizationId },
    project: { id: activation.projectId, name: activation.projectName },
    user: { id: 'system:inbox' },
    roles: ['system'],
    permissions: ['*'],
  }
}

function activationPrompt(instructions: string, notification: Omit<InboxNotification, 'routingKey'>) {
  return `${instructions.trim()}\n\nInbox notification:\n- eventId: ${notification.eventId}\n- type: ${notification.type}\n- messageId: ${notification.messageId}\n- occurredAt: ${notification.occurredAt}\n\nUse Realmroot Toolbox with your Agent identity to read the complete Inbox Message before acting.`
}

async function existingRouteSession(deps: Deps, projectId: string, sessionId: string) {
  return deps.sessions.findRuntimeRow(projectId, sessionId)
}

async function dispatchExisting(
  deps: Deps,
  auth: AuthScope,
  session: RuntimeSessionHandle,
  prompt: string,
  correlationId: string,
) {
  return dispatchToReusableSession(deps, auth, session, prompt, correlationId)
}

export async function dispatchInboxActivation(deps: Deps, runId: string): Promise<void> {
  const repo = activationRepo(deps)
  const activation = await repo.findActivation(runId)
  if (!activation) return
  const trigger = await deps.triggers.find(activation.projectId, activation.triggerId)
  if (trigger?.spec.source.type !== 'inbox') return
  const auth = activationAuth(activation)
  if (trigger.metadata.archivedAt !== null || trigger.spec.suspend) {
    await deps.triggerDispatch.markRunFailed(trigger, activation.run, 'Inbox Trigger is inactive')
    return
  }

  const prompt = activationPrompt(trigger.spec.template.spec.promptTemplate, activation.notification)
  const sessionMetadata: Pick<ResourceMetadata, 'labels' | 'annotations'> = {
    labels: trigger.spec.template.metadata.labels,
    annotations: {
      ...trigger.spec.template.metadata.annotations,
      source: 'inbox-trigger',
      inboxTriggerId: trigger.metadata.uid,
      inboxRunId: activation.run.id,
      inboxSubscriptionId: activation.notification.subscriptionId,
      inboxEventId: activation.notification.eventId,
      inboxMessageId: activation.notification.messageId,
      ...(activation.routingKeyHash ? { inboxRoutingKeyHash: activation.routingKeyHash } : {}),
      correlationId: activation.run.correlationId,
    },
  }

  let sessionId: string | null = null
  let routeOwned = false
  if (activation.routingKeyHash) {
    const reserved = await repo.reserveSessionRoute({
      organizationId: activation.organizationId,
      projectId: activation.projectId,
      agentId: trigger.spec.template.spec.agentId,
      triggerId: trigger.metadata.uid,
      routingKeyHash: activation.routingKeyHash,
      sessionId: newPrimaryKey(),
      activationRunId: activation.run.id,
      createdAt: new Date().toISOString(),
    })
    sessionId = reserved.sessionId
    routeOwned = reserved.owned
    let existing = await existingRouteSession(deps, activation.projectId, sessionId)
    if (existing && (existing.state === 'error' || existing.archivedAt !== null)) {
      const replacement = await repo.replaceSessionRoute({
        projectId: activation.projectId,
        triggerId: trigger.metadata.uid,
        routingKeyHash: activation.routingKeyHash,
        expectedSessionId: existing.id,
        sessionId: newPrimaryKey(),
        activationRunId: activation.run.id,
      })
      sessionId = replacement.sessionId
      routeOwned = replacement.owned
      existing = await existingRouteSession(deps, activation.projectId, sessionId)
    }
    if (existing) {
      const outcome = await dispatchExisting(deps, auth, existing, prompt, activation.run.correlationId)
      if (!outcome.ok) {
        await deps.triggerDispatch.markRunFailed(trigger, activation.run, outcome.message)
        return
      }
      await deps.triggerDispatch.markRunDispatched(trigger, activation.run, existing.id, sessionMetadata)
      return
    }
    if (!routeOwned) {
      throw new Error('Inbox Session route is reserved but its Session is not yet available')
    }
  }

  const result = await createSession(deps, auth, {
    agentId: trigger.spec.template.spec.agentId,
    environmentId: trigger.spec.template.spec.environmentId,
    options: {
      ...(sessionId ? { id: sessionId } : {}),
      name: trigger.metadata.name,
      metadata: sessionMetadata,
      runtime: trigger.spec.template.spec.runtime,
      prompt,
      env: trigger.spec.template.spec.env,
      envFrom: trigger.spec.template.spec.envFrom,
      volumes: trigger.spec.template.spec.volumes,
      volumeMounts: trigger.spec.template.spec.volumeMounts,
    },
    requestId: activation.run.correlationId,
  })
  if (!result.ok) {
    if (activation.routingKeyHash && sessionId && routeOwned) {
      await repo.deleteSessionRoute(activation.projectId, trigger.metadata.uid, activation.routingKeyHash, sessionId)
    }
    await deps.triggerDispatch.markRunFailed(trigger, activation.run, result.error.message)
    return
  }
  await deps.triggerDispatch.markRunDispatched(trigger, activation.run, result.value.metadata.uid, sessionMetadata)
  await deps.audit.record(auth, {
    action: 'inbox_trigger.dispatch',
    resourceType: 'trigger',
    resourceId: trigger.metadata.uid,
    outcome: 'success',
    correlationId: activation.run.correlationId,
    sessionId: result.value.metadata.uid,
    metadata: {
      runId: activation.run.id,
      eventId: activation.notification.eventId,
      messageId: activation.notification.messageId,
    },
  })
}

export async function recoverInboxActivations(deps: Deps, limit = 100) {
  const runIds = await activationRepo(deps).pendingActivationIds(limit)
  for (const runId of runIds) await dispatchInboxActivation(deps, runId)
  return runIds.length
}
