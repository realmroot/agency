import { SELF } from 'cloudflare:test'
import { env } from 'cloudflare:workers'
import { createInboxActivationRepo } from '@server/adapters/repos/inbox-activations'
import { createTriggerRepo } from '@server/adapters/repos/triggers'
import { createDb } from '@server/db/client'
import type { Deps } from '@server/usecases/deps'
import { inboxTokenHash, newInboxCallbackToken, reconcileInboxSubscription } from '@server/usecases/inbox-subscriptions'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { defaultClaims, dpopHeaders, seedPlatformProvider, setupOidcProvider, signIn } from './auth'

async function authenticatedFetch(path: string, authorization: string, init: RequestInit = {}) {
  return SELF.fetch(`https://example.com${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...dpopHeaders(authorization, init.method ?? 'GET', path),
      ...init.headers,
    },
  })
}

async function callback(token: string, body: Record<string, unknown>) {
  return SELF.fetch('https://example.com/api/v1/inbox-notifications', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  })
}

describe('[CF] Inbox notification receipts', () => {
  beforeEach(async () => {
    await setupOidcProvider()
    await seedPlatformProvider()
  })

  it('persists one Trigger Run per source event and atomically reserves one Session route [spec: triggers/inbox-callback] [spec: triggers/inbox-routing]', async () => {
    const authorization = await signIn()
    const createAgent = await authenticatedFetch('/api/v1/agents', authorization, {
      method: 'POST',
      body: JSON.stringify({
        metadata: { name: `Inbox Agent ${crypto.randomUUID()}` },
        spec: { systemPrompt: 'Triage Inbox messages.', provider: 'workers-ai', model: '@cf/moonshotai/kimi-k2.6' },
      }),
    })
    expect(createAgent.status).toBe(201)
    const agent = (await createAgent.json()) as { metadata: { uid: string } }
    const project = await env.DB.prepare('SELECT id, name FROM projects ORDER BY created_at DESC LIMIT 1').first<{
      id: string
      name: string
    }>()
    if (!project) throw new Error('Expected signed-in project')

    const identityAgentId = '01a05643-33a4-704f-8d6b-bec364657b5c'
    const previousAgentSubject = '01a05643-33a4-704f-8d6b-bec364657b5d'
    const agentSubject = '01a05643-33a4-704f-8d6b-c30c04e18c6c'
    const identity = {
      identityId: 'identity_inbox_test',
      agentId: identityAgentId,
      issuer: 'https://id.realmroot.dev/api/auth',
      subject: agentSubject,
      username: 'inbox-agent',
      runtime: 'enbor',
      credentialRef: 'enbor-managed:vaults/test/credentials/test/versions/test',
    }
    await env.DB.prepare('UPDATE agents SET identity_snapshot = ? WHERE id = ?')
      .bind(JSON.stringify(identity), agent.metadata.uid)
      .run()

    const token = newInboxCallbackToken()
    const db = createDb(env)
    const routes = createInboxActivationRepo(db)
    const trigger = await createTriggerRepo(db).insert(
      {
        id: crypto.randomUUID(),
        organizationId: defaultClaims().organizationId,
        projectId: project.id,
        createdByUserId: defaultClaims().subject,
        config: {
          name: 'Inbox receipt test',
          source: { type: 'inbox' },
          suspend: false,
          template: {
            metadata: { labels: {}, annotations: {} },
            spec: {
              agentId: agent.metadata.uid,
              environmentId: null,
              runtime: 'enbor',
              promptTemplate: 'Triage the referenced message.',
              env: {},
              envFrom: [],
              volumes: [],
              volumeMounts: [],
            },
          },
          nextDueAt: null,
        },
        inboxProvisioning: {
          subscriptionId: 'sub_0123456789abcdef0123456789abcdef',
          callbackTokenHash: await inboxTokenHash(token),
          callbackTokenCiphertext: 'encrypted-token',
          etag: null,
          registeredAgentSubject: null,
          transitionTargetSubject: agentSubject,
          phase: 'pending',
          errorMessage: null,
        },
      },
      new Date().toISOString(),
    )
    const oldNotification = {
      eventId: 'event_before_rebind',
      type: 'message.created',
      subscriptionId: 'sub_0123456789abcdef0123456789abcdef',
      agentId: previousAgentSubject,
      messageId: 'message_before_rebind',
      occurredAt: '2026-08-30T11:59:00.000Z',
    }
    expect((await callback(token, oldNotification)).status).toBe(403)
    await env.DB.prepare('UPDATE triggers SET inbox_subscription_etag = ? WHERE id = ?')
      .bind('"subscription-v1"', trigger.metadata.uid)
      .run()
    expect(
      (
        await callback(token, {
          ...oldNotification,
          eventId: 'event_invalid_legacy_internal',
          agentId: 'identity_internal_id',
        })
      ).status,
    ).toBe(400)
    oldNotification.eventId = 'event_before_rebind_calibration'
    expect((await callback(token, oldNotification)).status).toBe(202)
    expect(
      (await callback(token, { ...oldNotification, eventId: 'event_new_during_transition', agentId: agentSubject }))
        .status,
    ).toBe(202)

    const [migratedTrigger] = await routes.reconcilableSubscriptions(10)
    expect(migratedTrigger?.metadata.uid).toBe(trigger.metadata.uid)
    const putSubscription = vi.fn(async () => {
      expect((await callback(token, { ...oldNotification, eventId: 'event_old_between_get_and_put' })).status).toBe(202)
      expect(
        (
          await callback(token, {
            ...oldNotification,
            eventId: 'event_new_between_get_and_put',
            agentId: agentSubject,
          })
        ).status,
      ).toBe(202)
      return { etag: '"subscription-v2"' }
    })
    await reconcileInboxSubscription(
      {
        inboxActivations: routes,
        inboxSubscriptions: {
          get: vi.fn(async () => ({ etag: '"subscription-v1"', agentSubject: previousAgentSubject })),
          put: putSubscription,
          delete: vi.fn(),
        },
        inboxCallbackTokens: { open: vi.fn(async () => token), seal: vi.fn() },
      } as Deps,
      migratedTrigger ?? trigger,
    )
    expect(putSubscription).toHaveBeenCalledWith(
      expect.objectContaining({
        agentSubject,
        callbackToken: token,
      }),
    )
    expect(putSubscription).not.toHaveBeenCalledWith(expect.objectContaining({ agentSubject: identityAgentId }))
    expect((await callback(token, { ...oldNotification, eventId: 'event_old_after_rebind' })).status).toBe(403)

    const notification = {
      eventId: 'event_1',
      type: 'message.created',
      subscriptionId: 'sub_0123456789abcdef0123456789abcdef',
      agentId: agentSubject,
      messageId: 'message_1',
      routingKey: 'opaque-route',
      occurredAt: '2026-08-30T12:00:00.000Z',
    }

    const first = await callback(token, notification)
    expect(first.status).toBe(202)
    const firstReceipt = (await first.json()) as { triggerRunId: string }
    const duplicate = await callback(token, notification)
    expect(duplicate.status).toBe(202)
    expect(duplicate.headers.get('idempotency-replayed')).toBe('true')
    await expect(duplicate.json()).resolves.toMatchObject({ triggerRunId: firstReceipt.triggerRunId })

    const count = await env.DB.prepare(
      'SELECT COUNT(*) AS count FROM trigger_runs WHERE source_subscription_id = ? AND source_event_id = ?',
    )
      .bind(notification.subscriptionId, notification.eventId)
      .first<{ count: number }>()
    expect(count?.count).toBe(1)

    const invalid = await callback(newInboxCallbackToken(), { ...notification, eventId: 'event_invalid' })
    expect(invalid.status).toBe(401)
    const mismatch = await callback(token, {
      ...notification,
      eventId: 'event_mismatch',
      agentId: identityAgentId,
    })
    expect(mismatch.status).toBe(403)

    const binding = await routes.findSubscription(notification.subscriptionId)
    if (!binding) throw new Error('Expected Inbox Subscription binding')
    expect(binding).toMatchObject({
      desiredAgentSubject: agentSubject,
      registeredAgentSubject: agentSubject,
      transitionTargetSubject: null,
      subscriptionPhase: 'active',
    })
    const { routingKey: _, ...storedNotification } = notification
    const secondActivation = await routes.claimNotification(
      binding,
      { ...storedNotification, eventId: 'event_route_race' },
      await inboxTokenHash('concurrent-route'),
      new Date().toISOString(),
    )
    const base = {
      organizationId: defaultClaims().organizationId,
      projectId: project.id,
      agentId: agent.metadata.uid,
      triggerId: trigger.metadata.uid,
      routingKeyHash: await inboxTokenHash('concurrent-route'),
      createdAt: new Date().toISOString(),
    }
    const [left, right] = await Promise.all([
      routes.reserveSessionRoute({ ...base, activationRunId: firstReceipt.triggerRunId, sessionId: 'session_left' }),
      routes.reserveSessionRoute({ ...base, activationRunId: secondActivation.runId, sessionId: 'session_right' }),
    ])
    expect(left.sessionId).toBe(right.sessionId)
    expect([left.owned, right.owned].filter(Boolean)).toHaveLength(1)

    const terminalSessionId = left.sessionId
    const [replacementLeft, replacementRight] = await Promise.all([
      routes.replaceSessionRoute({
        projectId: project.id,
        triggerId: trigger.metadata.uid,
        routingKeyHash: base.routingKeyHash,
        expectedSessionId: terminalSessionId,
        activationRunId: firstReceipt.triggerRunId,
        sessionId: 'session_replacement_left',
      }),
      routes.replaceSessionRoute({
        projectId: project.id,
        triggerId: trigger.metadata.uid,
        routingKeyHash: base.routingKeyHash,
        expectedSessionId: terminalSessionId,
        activationRunId: secondActivation.runId,
        sessionId: 'session_replacement_right',
      }),
    ])
    expect(replacementLeft.sessionId).toBe(replacementRight.sessionId)
    expect([replacementLeft.owned, replacementRight.owned].filter(Boolean)).toHaveLength(1)
  })
})
