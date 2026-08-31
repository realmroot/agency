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

function inboxTrigger(): Trigger {
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
      subscription: { id: 'trigger_1', phase: 'active', errorMessage: null },
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
      agentId: 'realmroot-agent_1',
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
    activation?: PendingInboxActivation
    reserve?: { sessionId: string; owned: boolean }
    existing?: RuntimeSessionHandle | null
  } = {},
) {
  const marks = { dispatched: vi.fn(), failed: vi.fn() }
  const reserve = vi.fn(async () => overrides.reserve ?? { sessionId: 'session_reserved', owned: true })
  const value = {
    inboxActivations: {
      findActivation: vi.fn(async () => overrides.activation ?? activation('route_hash')),
      reserveSessionRoute: reserve,
      deleteSessionRoute: vi.fn(),
    },
    triggers: { find: vi.fn(async () => inboxTrigger()) },
    sessions: { findRuntimeRow: vi.fn(async () => overrides.existing ?? null) },
    triggerDispatch: { markRunDispatched: marks.dispatched, markRunFailed: marks.failed },
    audit: { record: vi.fn() },
  } as unknown as Deps
  return { value, marks, reserve }
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
          remoteAgentId: 'realmroot-agent_1',
          callbackTokenHash: await inboxTokenHash(token),
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
        agentId: 'realmroot-agent_1',
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
          remoteAgentId: 'realmroot-agent_1',
          callbackTokenHash: await inboxTokenHash(token),
          subscriptionEtag: '"v1"',
        })),
        claimNotification,
      },
    } as unknown as Deps
    const notification = {
      eventId: 'event_1',
      type: 'message.created',
      subscriptionId: 'trigger_1',
      agentId: 'realmroot-agent_1',
      messageId: 'message_1',
      occurredAt: '2026-08-30T00:00:00.000Z',
    }
    await expect(receiveInboxNotification(fake, 'Bearer invalid', notification)).rejects.toMatchObject({ status: 401 })
    await expect(
      receiveInboxNotification(fake, `Bearer ${token}`, { ...notification, agentId: 'other-agent' }),
    ).rejects.toMatchObject({ status: 403 })
    expect(claimNotification).not.toHaveBeenCalled()
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
})
