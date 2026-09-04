// The shared turn-driver callback bundle, deps-first.
//
// Both cloud-side turn entrypoints — the CLOUD_TURNS queue path
// (executeCloudSessionTurn) and the runtime-endpoint proxy
// (recordRuntimeMessageOutcome) — drive the same Enbor turn engine over the
// SAME callback bundle: the suppress→ensureActive→append event sink, the
// approval-gate tool-result resolver, and the policy+gate approveToolCall with
// its denial recording.
//
// buildSessionTurnCallbacks is that bundle; the two callers differ only in how
// they record a policy denial (cloud inlines event+audit; the proxy uses the
// shared denyRuntimePolicy helper), so the denial recorder is injected and the
// outcome handling stays with each caller. Deps-first: liveness/events go
// through deps.sessionOrchestration, the sandbox gate through deps.policy, and
// the approval gate is built through the injected createApprovalGate seam (so
// the tool-approvals layer stays the single owner of the gate construction).

import { parseJson } from '@server/domain/runtime/session-snapshot'
import type { EnborEvent } from '@shared/session-events'
import type {
  AuthScope,
  EventStore,
  PolicyPort,
  SandboxPolicyBlock,
  SessionOrchestrationStore,
  SessionRow,
} from '../ports'
import type { ToolApprovalGate } from './approval-gate'
import { RuntimeTurnCancelledError } from './engine/errors'
import { appendRuntimeEvent } from './events'

export async function assertRuntimeSessionRunning(
  deps: { sessionOrchestration: SessionOrchestrationStore },
  projectId: string,
  sessionId: string,
) {
  const active = await deps.sessionOrchestration.sessionState(projectId, sessionId)
  if (active?.state !== 'running') {
    throw new RuntimeTurnCancelledError()
  }
}

export interface SessionTurnCallbacks {
  ensureActive: () => Promise<void>
  onEvent: (event: EnborEvent) => Promise<void>
  resolveToolResult: (input: {
    toolCallId: string
    toolName: string
    input: Record<string, unknown>
  }) => Promise<Record<string, unknown> | null>
  approveToolCall: (input: {
    toolCallId: string
    toolName: string
    input: Record<string, unknown>
  }) => Promise<{ allowed: boolean; reason?: string; requiresAction?: boolean }>
  approvalGate: ToolApprovalGate
  wasPolicyDenied: () => boolean
}

type TurnCallbacksDeps = {
  sessionOrchestration: SessionOrchestrationStore
  sessionEventStore: EventStore
  policy: PolicyPort
  // The approval gate factory. Injected so the tool-approvals layer stays the
  // single owner of gate construction (and stays mockable for the golden-master
  // turn-driver seam test).
  createApprovalGate: (values: {
    auth: AuthScope
    sessionId: string
    sessionMetadata: Record<string, unknown>
    appendEvent: (event: EnborEvent) => Promise<string>
  }) => ToolApprovalGate
}

export function buildSessionTurnCallbacks(
  deps: TurnCallbacksDeps,
  values: {
    auth: AuthScope
    session: SessionRow
    // Records a sandbox-policy denial. Injected because the cloud path inlines
    // the event+audit while the proxy path uses denyRuntimePolicy — keeping both
    // exact.
    recordPolicyDenial: (blocked: SandboxPolicyBlock) => Promise<void>
  },
): SessionTurnCallbacks {
  const { sessionOrchestration: store, sessionEventStore, policy } = deps
  const { auth, session, recordPolicyDenial } = values
  const sessionId = session.id
  const ensureActive = async () => {
    await assertRuntimeSessionRunning({ sessionOrchestration: store }, auth.project.id, sessionId)
  }
  const approvalGate = deps.createApprovalGate({
    auth,
    sessionId,
    sessionMetadata: parseJson<Record<string, unknown>>(session.metadata) ?? {},
    appendEvent: (event) => appendRuntimeEvent({ sessionEventStore }, { auth, sessionId, event }),
  })
  let policyDeniedToolCall = false
  const onEvent = async (event: EnborEvent) => {
    if (approvalGate.shouldSuppressEvent(event)) {
      return
    }
    await ensureActive()
    await appendRuntimeEvent({ sessionEventStore }, { auth, sessionId, event })
  }
  const approveToolCall = async ({
    toolCallId,
    toolName,
    input,
  }: {
    toolCallId: string
    toolName: string
    input: Record<string, unknown>
  }) => {
    await ensureActive()
    // Sandbox executor seam: command and outbound network tool calls are gated by
    // sandbox and environment network policy before execution.
    const blocked = await policy.policyBlocksSandboxOperation(auth, {
      session: {
        id: sessionId,
        agentSnapshot: session.agentSnapshot,
        environmentSnapshot: session.environmentSnapshot,
      },
      toolName,
      input,
    })
    if (blocked) {
      await ensureActive()
      await recordPolicyDenial(blocked)
      await ensureActive()
      policyDeniedToolCall = true
      return { allowed: false, reason: blocked.decision.message }
    }
    const approvalDecision = await approvalGate.gate({ toolCallId, toolName, input })
    if (approvalDecision) {
      return approvalDecision
    }
    return { allowed: true }
  }
  return {
    ensureActive,
    onEvent,
    resolveToolResult: (input) => approvalGate.resolveToolResult(input),
    approveToolCall,
    approvalGate,
    wasPolicyDenied: () => policyDeniedToolCall,
  }
}
