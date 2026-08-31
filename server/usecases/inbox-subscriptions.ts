import type { Trigger } from '@server/domain/trigger'
import type { Deps } from './deps'
import { type InboxProvisioningFields, TriggerProvisioningError } from './ports'

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
      return repo.updateProvisioning(
        binding.projectId,
        trigger.metadata.uid,
        {
          subscriptionId,
          callbackTokenHash: binding.callbackTokenHash,
          callbackTokenCiphertext: binding.callbackTokenCiphertext,
          etag: null,
          phase: 'inactive',
          errorMessage: null,
        },
        timestamp,
      )
    } catch {
      return repo.updateProvisioning(
        binding.projectId,
        trigger.metadata.uid,
        {
          subscriptionId,
          callbackTokenHash: binding.callbackTokenHash,
          callbackTokenCiphertext: binding.callbackTokenCiphertext,
          etag: binding.subscriptionEtag,
          phase: 'error',
          errorMessage: 'Inbox Subscription deletion failed',
        },
        timestamp,
      )
    }
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
      phase: 'pending',
      errorMessage: null,
    },
    timestamp,
  )
  try {
    const result = await gateway.put({
      subscriptionId,
      agentId: binding.remoteAgentId,
      callbackToken: token,
      etag: binding.subscriptionEtag,
    })
    return repo.updateProvisioning(
      binding.projectId,
      trigger.metadata.uid,
      {
        subscriptionId,
        callbackTokenHash: binding.callbackTokenHash,
        callbackTokenCiphertext: binding.callbackTokenCiphertext,
        etag: result.etag,
        phase: 'active',
        errorMessage: null,
      },
      new Date().toISOString(),
    )
  } catch {
    return repo.updateProvisioning(
      binding.projectId,
      trigger.metadata.uid,
      {
        subscriptionId,
        callbackTokenHash: binding.callbackTokenHash,
        callbackTokenCiphertext: binding.callbackTokenCiphertext,
        etag: binding.subscriptionEtag,
        phase: 'error',
        errorMessage: 'Inbox Subscription update failed',
      },
      new Date().toISOString(),
    )
  }
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
    await repo.updateProvisioning(
      binding.projectId,
      trigger.metadata.uid,
      {
        subscriptionId,
        callbackTokenHash: binding.callbackTokenHash,
        callbackTokenCiphertext: binding.callbackTokenCiphertext,
        etag: binding.subscriptionEtag,
        phase: 'error',
        errorMessage: 'Inbox Subscription deletion failed',
      },
      new Date().toISOString(),
    )
    throw new TriggerProvisioningError('Inbox Subscription deletion failed', { cause })
  }
}

export async function reconcileInboxSubscriptions(deps: Deps, limit = 100) {
  const triggers = await activationRepo(deps).reconcilableSubscriptions(limit)
  for (const trigger of triggers) await reconcileInboxSubscription(deps, trigger)
  return triggers.length
}
