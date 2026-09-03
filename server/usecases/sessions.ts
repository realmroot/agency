import { hasSecretMaterial, mergeSessionUserMetadata, type Session, type SessionMessage } from '@server/domain/session'
import type { Deps } from './deps'
import {
  type AuthScope,
  type PromptDispatchResult,
  ResourceDeletedDuringMutationError,
  type RuntimeSessionHandle,
  type SessionRuntimeError,
  SessionValidationError,
} from './ports'
import { closeSession, deleteSession, dispatchPrompt, reopenSession } from './runtime/sessions'

export type SessionWriteOutcome<T> = { ok: true; value: T } | { ok: false; error: SessionRuntimeError }

export interface UpdateSessionPatch {
  name?: string | null
  metadata?: Record<string, unknown>
  state?: 'closed' | 'idle'
}

// Orchestrates mutable fields and close/reopen transitions for a live session.
export async function updateSession(
  deps: Deps,
  auth: AuthScope,
  session: RuntimeSessionHandle,
  patch: UpdateSessionPatch,
  requestId: string | null,
): Promise<SessionWriteOutcome<Session>> {
  let current = session
  if (patch.name !== undefined || patch.metadata !== undefined) {
    if (hasSecretMaterial(patch.metadata)) {
      throw new SessionValidationError('Invalid session metadata', {
        metadata: 'Secret material must be stored in secret references.',
      })
    }
    const timestamp = new Date().toISOString()
    const metadata =
      patch.metadata !== undefined ? mergeSessionUserMetadata(current.metadata, patch.metadata) : undefined
    const updated = await deps.sessions.updateFields(
      auth.project.id,
      session.id,
      {
        ...(patch.name !== undefined && patch.name !== null ? { title: patch.name } : {}),
        ...(metadata !== undefined ? { metadata } : {}),
      },
      timestamp,
    )
    if (!updated) {
      throw new ResourceDeletedDuringMutationError('Session')
    }
    const reread = await deps.sessions.findRuntimeRow(auth.project.id, session.id)
    if (!reread) {
      throw new ResourceDeletedDuringMutationError('Session')
    }
    current = reread
  }

  if (patch.state === 'closed') {
    return closeSession(deps, auth, current, requestId)
  }

  if (patch.state === 'idle') {
    const reopened = await reopenSession(deps, auth, current, requestId)
    if (!reopened.ok) {
      return reopened
    }
    const reread = await deps.sessions.findRuntimeRow(auth.project.id, session.id)
    if (!reread) {
      throw new Error('Reopened session row is required')
    }
    current = reread
  }

  const record = await deps.sessions.find(auth.project.id, session.id)
  if (!record) {
    throw new ResourceDeletedDuringMutationError('Session')
  }
  return { ok: true, value: record }
}

export async function deleteSessionResource(
  deps: Deps,
  auth: AuthScope,
  session: RuntimeSessionHandle,
  requestId: string | null,
): Promise<SessionRuntimeError | null> {
  const outcome = await deleteSession(deps, auth, session, requestId)
  return outcome.ok ? null : outcome.error
}

export type SendMessageOutcome =
  | { ok: true; message: SessionMessage }
  | { ok: false; status: 409 | 500; message: string; runtimeError?: Record<string, unknown> }

// Sends a prompt to a live session: the runtime prompt usecase dispatches it
// (live to a runner channel, an inline cloud turn, or the cloud/self-hosted
// queue) and a message record is persisted with the resulting delivery/state.
// A deleted session cannot accept messages.
export async function sendSessionMessage(
  deps: Deps,
  auth: AuthScope,
  session: RuntimeSessionHandle,
  content: string,
  requestId?: string | null,
): Promise<SendMessageOutcome | { ok: false; status: 409; message: string; deleted: true }> {
  if (session.deletedAt) {
    return { ok: false, status: 409, message: 'Deleted sessions cannot accept messages', deleted: true }
  }
  const dispatch: PromptDispatchResult = await dispatchPrompt(deps, auth, session, content, requestId)
  if (!dispatch.ok) {
    return {
      ok: false,
      status: dispatch.status,
      message: dispatch.message,
      ...(dispatch.runtimeError ? { runtimeError: dispatch.runtimeError } : {}),
    }
  }
  const message = await deps.sessions.insertMessage({
    organizationId: auth.organization.id,
    projectId: auth.project.id,
    sessionId: session.id,
    content,
    delivery: dispatch.delivery,
    state: dispatch.state,
    createdAt: new Date().toISOString(),
  })
  return { ok: true, message }
}
