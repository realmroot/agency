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
import { type InboxActivationRepo, type InboxSubscriptionBinding, InboxSubscriptionGatewayError } from './ports'

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
      deletedAt: overrides.archived ? timestamp : null,
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

function fakeDeps(
  options: {
    getError?: Error
    putError?: Error
    deleteError?: Error
    binding?: boolean
    remote?: { etag: string; agentSubject: string } | null
  } = {},
) {
  const record = trigger()
  const binding: InboxSubscriptionBinding = {
    trigger: record,
    organizationId: 'org_1',
    projectId: 'project_1',
    projectName: 'Project',
    desiredAgentSubject: '01a05643-33a4-704f-8d6b-c30c04e18c6c',
    registeredAgentSubject: '01a05643-33a4-704f-8d6b-bec364657b5c',
    transitionTargetSubject: null,
    subscriptionPhase: 'active',
    callbackTokenHash: 'current-hash',
    callbackTokenCiphertext: 'current-ciphertext',
    subscriptionEtag: '"v1"',
  }
  const updateProvisioning = vi.fn<InboxActivationRepo['updateProvisioning']>(
    async (_projectId, _triggerId, fields) => ({
      ...record,
      status: {
        ...record.status,
        subscription: { id: fields.subscriptionId, phase: fields.phase, errorMessage: fields.errorMessage },
      },
    }),
  )
  const put = options.putError
    ? vi.fn(async () => Promise.reject(options.putError))
    : vi.fn(async () => ({ etag: '"v2"' }))
  const get = options.getError
    ? vi.fn(async () => Promise.reject(options.getError))
    : vi.fn(async () =>
        options.remote === undefined
          ? { etag: '"v1"', agentSubject: '01a05643-33a4-704f-8d6b-bec364657b5c' }
          : options.remote,
      )
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
    inboxSubscriptions: { get, put, delete: remove },
    inboxCallbackTokens: { open, seal },
  } as unknown as Deps
  return { deps, binding, updateProvisioning, get, put, remove, open, seal }
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
    expect(provisioning.fields.registeredAgentSubject).toBeNull()
    expect(provisioning.fields.transitionTargetSubject).toBeNull()
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
    const fake = fakeDeps({
      deleteError: new InboxSubscriptionGatewayError('unavailable', 'arbitrary remote message', { status: 503 }),
    })
    await reconcileInboxSubscription(fake.deps, trigger({ suspend: true }))
    expect(fake.updateProvisioning).toHaveBeenCalledWith(
      'project_1',
      'trigger_1',
      expect.objectContaining({
        etag: '"v1"',
        phase: 'error',
        errorMessage: 'Inbox Subscription deletion failed (unavailable, HTTP 503)',
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

  it('creates a missing remote Subscription after GET 404 with the persisted transition target', async () => {
    const fake = fakeDeps({ remote: null })

    await reconcileInboxSubscription(fake.deps, trigger())

    expect(fake.get).toHaveBeenCalledWith({ subscriptionId: 'sub_0123456789abcdef0123456789abcdef' })
    expect(fake.updateProvisioning).toHaveBeenCalledWith(
      'project_1',
      'trigger_1',
      expect.objectContaining({
        phase: 'pending',
        registeredAgentSubject: null,
        transitionTargetSubject: '01a05643-33a4-704f-8d6b-c30c04e18c6c',
      }),
      expect.any(String),
    )
    expect(fake.put).toHaveBeenCalledWith(expect.objectContaining({ etag: null }))
    expect(fake.updateProvisioning).toHaveBeenLastCalledWith(
      'project_1',
      'trigger_1',
      expect.objectContaining({
        phase: 'active',
        registeredAgentSubject: '01a05643-33a4-704f-8d6b-c30c04e18c6c',
        transitionTargetSubject: null,
      }),
      expect.any(String),
    )
  })

  it('calibrates remote subject A before replacing it with target B', async () => {
    const fake = fakeDeps()

    await reconcileInboxSubscription(fake.deps, trigger())

    expect(fake.updateProvisioning).toHaveBeenNthCalledWith(
      2,
      'project_1',
      'trigger_1',
      expect.objectContaining({
        phase: 'pending',
        registeredAgentSubject: '01a05643-33a4-704f-8d6b-bec364657b5c',
        transitionTargetSubject: '01a05643-33a4-704f-8d6b-c30c04e18c6c',
      }),
      expect.any(String),
    )
    expect(fake.put).toHaveBeenCalledWith(
      expect.objectContaining({
        agentSubject: '01a05643-33a4-704f-8d6b-c30c04e18c6c',
        etag: '"v1"',
      }),
    )
  })

  it('confirms active locally without another PUT when GET already reports the target', async () => {
    const target = '01a05643-33a4-704f-8d6b-c30c04e18c6c'
    const fake = fakeDeps({ remote: { etag: '"v2"', agentSubject: target } })

    await reconcileInboxSubscription(fake.deps, trigger())

    expect(fake.put).not.toHaveBeenCalled()
    expect(fake.updateProvisioning).toHaveBeenLastCalledWith(
      'project_1',
      'trigger_1',
      expect.objectContaining({
        etag: '"v2"',
        phase: 'active',
        registeredAgentSubject: target,
        transitionTargetSubject: null,
      }),
      expect.any(String),
    )
  })

  it('records a safe retryable error when the remote Subscription read fails', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const fake = fakeDeps({
      getError: new InboxSubscriptionGatewayError('unavailable', 'arbitrary remote message', { status: 503 }),
    })

    await reconcileInboxSubscription(fake.deps, trigger())

    expect(fake.put).not.toHaveBeenCalled()
    expect(fake.updateProvisioning).toHaveBeenLastCalledWith(
      'project_1',
      'trigger_1',
      expect.objectContaining({
        phase: 'error',
        errorMessage: 'Inbox Subscription read failed (unavailable, HTTP 503)',
        registeredAgentSubject: '01a05643-33a4-704f-8d6b-bec364657b5c',
        transitionTargetSubject: '01a05643-33a4-704f-8d6b-c30c04e18c6c',
      }),
      expect.any(String),
    )
    expect(consoleError).toHaveBeenCalledOnce()
  })

  it('propagates an unknown remote Subscription read failure without logging or persisting error state', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const failure = new Error('unknown read failure')
    const fake = fakeDeps({ getError: failure })

    await expect(reconcileInboxSubscription(fake.deps, trigger())).rejects.toBe(failure)

    expect(fake.put).not.toHaveBeenCalled()
    expect(fake.updateProvisioning).toHaveBeenCalledTimes(1)
    expect(fake.updateProvisioning).toHaveBeenLastCalledWith(
      'project_1',
      'trigger_1',
      expect.objectContaining({ phase: 'pending', errorMessage: null }),
      expect.any(String),
    )
    expect(consoleError).not.toHaveBeenCalled()
  })

  it('keeps the same accepted token after an uncertain PUT failure', async () => {
    const fake = fakeDeps({
      putError: new InboxSubscriptionGatewayError('unavailable', 'arbitrary remote message'),
    })
    await reconcileInboxSubscription(fake.deps, trigger())
    expect(fake.updateProvisioning).toHaveBeenLastCalledWith(
      'project_1',
      'trigger_1',
      expect.objectContaining({
        callbackTokenHash: 'current-hash',
        callbackTokenCiphertext: 'current-ciphertext',
        etag: '"v1"',
        phase: 'error',
        registeredAgentSubject: '01a05643-33a4-704f-8d6b-bec364657b5c',
        transitionTargetSubject: '01a05643-33a4-704f-8d6b-c30c04e18c6c',
      }),
      expect.any(String),
    )
  })

  it('records safe structured diagnostics for classified gateway failures', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const callbackToken = 'A'.repeat(43)
    const fake = fakeDeps({
      putError: new InboxSubscriptionGatewayError(
        'unavailable',
        `nested failure ${callbackToken} Basic c2VydmljZS1jbGllbnQ6c2VydmljZS1zZWNyZXQ=`,
        {
          status: 503,
          cause: new Error(`response body contained ${callbackToken}`),
        },
      ),
    })

    await reconcileInboxSubscription(fake.deps, trigger(), callbackToken)

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
      gatewayErrorMessage: 'Inbox Subscription gateway is unavailable',
      gatewayErrorStatus: 503,
      error: { code: 'unavailable', status: 503 },
    })
    expect(JSON.stringify(logged)).not.toContain(callbackToken)
    expect(JSON.stringify(logged)).not.toContain('c2VydmljZS1jbGllbnQ6c2VydmljZS1zZWNyZXQ')
    expect(JSON.stringify(logged)).not.toContain('response body')
    expect(JSON.stringify(logged)).not.toContain('current-ciphertext')
  })

  it('propagates unknown gateway failures without logging or persisting an error phase', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const callbackToken = 'B'.repeat(43)
    const failure = new Error(`unknown failure containing ${callbackToken}`)
    const fake = fakeDeps({ putError: failure })

    await expect(reconcileInboxSubscription(fake.deps, trigger(), callbackToken)).rejects.toBe(failure)

    expect(consoleError).not.toHaveBeenCalled()
    expect(fake.updateProvisioning).toHaveBeenCalledTimes(2)
    expect(fake.updateProvisioning).toHaveBeenNthCalledWith(
      1,
      'project_1',
      'trigger_1',
      expect.objectContaining({ phase: 'pending', errorMessage: null }),
      expect.any(String),
    )
  })

  it('propagates the active-state persistence failure after a successful PUT', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const failure = new Error('D1 active-state write failed')
    const fake = fakeDeps()
    fake.updateProvisioning
      .mockResolvedValueOnce(trigger())
      .mockResolvedValueOnce(trigger())
      .mockRejectedValueOnce(failure)

    await expect(reconcileInboxSubscription(fake.deps, trigger())).rejects.toBe(failure)

    expect(fake.put).toHaveBeenCalledOnce()
    expect(fake.updateProvisioning).toHaveBeenCalledTimes(3)
    expect(fake.updateProvisioning).toHaveBeenLastCalledWith(
      'project_1',
      'trigger_1',
      expect.objectContaining({
        phase: 'active',
        registeredAgentSubject: '01a05643-33a4-704f-8d6b-c30c04e18c6c',
      }),
      expect.any(String),
    )
    expect(consoleError).not.toHaveBeenCalled()

    const pending = trigger()
    if (!pending.status.subscription) throw new Error('Expected Inbox Subscription')
    pending.status.subscription.phase = 'pending'
    fake.binding.trigger = pending
    fake.updateProvisioning.mockReset()
    fake.updateProvisioning.mockResolvedValue(trigger())
    fake.get.mockResolvedValue({
      etag: '"v2"',
      agentSubject: '01a05643-33a4-704f-8d6b-c30c04e18c6c',
    })

    await expect(reconcileInboxSubscription(fake.deps, pending)).resolves.toEqual(trigger())
    expect(fake.put).toHaveBeenCalledOnce()
    expect(fake.updateProvisioning).toHaveBeenLastCalledWith(
      'project_1',
      'trigger_1',
      expect.objectContaining({
        phase: 'active',
        registeredAgentSubject: '01a05643-33a4-704f-8d6b-c30c04e18c6c',
      }),
      expect.any(String),
    )
  })

  it('removes a Subscription or persists and propagates a deletion failure', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const success = fakeDeps()
    await expect(removeInboxSubscription(success.deps, trigger())).resolves.toBeUndefined()
    expect(success.remove).toHaveBeenCalledOnce()

    const noBinding = fakeDeps({ binding: false })
    await expect(removeInboxSubscription(noBinding.deps, trigger())).rejects.toThrow(/Realmroot Agent binding/)

    const gatewayFailure = new InboxSubscriptionGatewayError('rejected', 'arbitrary remote message', { status: 409 })
    const failure = fakeDeps({ deleteError: gatewayFailure })
    await expect(removeInboxSubscription(failure.deps, trigger())).rejects.toMatchObject({
      code: 'inbox_subscription_failed',
      message: 'Inbox Subscription deletion failed (rejected, HTTP 409)',
    })
    expect(failure.updateProvisioning).toHaveBeenCalledWith(
      'project_1',
      'trigger_1',
      expect.objectContaining({ phase: 'error', callbackTokenCiphertext: 'current-ciphertext' }),
      expect.any(String),
    )

    const unknown = new Error('unknown deletion failure')
    const unknownFailure = fakeDeps({ deleteError: unknown })
    await expect(removeInboxSubscription(unknownFailure.deps, trigger())).rejects.toBe(unknown)
    expect(unknownFailure.updateProvisioning).not.toHaveBeenCalled()
    expect(consoleError).toHaveBeenCalledOnce()
  })

  it('reconciles the bounded set returned by persistence', async () => {
    const fake = fakeDeps()
    await expect(reconcileInboxSubscriptions(fake.deps, 7)).resolves.toBe(1)
    expect(fake.deps.inboxActivations?.reconcilableSubscriptions).toHaveBeenCalledWith(7)
    expect(fake.put).toHaveBeenCalledOnce()
  })
})
