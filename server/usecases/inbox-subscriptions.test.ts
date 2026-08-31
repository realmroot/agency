import { resourceMetadata } from '@server/domain/resource'
import type { Trigger } from '@server/domain/trigger'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Deps } from './deps'
import {
  inboxTokenHash,
  initialInboxProvisioning,
  newInboxCallbackToken,
  reconcileInboxSubscription,
  reconcileInboxSubscriptions,
  removeInboxSubscription,
} from './inbox-subscriptions'
import { InboxSubscriptionGatewayError } from './ports'

function trigger(
  overrides: { inbox?: boolean; subscription?: boolean; suspend?: boolean; archived?: boolean } = {},
): Trigger {
  const timestamp = '2026-08-30T00:00:00.000Z'
  const inbox = overrides.inbox ?? true
  return {
    metadata: resourceMetadata({
      uid: 'trigger_1',
      pid: 'project_1',
      name: 'Inbox trigger',
      createdAt: timestamp,
      updatedAt: timestamp,
      archivedAt: overrides.archived ? timestamp : null,
    }),
    spec: {
      source: inbox ? { type: 'inbox' } : { type: 'http' },
      suspend: overrides.suspend ?? false,
      template: {
        metadata: { labels: {}, annotations: {} },
        spec: {
          agentId: 'agent_1',
          environmentId: null,
          runtime: 'ama',
          promptTemplate: 'Triage it.',
          env: {},
          envFrom: [],
          volumes: [],
          volumeMounts: [],
        },
      },
    },
    status: {
      phase: 'active',
      nextDueAt: null,
      lastDispatchedAt: null,
      lastRunId: null,
      subscription:
        inbox && (overrides.subscription ?? true)
          ? { id: 'sub_0123456789abcdef0123456789abcdef', phase: 'active', errorMessage: null }
          : null,
    },
  }
}

function fakeDeps(options: { putError?: Error; deleteError?: Error; binding?: boolean } = {}) {
  const record = trigger()
  const binding = {
    trigger: record,
    organizationId: 'org_1',
    projectId: 'project_1',
    projectName: 'Project',
    agentSubject: '01a05643-33a4-704f-8d6b-c30c04e18c6c',
    callbackTokenHash: 'current-hash',
    callbackTokenCiphertext: 'current-ciphertext',
    subscriptionEtag: '"v1"',
  }
  const updateProvisioning = vi.fn(async (_projectId, _triggerId, fields) => ({
    ...record,
    status: {
      ...record.status,
      subscription: { id: fields.subscriptionId, phase: fields.phase, errorMessage: fields.errorMessage },
    },
  }))
  const put = options.putError
    ? vi.fn(async () => Promise.reject(options.putError))
    : vi.fn(async () => ({ etag: '"v2"' }))
  const remove = options.deleteError
    ? vi.fn(async () => Promise.reject(options.deleteError))
    : vi.fn(async () => undefined)
  const open = vi.fn(async () => 'current-token')
  const seal = vi.fn(async () => 'sealed-token')
  const deps = {
    inboxActivations: {
      findSubscription: vi.fn(async () => (options.binding === false ? null : binding)),
      updateProvisioning,
      reconcilableSubscriptions: vi.fn(async () => [record]),
    },
    inboxSubscriptions: { put, delete: remove },
    inboxCallbackTokens: { open, seal },
  } as unknown as Deps
  return { deps, binding, updateProvisioning, put, remove, open, seal }
}

