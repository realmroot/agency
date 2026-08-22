// Prompt dispatch — deps-first.
//
// This cluster owns delivering a user prompt to a live session: the cloud path
// (live inline turn or queued cloud turn) and the self-hosted path (live runner
// channel command or queued runner work item).
//
// Deps-first: the store, audit, runner channel, and cloud-turn queue arrive as
// ports on `deps`; the inline cloud turn and the self-hosted work enqueue /
// resume token run through sibling usecases. The module is infra-free. Logic is
// verbatim from the former server/runtime/session-prompt module; only dependency
// acquisition changed.

import type { EnvFromEntry, Volume, VolumeMount } from '@server/domain/runtime/execution-inputs'
import {
  type createEnvironmentSnapshot,
  normalizeEnvironmentSnapshot,
  parseAgentSnapshot,
  parseJson,
} from '@server/domain/runtime/session-snapshot'
import { now, requestIdFrom } from '@server/domain/runtime/util'
import { runtimeSupportsLivePrompts } from '@server/domain/runtime-catalog'
import { sessionRuntimeConfig, sessionRuntimeFromMetadata } from '@server/domain/runtime-session'
import type { safeRuntimeError } from '@server/runtime-error'
import type { AuthScope, RunnerChannel, SessionRow } from '../ports'
import type { CloudTurnDeps } from './cloud-turn'
import { executeCloudSessionTurn } from './cloud-turn'
import { latestRunnerResumeToken, queueSelfHostedSessionWorkWhenState } from './session-create'

type MessageDelivery = 'live' | 'queued'
type MessageState = 'accepted' | 'delivered' | 'failed'

// The cloud inline path delegates to the cloud-turn usecase, so prompt dispatch
// needs the full CloudTurnDeps plus the runner channel for the self-hosted path.
export type PromptDeps = CloudTurnDeps & { runnerChannel: RunnerChannel }

export type PromptDispatchOutcome =
  | { ok: false; status: 409 | 500; message: string; runtimeError?: ReturnType<typeof safeRuntimeError> }
  | { ok: true; delivery: MessageDelivery; state: MessageState }

export async function dispatchSessionPrompt(
  deps: PromptDeps,
  auth: AuthScope,
  sessionId: string,
  content: string,
  requestId?: string | null,
): Promise<PromptDispatchOutcome> {
  const store = deps.sessionOrchestration
  const session = await store.findSession(auth.project.id, sessionId)
  if (!session) {
    return { ok: false, status: 409, message: 'Session runtime is no longer active' }
  }
  if (session.state !== 'idle' && session.state !== 'running') {
    return { ok: false, status: 409, message: 'Session runtime is not active' }
  }
  if (!session.sandboxId) {
    const metadata = parseJson<Record<string, unknown>>(session.metadata) ?? {}
    const runtime = sessionRuntimeFromMetadata(metadata)
    // Running self-hosted sessions must not fall back to a second queued
    // session.start: that creates concurrent runtime processes for one session.
    if (session.state === 'running') {
      if (!runtimeSupportsLivePrompts(runtime)) {
        return { ok: false, status: 409, message: `Runtime ${runtime} does not support live prompts` }
      }
      if (!(await deps.runnerChannel.isAccepted(session.id))) {
        return { ok: false, status: 409, message: 'Session runtime is not accepting live prompts' }
      }
      const delivered = await deps.runnerChannel.dispatch(
        session.id,
        { type: 'send', message: content },
        requestIdFrom(requestId),
      )
      if (delivered) {
        await deps.audit.record(auth, {
          action: 'session.command',
          resourceType: 'session',
          resourceId: session.id,
          outcome: 'success',
          requestId: requestIdFrom(requestId),
          sessionId: session.id,
          metadata: { type: 'prompt', delivery: 'live' },
        })
        return { ok: true, delivery: 'live', state: 'delivered' }
      }
      return { ok: false, status: 409, message: 'Session runtime did not accept the live prompt' }
    }
    return await queueSelfHostedSessionPrompt(deps, auth, session, content, requestId)
  }

  const submittedAt = now()
  const started = await store.updateSessionWhenState(auth.project.id, session.id, ['idle', 'running'], {
    state: 'running',
    stateReason: null,
    updatedAt: submittedAt,
  })
  if (!started) {
    return { ok: false, status: 409, message: 'Session runtime is no longer active' }
  }

  if (!deps.cloudTurnQueue.runsInline()) {
    await deps.cloudTurnQueue.enqueue({
      type: 'session.turn',
      sessionId: session.id,
      organizationId: auth.organization.id,
      projectId: auth.project.id,
      requestId: requestIdFrom(requestId),
      prompt: content,
      auditAction: 'session.command',
    })
    return { ok: true, delivery: 'queued', state: 'accepted' }
  }

  const outcome = await executeCloudSessionTurn(deps, auth, session, { prompt: content }, 'session.command')
  if (!outcome.ok && outcome.cancelled) {
    return { ok: false, status: 409, message: 'Session runtime is no longer active' }
  }
  if (!outcome.ok) {
    return { ok: false, status: 500, message: outcome.error.message, runtimeError: outcome.error }
  }
  return { ok: true, delivery: 'live', state: 'delivered' }
}

async function queueSelfHostedSessionPrompt(
  deps: Pick<PromptDeps, 'sessionOrchestration' | 'runnerChannel'>,
  auth: AuthScope,
  session: SessionRow,
  content: string,
  requestId?: string | null,
): Promise<PromptDispatchOutcome> {
  const agentSnapshot = parseAgentSnapshot(session.agentSnapshot)
  if (!agentSnapshot) {
    return { ok: false, status: 409, message: 'Session agent snapshot is required' }
  }
  const environmentSnapshot = normalizeEnvironmentSnapshot(
    parseJson<ReturnType<typeof createEnvironmentSnapshot>>(session.environmentSnapshot),
  )
  const submittedAt = now()
  const sessionMetadata = parseJson<Record<string, unknown>>(session.metadata) ?? {}
  const resumeToken = await latestRunnerResumeToken(deps, auth, session.id)
  const queued = await queueSelfHostedSessionWorkWhenState(
    deps,
    auth,
    {
      session,
      agentSnapshot,
      environmentSnapshot,
      runtime: sessionRuntimeFromMetadata(sessionMetadata),
      runtimeConfig: sessionRuntimeConfig(sessionMetadata),
      env: parseJson<Record<string, string>>(session.env) ?? {},
      envFrom: parseJson<EnvFromEntry[]>(session.envFrom) ?? [],
      volumes: parseJson<Volume[]>(session.volumes) ?? [],
      volumeMounts: parseJson<VolumeMount[]>(session.volumeMounts) ?? [],
      prompt: content,
      resume: Boolean(resumeToken),
      resumeToken,
      requestId: requestIdFrom(requestId),
    },
    ['idle', 'running'],
    {
      state: 'pending',
      stateReason: 'waiting-for-runner',
      updatedAt: submittedAt,
    },
    submittedAt,
  )
  if (!queued) {
    return { ok: false, status: 409, message: 'Session runtime is no longer active' }
  }
  return { ok: true, delivery: 'queued', state: 'accepted' }
}
