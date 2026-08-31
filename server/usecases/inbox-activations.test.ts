import { resourceMetadata } from '@server/domain/resource'
import type { Session } from '@server/domain/session'
import type { Trigger } from '@server/domain/trigger'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Deps } from './deps'
import type { PendingInboxActivation, RuntimeSessionHandle } from './ports'

vi.mock('./runtime/sessions', () => ({ createSession: vi.fn() }))
vi.mock('./dispatch-triggers', () => ({ dispatchToReusableSession: vi.fn() }))

import { dispatchToReusableSession } from './dispatch-triggers'
import { dispatchInboxActivation, receiveInboxNotification } from './inbox-activations'
import { inboxTokenHash, newInboxCallbackToken } from './inbox-subscriptions'
import { createSession } from './runtime/sessions'

function inboxTrigger(subscriptionPhase: 'pending' | 'active' | 'inactive' | 'error' = 'active'): Trigger {
  const timestamp = '2026-08-30T00:00:00.000Z'
  return {
    metadata: resourceMetadata({
      uid: 'trigger_1',
      pid: 'project_1',
      name: 'Inbox triage',
      createdAt: timestamp,
      updatedAt: timestamp,
    }),
    spec: {
      source: { type: 'inbox' },
      suspend: false,
      template: {
        metadata: { labels: {}, annotations: {} },
        spec: {
          agentId: 'agent_1',
          environmentId: 'env_1',
          runtime: 'ama',
          promptTemplate: 'Triage the referenced message.',
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
      subscription: { id: 'trigger_1', phase: subscriptionPhase, errorMessage: null },
    },
  }
}

function activation(routingKeyHash: string | null): PendingInboxActivation {
  return {
    run: {
      id: 'run_1',
      scheduledFor: '2026-08-30T00:00:00.000Z',
      correlationId: 'inbox:event_1',
      metadata: {},
    },
    triggerId: 'trigger_1',
    organizationId: 'org_1',
    projectId: 'project_1',
    projectName: 'Project',
    notification: {
      eventId: 'event_1',
      type: 'message.created',
      subscriptionId: 'trigger_1',
      agentId: '01a05643-33a4-704f-8d6b-c30c04e18c6c',
      messageId: 'message_1',
      occurredAt: '2026-08-30T00:00:00.000Z',
    },
    routingKeyHash,
  }
}

function session(id: string): Session {
  return { metadata: { uid: id } } as Session
}

function runtimeSession(id: string): RuntimeSessionHandle {
  return {
    id,
    projectId: 'project_1',
    organizationId: 'org_1',
    state: 'idle',
    archivedAt: null,
    sandboxId: 'sandbox_1',
    metadata: {},
  }
}

function deps(
  overrides: {
    activation?: PendingInboxActivation | null
    reserve?: { sessionId: string; owned: boolean }
    existing?: RuntimeSessionHandle | null
    trigger?: Trigger | null
  } = {},
) {
  const marks = { dispatched: vi.fn(), failed: vi.fn() }
  const reserve = vi.fn(async () => overrides.reserve ?? { sessionId: 'session_reserved', owned: true })
  const replace = vi.fn(async () => ({ sessionId: 'session_replacement', owned: true }))
  const value = {
    inboxActivations: {
      findActivation: vi.fn(async () =>
        overrides.activation === undefined ? activation('route_hash') : overrides.activation,
      ),
      reserveSessionRoute: reserve,
      replaceSessionRoute: replace,
      deleteSessionRoute: vi.fn(),
      pendingActivationIds: vi.fn(async () => ['run_1', 'run_2']),
    },
    triggers: { find: vi.fn(async () => (overrides.trigger === undefined ? inboxTrigger() : overrides.trigger)) },
    sessions: { findRuntimeRow: vi.fn(async () => overrides.existing ?? null) },
    triggerDispatch: { markRunDispatched: marks.dispatched, markRunFailed: marks.failed },
    audit: { record: vi.fn() },
  } as unknown as Deps
  return { value, marks, reserve, replace }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(createSession).mockResolvedValue({ ok: true, value: session('session_reserved') })
  vi.mocked(dispatchToReusableSession).mockResolvedValue({ ok: true, message: {} as never })
})

describe('[spec: triggers/inbox-callback] Inbox notification admission', () => {
  it('authenticates the per-Subscription token, hashes routing metadata, and delegates persistent deduplication', async () => {
    const token = newInboxCallbackToken()
    const claimNotification = vi.fn(async () => ({ runId: 'run_1', replayed: false }))
    const fake = {
      inboxActivations: {
        findSubscription: vi.fn(async () => ({
          trigger: inboxTrigger(),
          organizationId: 'org_1',
          projectId: 'project_1',
          projectName: 'Project',
          desiredAgentSubject: '01a05643-33a4-704f-8d6b-c30c04e18c6c',
          registeredAgentSubject: '01a05643-33a4-704f-8d6b-c30c04e18c6c',
          transitionTargetSubject: null,
          subscriptionPhase: 'active',
          callbackTokenHash: await inboxTokenHash(token),
          callbackTokenCiphertext: 'encrypted-token',
          subscriptionEtag: '"v1"',
        })),
        claimNotification,
      },
    } as unknown as Deps

    await expect(
      receiveInboxNotification(fake, `Bearer ${token}`, {
        eventId: 'event_1',
        type: 'message.created',
        subscriptionId: 'trigger_1',
        agentId: '01a05643-33a4-704f-8d6b-c30c04e18c6c',
        messageId: 'message_1',
        occurredAt: '2026-08-30T00:00:00.000Z',
        routingKey: 'opaque-thread',
      }),
    ).resolves.toEqual({ runId: 'run_1', replayed: false })
    expect(claimNotification).toHaveBeenCalledWith(
      expect.anything(),
      expect.not.objectContaining({ routingKey: expect.anything() }),
      await inboxTokenHash('opaque-thread'),
      expect.any(String),
    )
  })

  it('rejects invalid tokens and mismatched Agents before a Trigger Run is claimed', async () => {
    const token = newInboxCallbackToken()
    const claimNotification = vi.fn()
    const fake = {
      inboxActivations: {
        findSubscription: vi.fn(async () => ({
          trigger: inboxTrigger(),
          organizationId: 'org_1',
          projectId: 'project_1',
          projectName: 'Project',
          desiredAgentSubject: '01a05643-33a4-704f-8d6b-c30c04e18c6c',
          registeredAgentSubject: '01a05643-33a4-704f-8d6b-c30c04e18c6c',
          transitionTargetSubject: null,
          subscriptionPhase: 'active',
          callbackTokenHash: await inboxTokenHash(token),
          callbackTokenCiphertext: 'encrypted-token',
          subscriptionEtag: '"v1"',
        })),
        claimNotification,
      },
    } as unknown as Deps
    const notification = {
      eventId: 'event_1',
      type: 'message.created',
      subscriptionId: 'trigger_1',
      agentId: '01a05643-33a4-704f-8d6b-c30c04e18c6c',
      messageId: 'message_1',
      occurredAt: '2026-08-30T00:00:00.000Z',
    }
    await expect(receiveInboxNotification(fake, 'Bearer invalid', notification)).rejects.toMatchObject({ status: 401 })
    await expect(
      receiveInboxNotification(fake, `Bearer ${token}`, {
        ...notification,
        agentId: '01a05643-33a4-704f-8d6b-bec364657b5c',
      }),
    ).rejects.toMatchObject({ status: 403 })
    expect(claimNotification).not.toHaveBeenCalled()
  })

  it('admits both registered and desired subjects only during a provisioning transition', async () => {
    const token = newInboxCallbackToken()
    const oldSubject = '01a05643-33a4-704f-8d6b-bec364657b5c'
    const newSubject = '01a05643-33a4-704f-8d6b-c30c04e18c6c'
    const claimNotification = vi.fn(async () => ({ runId: 'run_1', replayed: false }))
    const notification = {
      eventId: 'event_1',
      type: 'message.created',
      subscriptionId: 'trigger_1',
      agentId: oldSubject,
      messageId: 'message_1',
      occurredAt: '2026-08-30T00:00:00.000Z',
    }
    const fake = (
      phase: 'pending' | 'active' | 'error',
      registeredAgentSubject: string | null,
      subscriptionEtag: string | null = '"v1"',
    ) =>
      ({
        inboxActivations: {
          findSubscription: vi.fn(async () => ({
            trigger: inboxTrigger(phase),
            organizationId: 'org_1',
            projectId: 'project_1',
            projectName: 'Project',
            desiredAgentSubject: newSubject,
            registeredAgentSubject,
            transitionTargetSubject: phase === 'active' ? null : newSubject,
            subscriptionPhase: phase,
            callbackTokenHash: await inboxTokenHash(token),
            callbackTokenCiphertext: 'encrypted-token',
            subscriptionEtag,
          })),
          claimNotification,
        },
      }) as unknown as Deps

    await expect(
      receiveInboxNotification(fake('active', oldSubject), `Bearer ${token}`, notification),
    ).resolves.toEqual({ runId: 'run_1', replayed: false })
    await expect(
      receiveInboxNotification(fake('active', oldSubject), `Bearer ${token}`, {
        ...notification,
        agentId: newSubject,
      }),
    ).rejects.toMatchObject({ status: 403 })

    await expect(
      receiveInboxNotification(fake('pending', oldSubject), `Bearer ${token}`, notification),
    ).resolves.toEqual({ runId: 'run_1', replayed: false })
    await expect(
      receiveInboxNotification(fake('pending', oldSubject), `Bearer ${token}`, {
        ...notification,
        agentId: newSubject,
      }),
    ).resolves.toEqual({ runId: 'run_1', replayed: false })

    await expect(
      receiveInboxNotification(fake('active', newSubject), `Bearer ${token}`, {
        ...notification,
        agentId: newSubject,
      }),
    ).resolves.toEqual({ runId: 'run_1', replayed: false })
    await expect(
      receiveInboxNotification(fake('active', newSubject), `Bearer ${token}`, notification),
    ).rejects.toMatchObject({ status: 403 })

    await expect(receiveInboxNotification(fake('pending', null), `Bearer ${token}`, notification)).resolves.toEqual({
      runId: 'run_1',
      replayed: false,
    })
    await expect(receiveInboxNotification(fake('error', null), `Bearer ${token}`, notification)).resolves.toEqual({
      runId: 'run_1',
      replayed: false,
    })
    await expect(
      receiveInboxNotification(fake('pending', null, null), `Bearer ${token}`, notification),
    ).rejects.toMatchObject({ status: 403 })
  })

  it('rejects an unknown Subscription and accepts notifications without a routing key', async () => {
    const token = newInboxCallbackToken()
    await expect(
      receiveInboxNotification(
        { inboxActivations: { findSubscription: vi.fn(async () => null) } } as unknown as Deps,
        `Bearer ${token}`,
        activation(null).notification,
      ),
    ).rejects.toMatchObject({ status: 401 })

    const claimNotification = vi.fn(async () => ({ runId: 'run_1', replayed: false }))
    const fake = {
      inboxActivations: {
        findSubscription: vi.fn(async () => ({
          trigger: inboxTrigger(),
          organizationId: 'org_1',
          projectId: 'project_1',
          projectName: 'Project',
          desiredAgentSubject: '01a05643-33a4-704f-8d6b-c30c04e18c6c',
          registeredAgentSubject: '01a05643-33a4-704f-8d6b-c30c04e18c6c',
          transitionTargetSubject: null,
          subscriptionPhase: 'active',
          callbackTokenHash: await inboxTokenHash(token),
          callbackTokenCiphertext: 'encrypted-token',
          subscriptionEtag: null,
        })),
        claimNotification,
      },
    } as unknown as Deps
    await receiveInboxNotification(fake, `Bearer ${token}`, activation(null).notification)
    expect(claimNotification).toHaveBeenCalledWith(expect.anything(), expect.anything(), null, expect.any(String))
  })

  it('fails closed when activation persistence is unavailable', async () => {
    await expect(
      receiveInboxNotification({} as Deps, `Bearer ${newInboxCallbackToken()}`, activation(null).notification),
    ).rejects.toThrow(/persistence is unavailable/)
  })
})

describe('[spec: triggers/inbox-routing] Inbox Activation Session routing', () => {
  it('owns the first atomic route reservation and creates the reserved Session', async () => {
    const fake = deps()
    await dispatchInboxActivation(fake.value, 'run_1')
    expect(fake.reserve).toHaveBeenCalledWith(
      expect.objectContaining({
        agentId: 'agent_1',
        triggerId: 'trigger_1',
        routingKeyHash: 'route_hash',
        activationRunId: 'run_1',
      }),
    )
    expect(createSession).toHaveBeenCalledWith(
      fake.value,
      expect.anything(),
      expect.objectContaining({ options: expect.objectContaining({ id: 'session_reserved' }) }),
    )
    expect(fake.marks.dispatched).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      'session_reserved',
      expect.anything(),
    )
  })

  it('reuses the winning Session when another Activation loses the route race', async () => {
    const existing = runtimeSession('session_winner')
    const fake = deps({ reserve: { sessionId: existing.id, owned: false }, existing })
    await dispatchInboxActivation(fake.value, 'run_2')
    expect(dispatchToReusableSession).toHaveBeenCalledWith(
      fake.value,
      expect.anything(),
      existing,
      expect.stringContaining('message_1'),
      'inbox:event_1',
    )
    expect(createSession).not.toHaveBeenCalled()
    expect(fake.marks.dispatched).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      existing.id,
      expect.anything(),
    )
  })

  it.each([
    { state: 'error' as const, archivedAt: null },
    { state: 'idle' as const, archivedAt: '2026-08-30T00:01:00.000Z' },
  ])('atomically replaces a terminal route target %#', async ({ state, archivedAt }) => {
    const existing = { ...runtimeSession('session_terminal'), state, archivedAt }
    const fake = deps({ reserve: { sessionId: existing.id, owned: false }, existing })
    vi.mocked(fake.value.sessions.findRuntimeRow).mockResolvedValueOnce(existing).mockResolvedValueOnce(null)
    vi.mocked(createSession).mockResolvedValueOnce({ ok: true, value: session('session_replacement') })

    await dispatchInboxActivation(fake.value, 'run_1')

    expect(fake.replace).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedSessionId: existing.id,
        activationRunId: 'run_1',
      }),
    )
    expect(createSession).toHaveBeenCalledWith(
      fake.value,
      expect.anything(),
      expect.objectContaining({ options: expect.objectContaining({ id: 'session_replacement' }) }),
    )
    expect(dispatchToReusableSession).not.toHaveBeenCalled()
  })

  it('follows the winning replacement when concurrent terminal deliveries race', async () => {
    const terminal = { ...runtimeSession('session_terminal'), state: 'error' as const }
    const winner = runtimeSession('session_replacement_winner')
    const fake = deps({ reserve: { sessionId: terminal.id, owned: false }, existing: terminal })
    vi.mocked(fake.value.inboxActivations!.replaceSessionRoute).mockResolvedValueOnce({
      sessionId: winner.id,
      owned: false,
    })
    vi.mocked(fake.value.sessions.findRuntimeRow).mockResolvedValueOnce(terminal).mockResolvedValueOnce(winner)

    await dispatchInboxActivation(fake.value, 'run_1')

    expect(dispatchToReusableSession).toHaveBeenCalledWith(
      fake.value,
      expect.anything(),
      winner,
      expect.any(String),
      'inbox:event_1',
    )
    expect(createSession).not.toHaveBeenCalled()
  })

  it('creates a fresh Session for every notification without a routing key', async () => {
    const fake = deps({ activation: activation(null) })
    vi.mocked(createSession).mockResolvedValue({ ok: true, value: session('session_fresh') })
    await dispatchInboxActivation(fake.value, 'run_1')
    expect(fake.reserve).not.toHaveBeenCalled()
    expect(createSession).toHaveBeenCalledWith(
      fake.value,
      expect.anything(),
      expect.objectContaining({ options: expect.not.objectContaining({ id: expect.anything() }) }),
    )
  })

  it('ignores missing, completed, and non-Inbox Activations', async () => {
    await expect(dispatchInboxActivation(deps({ activation: null }).value, 'run_missing')).resolves.toBeUndefined()
    const missingTrigger = deps({ trigger: null })
    await expect(dispatchInboxActivation(missingTrigger.value, 'run_1')).resolves.toBeUndefined()
    const http = inboxTrigger()
    http.spec.source = { type: 'http' }
    await expect(dispatchInboxActivation(deps({ trigger: http }).value, 'run_1')).resolves.toBeUndefined()
  })

  it.each([{ suspend: true }, { archived: true }])('fails inactive Trigger delivery for %#', async (state) => {
    const inactive = inboxTrigger()
    inactive.spec.suspend = state.suspend ?? false
    inactive.metadata.archivedAt = state.archived ? inactive.metadata.createdAt : null
    const fake = deps({ trigger: inactive })
    await dispatchInboxActivation(fake.value, 'run_1')
    expect(fake.marks.failed).toHaveBeenCalledWith(expect.anything(), expect.anything(), 'Inbox Trigger is inactive')
    expect(createSession).not.toHaveBeenCalled()
  })

  it('marks reusable Session delivery failures without creating another Session', async () => {
    const existing = runtimeSession('session_winner')
    const fake = deps({ reserve: { sessionId: existing.id, owned: false }, existing })
    vi.mocked(dispatchToReusableSession).mockResolvedValueOnce({ ok: false, message: 'Session is unavailable' })
    await dispatchInboxActivation(fake.value, 'run_1')
    expect(fake.marks.failed).toHaveBeenCalledWith(expect.anything(), expect.anything(), 'Session is unavailable')
    expect(createSession).not.toHaveBeenCalled()
  })

  it('leaves a losing route race claimed until the winning Session becomes visible', async () => {
    const fake = deps({ reserve: { sessionId: 'session_winner', owned: false }, existing: null })
    await expect(dispatchInboxActivation(fake.value, 'run_1')).rejects.toThrow(/not yet available/)
  })

  it('releases an owned route and fails the run when Session creation fails', async () => {
    const fake = deps()
    vi.mocked(createSession).mockResolvedValueOnce({ ok: false, error: { message: 'No runner' } } as never)
    await dispatchInboxActivation(fake.value, 'run_1')
    expect(fake.value.inboxActivations?.deleteSessionRoute).toHaveBeenCalledWith(
      'project_1',
      'trigger_1',
      'route_hash',
      'session_reserved',
    )
    expect(fake.marks.failed).toHaveBeenCalledWith(expect.anything(), expect.anything(), 'No runner')
  })

  it('fails a fresh Session without trying to release a route', async () => {
    const fake = deps({ activation: activation(null) })
    vi.mocked(createSession).mockResolvedValueOnce({ ok: false, error: { message: 'No runner' } } as never)
    await dispatchInboxActivation(fake.value, 'run_1')
    expect(fake.value.inboxActivations?.deleteSessionRoute).not.toHaveBeenCalled()
    expect(fake.marks.failed).toHaveBeenCalledOnce()
  })

  it('recovers each pending durable Activation', async () => {
    const fake = deps({ activation: null })
    const { recoverInboxActivations } = await import('./inbox-activations')
    await expect(recoverInboxActivations(fake.value, 7)).resolves.toBe(2)
    expect(fake.value.inboxActivations?.pendingActivationIds).toHaveBeenCalledWith(7)
    expect(fake.value.inboxActivations?.findActivation).toHaveBeenCalledTimes(2)
  })
})
