import type { IdentityDescriptor } from '@server/domain/identity'
import { newPrimaryKey } from '@server/id'
import type { InboxActivationRepo, PendingInboxActivation } from '@server/usecases/ports'
import { and, asc, eq, isNotNull, isNull, ne, or, sql } from 'drizzle-orm'
import type { drizzle } from 'drizzle-orm/d1'
import { agents, projects, sessionRoutes, triggerRuns, triggers } from '../../db/schema'
import { createTriggerRepo } from './triggers'

type Db = ReturnType<typeof drizzle>

function parseJson<T>(value: string): T {
  return JSON.parse(value) as T
}

function uniqueConstraintError(error: unknown) {
  let current: unknown = error
  for (let depth = 0; depth < 4 && current instanceof Error; depth += 1) {
    if (current.message.toLowerCase().includes('unique constraint failed')) return true
    current = current.cause
  }
  return false
}

async function sourceIdempotencyKey(subscriptionId: string, eventId: string) {
  const encoded = new TextEncoder().encode(JSON.stringify([subscriptionId, eventId]))
  const digest = await crypto.subtle.digest('SHA-256', encoded)
  const hex = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
  return `inbox:${hex}`
}

export function createInboxActivationRepo(db: Db): InboxActivationRepo {
  const triggerRepo = createTriggerRepo(db)
  return {
    async findSubscription(subscriptionId) {
      const row = await db
        .select({
          triggerId: triggers.id,
          projectId: triggers.projectId,
          organizationId: triggers.organizationId,
          callbackTokenHash: triggers.inboxCallbackTokenHash,
          callbackTokenCiphertext: triggers.inboxCallbackTokenCiphertext,
          subscriptionEtag: triggers.inboxSubscriptionEtag,
          registeredAgentSubject: triggers.inboxRegisteredAgentSubject,
          transitionTargetSubject: triggers.inboxTransitionTargetSubject,
          subscriptionPhase: triggers.inboxProvisioningState,
          identitySnapshot: agents.identitySnapshot,
          projectName: projects.name,
        })
        .from(triggers)
        .innerJoin(agents, eq(agents.id, triggers.agentId))
        .innerJoin(projects, eq(projects.id, triggers.projectId))
        .where(and(eq(triggers.inboxSubscriptionId, subscriptionId), eq(triggers.triggerType, 'inbox')))
        .get()
      if (!row?.callbackTokenHash || !row.callbackTokenCiphertext || !row.identitySnapshot || !row.subscriptionPhase)
        return null
      const trigger = await triggerRepo.find(row.projectId, row.triggerId)
      if (!trigger) return null
      const identity = parseJson<IdentityDescriptor>(row.identitySnapshot)
      return {
        trigger,
        organizationId: row.organizationId,
        projectId: row.projectId,
        projectName: row.projectName,
        desiredAgentSubject: identity.subject,
        registeredAgentSubject: row.registeredAgentSubject,
        transitionTargetSubject: row.transitionTargetSubject,
        subscriptionPhase: row.subscriptionPhase,
        callbackTokenHash: row.callbackTokenHash,
        callbackTokenCiphertext: row.callbackTokenCiphertext,
        subscriptionEtag: row.subscriptionEtag,
      }
    },

    async updateProvisioning(projectId, triggerId, fields, updatedAt) {
      await db
        .update(triggers)
        .set({
          inboxSubscriptionId: fields.subscriptionId,
          inboxCallbackTokenHash: fields.callbackTokenHash,
          inboxCallbackTokenCiphertext: fields.callbackTokenCiphertext,
          inboxSubscriptionEtag: fields.etag,
          inboxRegisteredAgentSubject: fields.registeredAgentSubject,
          inboxTransitionTargetSubject: fields.transitionTargetSubject,
          inboxProvisioningState: fields.phase,
          inboxProvisioningError: fields.errorMessage,
          updatedAt,
        })
        .where(and(eq(triggers.projectId, projectId), eq(triggers.id, triggerId)))
      const trigger = await triggerRepo.find(projectId, triggerId)
      if (!trigger) throw new Error('Inbox trigger disappeared while updating provisioning state')
      return trigger
    },

    async claimNotification(binding, notification, routingKeyHash, timestamp) {
      const runId = newPrimaryKey()
      try {
        await db.insert(triggerRuns).values({
          id: runId,
          organizationId: binding.organizationId,
          projectId: binding.projectId,
          triggerId: binding.trigger.metadata.uid,
          scheduledFor: null,
          heartbeatAt: null,
          triggeredAt: timestamp,
          state: 'claimed',
          idempotencyKey: await sourceIdempotencyKey(notification.subscriptionId, notification.eventId),
          sessionId: null,
          correlationId: `inbox:${notification.eventId}`,
          errorMessage: null,
          sourceSubscriptionId: notification.subscriptionId,
          sourceEventId: notification.eventId,
          metadata: JSON.stringify({ ...notification, routingKeyHash }),
          createdAt: timestamp,
          updatedAt: timestamp,
        })
        return { runId, replayed: false }
      } catch (error) {
        if (!uniqueConstraintError(error)) throw error
        const existing = await db
          .select({ id: triggerRuns.id })
          .from(triggerRuns)
          .where(
            and(
              eq(triggerRuns.sourceSubscriptionId, notification.subscriptionId),
              eq(triggerRuns.sourceEventId, notification.eventId),
            ),
          )
          .get()
        if (!existing) throw error
        return { runId: existing.id, replayed: true }
      }
    },

    async findActivation(runId) {
      const row = await db
        .select({ run: triggerRuns, projectName: projects.name })
        .from(triggerRuns)
        .innerJoin(projects, eq(projects.id, triggerRuns.projectId))
        .where(and(eq(triggerRuns.id, runId), eq(triggerRuns.state, 'claimed')))
        .get()
      if (!row?.run.sourceSubscriptionId || !row.run.sourceEventId) return null
      const metadata = parseJson<Record<string, unknown>>(row.run.metadata)
      const notification = {
        eventId: row.run.sourceEventId,
        type: String(metadata.type),
        subscriptionId: row.run.sourceSubscriptionId,
        agentId: String(metadata.agentId),
        messageId: String(metadata.messageId),
        occurredAt: String(metadata.occurredAt),
      }
      return {
        run: {
          id: row.run.id,
          scheduledFor: row.run.triggeredAt,
          correlationId: row.run.correlationId,
          metadata,
        },
        triggerId: row.run.triggerId,
        organizationId: row.run.organizationId,
        projectId: row.run.projectId,
        projectName: row.projectName,
        notification,
        routingKeyHash: typeof metadata.routingKeyHash === 'string' ? metadata.routingKeyHash : null,
      } satisfies PendingInboxActivation
    },

    async pendingActivationIds(limit) {
      const rows = await db
        .select({ id: triggerRuns.id })
        .from(triggerRuns)
        .where(and(eq(triggerRuns.state, 'claimed'), isNotNull(triggerRuns.sourceSubscriptionId)))
        .orderBy(asc(triggerRuns.createdAt), asc(triggerRuns.id))
        .limit(limit)
      return rows.map((row) => row.id)
    },

    async reconcilableSubscriptions(limit) {
      const rows = await db
        .select({ id: triggers.id, projectId: triggers.projectId })
        .from(triggers)
        .innerJoin(agents, eq(agents.id, triggers.agentId))
        .where(
          and(
            eq(triggers.triggerType, 'inbox'),
            or(
              and(
                eq(triggers.enabled, true),
                isNull(triggers.archivedAt),
                or(
                  eq(triggers.inboxProvisioningState, 'pending'),
                  eq(triggers.inboxProvisioningState, 'error'),
                  and(
                    eq(triggers.inboxProvisioningState, 'active'),
                    or(
                      isNull(triggers.inboxRegisteredAgentSubject),
                      sql`${triggers.inboxRegisteredAgentSubject} != json_extract(${agents.identitySnapshot}, '$.subject')`,
                    ),
                  ),
                ),
              ),
              and(
                or(eq(triggers.enabled, false), isNotNull(triggers.archivedAt)),
                ne(triggers.inboxProvisioningState, 'inactive'),
              ),
            ),
          ),
        )
        .orderBy(asc(triggers.updatedAt), asc(triggers.id))
        .limit(limit)
      const records = await Promise.all(rows.map((row) => triggerRepo.find(row.projectId, row.id)))
      return records.filter((trigger): trigger is NonNullable<typeof trigger> => trigger !== null)
    },

    async reserveSessionRoute(input) {
      try {
        await db.insert(sessionRoutes).values({ id: newPrimaryKey(), ...input })
        return { sessionId: input.sessionId, owned: true }
      } catch (error) {
        if (!uniqueConstraintError(error)) throw error
        const existing = await db
          .select({ sessionId: sessionRoutes.sessionId, activationRunId: sessionRoutes.activationRunId })
          .from(sessionRoutes)
          .where(
            and(
              eq(sessionRoutes.agentId, input.agentId),
              eq(sessionRoutes.triggerId, input.triggerId),
              eq(sessionRoutes.routingKeyHash, input.routingKeyHash),
            ),
          )
          .get()
        if (!existing) throw error
        return { sessionId: existing.sessionId, owned: existing.activationRunId === input.activationRunId }
      }
    },

    async deleteSessionRoute(projectId, triggerId, routingKeyHash, sessionId) {
      await db
        .delete(sessionRoutes)
        .where(
          and(
            eq(sessionRoutes.projectId, projectId),
            eq(sessionRoutes.triggerId, triggerId),
            eq(sessionRoutes.routingKeyHash, routingKeyHash),
            eq(sessionRoutes.sessionId, sessionId),
          ),
        )
    },
  }
}
