// Cross-cutting session event + transcript usecases for the runtime data plane.
// Deps-first: they append Enbor protocol events and read the event stream through
// ports. No db handle, no adapters.

import { now } from '@server/domain/runtime/util'
import type { SessionRow } from '@shared/runtime-rows'
import type { EnborEvent } from '@shared/session-events'
import type { AuditPort, AuthScope, EventStore, SessionOrchestrationStore } from '../ports'
import { runtimeMessagesFromEvents } from './engine/transcript'

export async function appendEnborEvent(
  deps: { sessionEventStore: EventStore },
  values: { auth: AuthScope; sessionId: string; event: EnborEvent },
) {
  return await deps.sessionEventStore.appendEvent(
    { organizationId: values.auth.organization.id, projectId: values.auth.project.id, sessionId: values.sessionId },
    values.event,
  )
}

export async function appendRuntimeEvent(
  deps: { sessionEventStore: EventStore },
  values: { auth: AuthScope; sessionId: string; event: EnborEvent },
) {
  return appendEnborEvent(deps, {
    auth: values.auth,
    sessionId: values.sessionId,
    event: values.event,
  })
}

export async function appendUserPromptEvent(
  deps: { sessionEventStore: EventStore },
  values: { auth: AuthScope; sessionId: string; prompt: string },
) {
  return appendEnborEvent(deps, {
    auth: values.auth,
    sessionId: values.sessionId,
    event: {
      type: 'message.completed',
      payload: {
        message: {
          id: crypto.randomUUID(),
          role: 'user',
          content: [{ type: 'text', text: values.prompt }],
        },
      },
    },
  })
}

export async function markPromptFailed(
  deps: { sessionOrchestration: SessionOrchestrationStore; audit: AuditPort },
  auth: AuthScope,
  session: SessionRow,
  message: string,
  status?: number,
) {
  const failedAt = now()
  await deps.sessionOrchestration.updateSessionWhenState(auth.project.id, session.id, 'running', {
    state: 'error',
    stateReason: message,
    updatedAt: failedAt,
  })
  await deps.audit.record(auth, {
    action: 'session.prompt',
    resourceType: 'session',
    resourceId: session.id,
    outcome: 'failure',
    sessionId: session.id,
    metadata: { message, ...(status ? { status } : {}) },
  })
}

export async function loadRuntimeMessages(deps: { sessionEventStore: EventStore }, sessionId: string) {
  return runtimeMessagesFromEvents(await deps.sessionEventStore.eventStream(sessionId))
}
