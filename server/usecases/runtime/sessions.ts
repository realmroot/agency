// Session runtime usecases — deps-first.
//
// These thin wrappers run a mutating runtime orchestration op (create / close /
// reopen / archive / unarchive / prompt / approval) and then re-read the affected row
// through the REST SessionRepo (deps.sessions) so the DTO crossing the boundary
// is the one canonical serialization the read endpoints produce. The callers
// (http/sessions, dispatch-triggers, usecases/sessions) invoke these directly;
// the result shapes (SessionRuntimeOutcome / PromptDispatchResult) are reused
// from ports. Logic is verbatim from the former SessionRuntimeGateway adapter;
// only how the runtime deps are acquired changed (the global Deps instead of an
// env/db-bound gateway).

import type { Session, SessionApproval } from '@server/domain/session'
import type { Deps } from '../deps'
import type {
  AuthScope,
  PromptDispatchResult,
  RuntimeSessionHandle,
  SessionCreateOptions,
  SessionRuntimeOutcome,
} from '../ports'
import { decideSessionApproval } from './session-approval'
import { createSessionForAgent } from './session-create'
import {
  archiveSession as archiveSessionRuntime,
  closeSession as closeSessionRuntime,
  markExpiredPendingSessions,
  reopenSession as reopenSessionRuntime,
  unarchiveSession as unarchiveSessionRuntime,
} from './session-lifecycle'
import { dispatchSessionPrompt } from './session-prompt'

// Re-reads the session through the repo so the DTO crossing the boundary is the
// one canonical serialization (the repo strips internal columns).
async function reread(deps: Deps, projectId: string, sessionId: string): Promise<Session> {
  const record = await deps.sessions.find(projectId, sessionId)
  if (!record) {
    throw new Error('Session row is required after a runtime operation')
  }
  return record
}

export async function createSession(
  deps: Deps,
  auth: AuthScope,
  input: {
    agentId: string
    // Null/undefined leaves the environment unpinned; createSessionForAgent
    // resolves a runner-capable one for the runtime.
    environmentId?: string | null
    options: SessionCreateOptions
    requestId: string | null
  },
): Promise<SessionRuntimeOutcome<Session>> {
  const result = await createSessionForAgent(
    deps,
    auth,
    input.agentId,
    input.environmentId ?? null,
    input.options,
    input.requestId,
  )
  if (!result.ok) {
    return result
  }
  return { ok: true, value: await reread(deps, auth.project.id, result.session.id) }
}

export async function closeSession(
  deps: Deps,
  auth: AuthScope,
  session: RuntimeSessionHandle,
  requestId: string | null,
  reason?: string,
): Promise<SessionRuntimeOutcome<Session>> {
  const result = await closeSessionRuntime(deps, auth, session.id, requestId, reason)
  if (!result.ok) {
    return result
  }
  return { ok: true, value: await reread(deps, auth.project.id, session.id) }
}

export async function reopenSession(
  deps: Deps,
  auth: AuthScope,
  session: RuntimeSessionHandle,
  requestId: string | null,
): Promise<SessionRuntimeOutcome<Session>> {
  const result = await reopenSessionRuntime(deps, auth, session.id, requestId)
  if (!result.ok) {
    return result
  }
  return { ok: true, value: await reread(deps, auth.project.id, session.id) }
}

export async function archiveSession(
  deps: Deps,
  auth: AuthScope,
  session: RuntimeSessionHandle,
  requestId: string | null,
): Promise<SessionRuntimeOutcome<Session>> {
  const result = await archiveSessionRuntime(deps, auth, session.id, requestId)
  if (!result.ok) {
    return result
  }
  return { ok: true, value: await reread(deps, auth.project.id, session.id) }
}

export async function unarchiveSession(
  deps: Deps,
  auth: AuthScope,
  session: RuntimeSessionHandle,
  requestId: string | null,
): Promise<Session> {
  await unarchiveSessionRuntime(deps, auth, session.id, requestId)
  return await reread(deps, auth.project.id, session.id)
}

export async function dispatchPrompt(
  deps: Deps,
  auth: AuthScope,
  session: RuntimeSessionHandle,
  content: string,
  requestId?: string | null,
): Promise<PromptDispatchResult> {
  const outcome = await dispatchSessionPrompt(deps, auth, session.id, content, requestId)
  if (!outcome.ok) {
    return {
      ok: false,
      status: outcome.status,
      message: outcome.message,
      ...(outcome.runtimeError ? { runtimeError: { ...outcome.runtimeError } } : {}),
    }
  }
  return { ok: true, delivery: outcome.delivery, state: outcome.state }
}

export async function decideApproval(
  deps: Deps,
  auth: AuthScope,
  session: RuntimeSessionHandle,
  approvalId: string,
  body: { decision: 'approve' | 'deny'; reason?: string; result?: Record<string, unknown> },
  requestId?: string | null,
): Promise<SessionRuntimeOutcome<SessionApproval>> {
  const result = await decideSessionApproval(deps, auth, session.id, approvalId, body, requestId)
  if (!result.ok) {
    return result
  }
  // The decided approval row carries JSON columns; surface the same record
  // shape the repo produces for read endpoints.
  const approval = await deps.sessions.findApproval(auth.project.id, session.id, approvalId)
  if (!approval) {
    throw new Error('Decided approval row is required')
  }
  return { ok: true, value: approval }
}

export async function markExpiredPending(deps: Deps, auth: AuthScope): Promise<void> {
  await markExpiredPendingSessions(deps, auth)
}
