import type { Trigger } from '@server/domain/trigger'
import { logError } from '@server/logging'
import type { Deps } from './deps'
import { type InboxProvisioningFields, InboxSubscriptionGatewayError, TriggerProvisioningError } from './ports'

function activationRepo(deps: Deps) {
  if (!deps.inboxActivations) throw new TriggerProvisioningError('Inbox activation persistence is unavailable')
  return deps.inboxActivations
}

function subscriptionGateway(deps: Deps) {
  if (!deps.inboxSubscriptions) throw new TriggerProvisioningError('Inbox Subscription management is unavailable')
  return deps.inboxSubscriptions
}

function callbackTokens(deps: Deps) {
  if (!deps.inboxCallbackTokens) throw new TriggerProvisioningError('Inbox callback token storage is unavailable')
  return deps.inboxCallbackTokens
}

function bytesToBase64Url(bytes: Uint8Array) {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
}

export function newInboxCallbackToken() {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  return bytesToBase64Url(bytes)
}

export async function inboxTokenHash(token: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

function newInboxSubscriptionId() {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  return `sub_${[...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('')}`
}

type SubscriptionOperation = 'update' | 'deletion'

const SAFE_GATEWAY_MESSAGES: Record<InboxSubscriptionGatewayError['code'], string> = {
  unavailable: 'Inbox Subscription gateway is unavailable',
  rejected: 'Inbox Subscription gateway rejected the request',
  invalid_response: 'Inbox Subscription gateway returned an invalid response',
}

function subscriptionFailure(operation: SubscriptionOperation, error: InboxSubscriptionGatewayError) {
  const status = error.status === null ? '' : `, HTTP ${error.status}`
  return {
    errorMessage: `Inbox Subscription ${operation} failed (${error.code}${status})`,
    gatewayErrorKind: error.code,
    gatewayErrorMessage: SAFE_GATEWAY_MESSAGES[error.code],
    gatewayErrorStatus: error.status,
  }
}

function recordSubscriptionFailure(
  operation: SubscriptionOperation,
  error: InboxSubscriptionGatewayError,
  binding: { projectId: string; trigger: Trigger },
  subscriptionId: string,
) {
  const diagnostic = subscriptionFailure(operation, error)
  logError(
    'inbox-subscription.gateway-failed',
    {
      code: diagnostic.gatewayErrorKind,
      status: diagnostic.gatewayErrorStatus,
    },
    {
      operation,
      projectId: binding.projectId,
      triggerId: binding.trigger.metadata.uid,
      subscriptionId,
      gatewayErrorKind: diagnostic.gatewayErrorKind,
      gatewayErrorMessage: diagnostic.gatewayErrorMessage,
      gatewayErrorStatus: diagnostic.gatewayErrorStatus,
    },
  )
  return diagnostic.errorMessage
}

export async function initialInboxProvisioning(deps: Deps) {
  const subscriptionId = newInboxSubscriptionId()
  const token = newInboxCallbackToken()
  return {
    token,
    fields: {
      subscriptionId,
      callbackTokenHash: await inboxTokenHash(token),
      callbackTokenCiphertext: await callbackTokens(deps).seal(subscriptionId, token),
      etag: null,
      registeredAgentSubject: null,
      phase: 'pending',
      errorMessage: null,
    } satisfies InboxProvisioningFields,
  }
}

export async function reconcileInboxSubscription(
  deps: Deps,
  trigger: Trigger,
  suppliedToken?: string,
): Promise<Trigger> {
  if (trigger.spec.source.type !== 'inbox' || !trigger.status.subscription) return trigger
  const repo = activationRepo(deps)
  const gateway = subscriptionGateway(deps)
  const binding = await repo.findSubscription(trigger.status.subscription.id)
  if (!binding) {
    throw new TriggerProvisioningError('Inbox Trigger has no valid Realmroot Agent binding')
  }
  const subscriptionId = trigger.status.subscription.id
  const enabled = trigger.metadata.archivedAt === null && !trigger.spec.suspend
  const timestamp = new Date().toISOString()
  if (!enabled) {
    try {
      await gateway.delete({ subscriptionId, etag: binding.subscriptionEtag })
    } catch (cause) {
      if (!(cause instanceof InboxSubscriptionGatewayError)) throw cause
      const errorMessage = recordSubscriptionFailure('deletion', cause, binding, subscriptionId)
      return repo.updateProvisioning(
        binding.projectId,
        trigger.metadata.uid,
        {
          subscriptionId,
          callbackTokenHash: binding.callbackTokenHash,
          callbackTokenCiphertext: binding.callbackTokenCiphertext,
          etag: binding.subscriptionEtag,
          registeredAgentSubject: binding.registeredAgentSubject,
          phase: 'error',
          errorMessage,
        },
        timestamp,
      )
    }
    return repo.updateProvisioning(
      binding.projectId,
      trigger.metadata.uid,
      {
        subscriptionId,
        callbackTokenHash: binding.callbackTokenHash,
        callbackTokenCiphertext: binding.callbackTokenCiphertext,
        etag: null,
        registeredAgentSubject: null,
        phase: 'inactive',
        errorMessage: null,
      },
      timestamp,
    )
  }

  const token = suppliedToken ?? (await callbackTokens(deps).open(subscriptionId, binding.callbackTokenCiphertext))
  await repo.updateProvisioning(
    binding.projectId,
    trigger.metadata.uid,
    {
      subscriptionId,
      callbackTokenHash: binding.callbackTokenHash,
      callbackTokenCiphertext: binding.callbackTokenCiphertext,
      etag: binding.subscriptionEtag,
      registeredAgentSubject: binding.registeredAgentSubject,
      phase: 'pending',
      errorMessage: null,
    },
    timestamp,
  )
  let result: { etag: string }
  try {
    result = await gateway.put({
      subscriptionId,
      agentSubject: binding.desiredAgentSubject,
      callbackToken: token,
      etag: binding.subscriptionEtag,
    })
  } catch (cause) {
    if (!(cause instanceof InboxSubscriptionGatewayError)) throw cause
    const errorMessage = recordSubscriptionFailure('update', cause, binding, subscriptionId)
    return repo.updateProvisioning(
      binding.projectId,
      trigger.metadata.uid,
      {
        subscriptionId,
        callbackTokenHash: binding.callbackTokenHash,
        callbackTokenCiphertext: binding.callbackTokenCiphertext,
        etag: binding.subscriptionEtag,
        registeredAgentSubject: binding.registeredAgentSubject,
        phase: 'error',
        errorMessage,
      },
      new Date().toISOString(),
    )
  }
  return repo.updateProvisioning(
    binding.projectId,
    trigger.metadata.uid,
    {
      subscriptionId,
      callbackTokenHash: binding.callbackTokenHash,
      callbackTokenCiphertext: binding.callbackTokenCiphertext,
      etag: result.etag,
      registeredAgentSubject: binding.desiredAgentSubject,
      phase: 'active',
      errorMessage: null,
    },
    new Date().toISOString(),
  )
}

export async function removeInboxSubscription(deps: Deps, trigger: Trigger) {
  if (trigger.spec.source.type !== 'inbox' || !trigger.status.subscription) return
  const subscriptionId = trigger.status.subscription.id
  const repo = activationRepo(deps)
  const binding = await repo.findSubscription(subscriptionId)
  if (!binding) throw new TriggerProvisioningError('Inbox Trigger has no valid Realmroot Agent binding')
  try {
    await subscriptionGateway(deps).delete({ subscriptionId, etag: binding.subscriptionEtag })
  } catch (cause) {
    if (!(cause instanceof InboxSubscriptionGatewayError)) throw cause
    const errorMessage = recordSubscriptionFailure('deletion', cause, binding, subscriptionId)
    await repo.updateProvisioning(
      binding.projectId,
      trigger.metadata.uid,
      {
        subscriptionId,
        callbackTokenHash: binding.callbackTokenHash,
        callbackTokenCiphertext: binding.callbackTokenCiphertext,
        etag: binding.subscriptionEtag,
        registeredAgentSubject: binding.registeredAgentSubject,
        phase: 'error',
        errorMessage,
      },
      new Date().toISOString(),
    )
    throw new TriggerProvisioningError(errorMessage)
  }
}

export async function reconcileInboxSubscriptions(deps: Deps, limit = 100) {
  const triggers = await activationRepo(deps).reconcilableSubscriptions(limit)
  for (const trigger of triggers) await reconcileInboxSubscription(deps, trigger)
  return triggers.length
}
