import { hasSecretMaterial, mergeSessionUserMetadata, type Session, type SessionMessage } from '@server/domain/session'
import type { Deps } from './deps'
import {
  type AuthScope,
  type PromptDispatchResult,
  type RuntimeSessionHandle,
  type SessionRuntimeError,
  SessionValidationError,
} from './ports'
import { archiveSession, closeSession, dispatchPrompt, reopenSession, unarchiveSession } from './runtime/sessions'

export type SessionWriteOutcome<T> = { ok: true; value: T } | { ok: false; error: SessionRuntimeError }

export interface UpdateSessionPatch {
  name?: string | null
  metadata?: Record<string, unknown>
  state?: 'closed' | 'idle'
  archived?: boolean
}

// Orchestrates the session PATCH decision tree: archived sessions only accept
// an unarchive; otherwise apply name/metadata edits, then close/reopen transitions,
// then archiving — in that order, since a close+archive request must close the
// live runtime before lifecycle archiving.
export async function updateSession(
  deps: Deps,
  auth: AuthScope,
  session: RuntimeSessionHandle,
  patch: UpdateSessionPatch,
  requestId: string | null,
): Promise<SessionWriteOutcome<Session>> {
  if (session.archivedAt) {
    if (
      patch.archived === false &&
      patch.name === undefined &&
      patch.metadata === undefined &&
      patch.state === undefined
    ) {
      const restored = await unarchiveSession(deps, auth, session, requestId)
      return { ok: true, value: restored }
    }
    return { ok: false, error: { status: 409, code: 'conflict', message: 'Archived sessions cannot be updated' } }
  }

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
      throw new Error('Updated session row is required')
    }
    const reread = await deps.sessions.findRuntimeRow(auth.project.id, session.id)
    if (!reread) {
      throw new Error('Updated session row is required')
    }
    current = reread
  }

  if (patch.state === 'closed') {
    const closed = await closeSession(deps, auth, current, requestId)
    if (!closed.ok || patch.archived !== true) {
      return closed
    }
    const reread = await deps.sessions.findRuntimeRow(auth.project.id, session.id)
    if (!reread) {
      throw new Error('Closed session row is required')
    }
    current = reread
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

  if (patch.archived === true) {
    return await archiveSession(deps, auth, current, requestId)
  }

  const record = await deps.sessions.find(auth.project.id, session.id)
  if (!record) {
    throw new Error('Updated session row is required')
  }
  return { ok: true, value: record }
}

export type SendMessageOutcome =
  | { ok: true; message: SessionMessage }
  | { ok: false; status: 409 | 500; message: string; runtimeError?: Record<string, unknown> }

// Sends a prompt to a live session: the runtime prompt usecase dispatches it
// (live to a runner channel, an inline cloud turn, or the cloud/self-hosted
// queue) and a message record is persisted with the resulting delivery/state.
// An archived session cannot accept messages.
export async function sendSessionMessage(
  deps: Deps,
  auth: AuthScope,
  session: RuntimeSessionHandle,
  content: string,
): Promise<SendMessageOutcome | { ok: false; status: 409; message: string; archived: true }> {
  if (session.archivedAt) {
    return { ok: false, status: 409, message: 'Archived sessions cannot accept messages', archived: true }
  }
  const dispatch: PromptDispatchResult = await dispatchPrompt(deps, auth, session, content)
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
