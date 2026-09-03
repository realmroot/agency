// Runner relay permission decision — deps-first. The one control-plane decision a
// per-runner relay channel needs: evaluate Enbor session policy for a runtime
// permission request and build the reply the DO relays back to the runner. Infra-
// free (deps + domain only); it never touches the WebSocket and stores nothing — a
// relay session keeps no cloud copy.

import { channelSystemAuth } from '@server/domain/runtime/system-auth'
import type { PolicyPort, SessionOrchestrationStore } from '../ports'

export type RunnerChannelDeps = {
  sessionOrchestration: SessionOrchestrationStore
  policy: PolicyPort
}

// The reply the DO relays back to the runner over the socket; the relay hub routes
// the command to the live session by sessionId.
export type SessionCommandReply = {
  type: 'session.command'
  sessionId: string
  runnerId: string
  command: Record<string, unknown>
}

// The per-runner relay scope: a runner-keyed channel carries no single session, so
// the sessionId rides per-frame.
type RelayPermissionScope = {
  organizationId: string
  projectId: string
  sessionId: string
  runnerId: string
}

// Evaluate Enbor session policy for a runtime permission request and build the reply
// the runner forwards to the live runtime. A relay session keeps no cloud copy, so
// the decision is computed from the session snapshot alone and nothing is persisted.
// Null means there was no session to decide against.
export async function decideRelayPermissionRequest(
  deps: RunnerChannelDeps,
  scope: RelayPermissionScope,
  payload: Record<string, unknown>,
): Promise<SessionCommandReply | null> {
  const store = deps.sessionOrchestration
  const session = await store.channelSession(scope.projectId, scope.sessionId)
  if (!session) {
    return null
  }
  const permissionId = typeof payload.permissionId === 'string' ? payload.permissionId : 'permission'
  const command = typeof payload.command === 'string' ? payload.command : null
  const decision = await deps.policy.evaluateSandboxRuntime(channelSystemAuth(scope), {
    session: {
      id: session.id,
      agentSnapshot: session.agentSnapshot,
      environmentSnapshot: session.environmentSnapshot,
    },
    operation: 'command',
    command,
    host: null,
  })
  return {
    type: 'session.command',
    sessionId: scope.sessionId,
    runnerId: scope.runnerId,
    command: {
      type: 'permissionDecision',
      permissionId,
      allowed: decision.allowed,
      reason: decision.message ?? '',
    },
  }
}