describe('[spec: triggers/inbox-provisioning] Inbox Subscription lifecycle', () => {
  afterEach(() => vi.restoreAllMocks())

  it('creates a stable Subscription id with a hashed and encrypted callback token', async () => {
    const fake = fakeDeps()
    const provisioning = await initialInboxProvisioning(fake.deps)
    expect(provisioning.fields.subscriptionId).toMatch(/^sub_[0-9a-f]{32}$/)
    expect(provisioning.token).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(provisioning.fields.callbackTokenHash).toBe(await inboxTokenHash(provisioning.token))
    expect(provisioning.fields.callbackTokenCiphertext).toBe('sealed-token')
    expect(fake.seal).toHaveBeenCalledWith(provisioning.fields.subscriptionId, provisioning.token)
    expect(newInboxCallbackToken()).toMatch(/^[A-Za-z0-9_-]{43}$/)
  })

  it('fails closed when required lifecycle dependencies or the Realmroot binding are absent', async () => {
    await expect(initialInboxProvisioning({} as Deps)).rejects.toMatchObject({ code: 'inbox_subscription_failed' })
    await expect(reconcileInboxSubscription({} as Deps, trigger())).rejects.toMatchObject({
      code: 'inbox_subscription_failed',
    })
    const onlyRepo = fakeDeps()
    delete (onlyRepo.deps as Partial<Deps>).inboxSubscriptions
    await expect(reconcileInboxSubscription(onlyRepo.deps, trigger())).rejects.toMatchObject({
      code: 'inbox_subscription_failed',
    })
    const noBinding = fakeDeps({ binding: false })
    await expect(reconcileInboxSubscription(noBinding.deps, trigger())).rejects.toThrow(/Realmroot Agent binding/)
  })

  it('leaves non-Inbox and unprovisioned triggers unchanged', async () => {
    await expect(reconcileInboxSubscription({} as Deps, trigger({ inbox: false }))).resolves.toEqual(
      trigger({ inbox: false }),
    )
    await expect(reconcileInboxSubscription({} as Deps, trigger({ subscription: false }))).resolves.toEqual(
      trigger({ subscription: false }),
    )
    await expect(removeInboxSubscription({} as Deps, trigger({ inbox: false }))).resolves.toBeUndefined()
    await expect(removeInboxSubscription({} as Deps, trigger({ subscription: false }))).resolves.toBeUndefined()
  })

  it.each([
    { suspend: true },
    { archived: true },
  ])('deletes and marks an inactive Subscription for %#', async (state) => {
    const fake = fakeDeps()
    await reconcileInboxSubscription(fake.deps, trigger(state))
    expect(fake.remove).toHaveBeenCalledWith({
      subscriptionId: 'sub_0123456789abcdef0123456789abcdef',
      etag: '"v1"',
    })
    expect(fake.updateProvisioning).toHaveBeenCalledWith(
      'project_1',
      'trigger_1',
      expect.objectContaining({
        callbackTokenHash: 'current-hash',
        callbackTokenCiphertext: 'current-ciphertext',
        etag: null,
        phase: 'inactive',
      }),
      expect.any(String),
    )
  })

  it('records a retryable error when inactive Subscription deletion fails', async () => {
    const fake = fakeDeps({ deleteError: new Error('network') })
    await reconcileInboxSubscription(fake.deps, trigger({ suspend: true }))
    expect(fake.updateProvisioning).toHaveBeenCalledWith(
      'project_1',
      'trigger_1',
      expect.objectContaining({
        etag: '"v1"',
        phase: 'error',
        errorMessage: 'Inbox Subscription deletion failed (unexpected error)',
      }),
      expect.any(String),
    )
  })

  it('reuses the encrypted callback token until a PUT is confirmed', async () => {
    const fake = fakeDeps()
    await reconcileInboxSubscription(fake.deps, trigger())
    expect(fake.open).toHaveBeenCalledWith('sub_0123456789abcdef0123456789abcdef', 'current-ciphertext')
    expect(fake.put).toHaveBeenCalledWith({
      subscriptionId: 'sub_0123456789abcdef0123456789abcdef',
      agentSubject: '01a05643-33a4-704f-8d6b-c30c04e18c6c',
      callbackToken: 'current-token',
      etag: '"v1"',
    })
    expect(fake.updateProvisioning).toHaveBeenNthCalledWith(
      1,
      'project_1',
      'trigger_1',
      expect.objectContaining({
        callbackTokenHash: 'current-hash',
        callbackTokenCiphertext: 'current-ciphertext',
        phase: 'pending',
      }),
      expect.any(String),
    )
    expect(fake.updateProvisioning).toHaveBeenLastCalledWith(
      'project_1',
      'trigger_1',
      expect.objectContaining({ etag: '"v2"', phase: 'active', errorMessage: null }),
      expect.any(String),
    )
  })

  it('uses the just-created token without decrypting it', async () => {
    const fake = fakeDeps()
    await reconcileInboxSubscription(fake.deps, trigger(), 'new-token')
    expect(fake.open).not.toHaveBeenCalled()
    expect(fake.put).toHaveBeenCalledWith(expect.objectContaining({ callbackToken: 'new-token' }))
  })

  it('keeps the same accepted token after an uncertain PUT failure', async () => {
    const fake = fakeDeps({ putError: new Error('timeout') })
    await reconcileInboxSubscription(fake.deps, trigger())
    expect(fake.updateProvisioning).toHaveBeenLastCalledWith(
      'project_1',
      'trigger_1',
      expect.objectContaining({
        callbackTokenHash: 'current-hash',
        callbackTokenCiphertext: 'current-ciphertext',
        etag: '"v1"',
        phase: 'error',
      }),
      expect.any(String),
    )
  })

  it('records safe structured diagnostics for classified gateway failures', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const fake = fakeDeps({
      putError: new InboxSubscriptionGatewayError('unavailable', 'Inbox Subscription update was rejected', {
        status: 503,
      }),
    })

    await reconcileInboxSubscription(fake.deps, trigger(), 'callback-secret')

    expect(fake.updateProvisioning).toHaveBeenLastCalledWith(
      'project_1',
      'trigger_1',
      expect.objectContaining({
        phase: 'error',
        errorMessage: 'Inbox Subscription update failed (unavailable, HTTP 503)',
      }),
      expect.any(String),
    )
    expect(consoleError).toHaveBeenCalledOnce()
    const logged = JSON.parse(String(consoleError.mock.calls[0]?.[0])) as Record<string, unknown>
    expect(logged).toMatchObject({
      event: 'inbox-subscription.gateway-failed',
      operation: 'update',
      projectId: 'project_1',
      triggerId: 'trigger_1',
      subscriptionId: 'sub_0123456789abcdef0123456789abcdef',
      gatewayErrorKind: 'unavailable',
      gatewayErrorMessage: 'Inbox Subscription update was rejected',
      gatewayErrorStatus: 503,
    })
    expect(JSON.stringify(logged)).not.toContain('callback-secret')
    expect(JSON.stringify(logged)).not.toContain('current-ciphertext')
  })

  it('removes a Subscription or persists and propagates a deletion failure', async () => {
    const success = fakeDeps()
    await expect(removeInboxSubscription(success.deps, trigger())).resolves.toBeUndefined()
    expect(success.remove).toHaveBeenCalledOnce()

    const noBinding = fakeDeps({ binding: false })
    await expect(removeInboxSubscription(noBinding.deps, trigger())).rejects.toThrow(/Realmroot Agent binding/)

    const failure = fakeDeps({ deleteError: new Error('timeout') })
    await expect(removeInboxSubscription(failure.deps, trigger())).rejects.toMatchObject({
      code: 'inbox_subscription_failed',
      cause: expect.any(Error),
    })
    expect(failure.updateProvisioning).toHaveBeenCalledWith(
      'project_1',
      'trigger_1',
      expect.objectContaining({ phase: 'error', callbackTokenCiphertext: 'current-ciphertext' }),
      expect.any(String),
    )
  })

  it('reconciles the bounded set returned by persistence', async () => {
    const fake = fakeDeps()
    await expect(reconcileInboxSubscriptions(fake.deps, 7)).resolves.toBe(1)
    expect(fake.deps.inboxActivations?.reconcilableSubscriptions).toHaveBeenCalledWith(7)
    expect(fake.put).toHaveBeenCalledOnce()
  })
})
