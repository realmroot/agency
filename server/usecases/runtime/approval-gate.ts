// Session tool-approval usecases, deps-first.
//
// A sensitive tool call pauses the run: the pending approval lives on the
// session metadata, the session sits idle with a requires-action reason, and
// recorded decision grants drive the continuation turn. Both cloud turn drivers
// (the sessions command path and the runtime endpoint path) share this gate so
// approval semantics cannot drift between surfaces.
//
// Deps-first: state writes go through deps.sessionOrchestration, audit through
// deps.audit, and the approval policy decision through deps.policy. The pure
// approval-state read lives in domain/runtime/approval-state. The appendEvent
// seam stays injected by the caller (it threads the canonical event append the
// turn driver already owns). Logic is verbatim from the former
// server/runtime/tool-approvals helpers; only how the store/audit/policy are
// acquired changed.

import { type PendingSessionApproval, sessionApprovalState } from '@server/domain/runtime/approval-state'
import { now } from '@server/domain/runtime/util'
import { newPrimaryKey } from '@server/id'
import type { AmaEvent } from '@shared/session-events'
import type {
  AuditPort,
  AuthScope,
  PolicyPort,
  RuntimeToolPolicyDecision,
  RuntimeToolPolicyInput,
  SessionOrchestrationStore,
} from '../ports'

type ApprovalGateDeps = {
  sessionOrchestration: SessionOrchestrationStore
  audit: AuditPort
  policy: PolicyPort
}

export async function writeSessionApprovalState(
  deps: { sessionOrchestration: SessionOrchestrationStore },
  auth: AuthScope,
  sessionId: string,
  update: (metadata: Record<string, unknown>) => Record<string, unknown>,
) {
  const store = deps.sessionOrchestration
  const row = await store.sessionMetadata(auth.project.id, sessionId)
  const metadata = row?.metadata ? (JSON.parse(row.metadata) as Record<string, unknown>) : {}
  const next = update(metadata)
  await store.updateSession(auth.project.id, sessionId, {
    metadata: JSON.stringify(next),
    updatedAt: now(),
  })
  return next
}

export interface ToolApprovalGate {
  // Approval-aware policy decision; null means "no approval opinion, proceed".
  gate: (input: RuntimeToolPolicyInput) => Promise<RuntimeToolPolicyDecision | null>
  // Caller-provided custom tool result recorded by an approval decision.
  resolveToolResult: (input: RuntimeToolPolicyInput) => Promise<Record<string, unknown> | null>
  // Drops the synthetic failure events of a freshly-paused tool call so the
  // continuation re-drives it from clean history.
  shouldSuppressEvent: (event: Record<string, unknown>) => boolean
  // True once this turn paused for an approval.
  requiresAction: () => boolean
}

export function createToolApprovalGate(
  deps: ApprovalGateDeps,
  values: {
    auth: AuthScope
    sessionId: string
    sessionMetadata: Record<string, unknown>
    appendEvent: (event: AmaEvent) => Promise<string>
  },
): ToolApprovalGate {
  const { sessionOrchestration: store, audit, policy } = deps
  const { auth, sessionId } = values
  const { grants } = sessionApprovalState(values.sessionMetadata)
  let pendingToolCallId: string | null = null

  return {
    requiresAction: () => pendingToolCallId !== null,

    async resolveToolResult({ toolCallId }) {
      return grants.results?.[toolCallId] ?? null
    },

    shouldSuppressEvent(event) {
      if (!pendingToolCallId) {
        return false
      }
      const payload = event.payload as Record<string, unknown> | undefined
      const toolCall = payload?.toolCall as Record<string, unknown> | undefined
      const eventToolCallId = typeof toolCall?.id === 'string' ? toolCall.id : null
      return eventToolCallId === pendingToolCallId
    },

    async gate({ toolCallId, toolName, input }) {
      const denialReason = grants.denied?.[toolCallId]
      if (denialReason !== undefined) {
        return { allowed: false, reason: denialReason || 'Tool call denied by the user' }
      }
      if (grants.approved?.[toolCallId] || grants.results?.[toolCallId]) {
        return { allowed: true }
      }
      if (!(await policy.toolPolicyRequiresApproval(auth, toolName))) {
        return null
      }
      const approvalId = newPrimaryKey()
      const requestEventId = await values.appendEvent({
        type: 'permission.requested',
        payload: {
          permissionId: approvalId,
          toolCall: { id: toolCallId, name: toolName, input },
          details: {
            reason: 'approval_required',
            resourceType: 'tool',
            resourceId: toolName,
            operation: 'tool_approval_request',
            ruleId: 'toolPolicy.requireApprovalTools',
            status: 'pending',
          },
        },
      })
      await audit.record(auth, {
        action: 'session.tool_approval_requested',
        resourceType: 'tool',
        resourceId: toolName,
        outcome: 'denied',
        sessionId,
        policyCategory: 'approval',
        metadata: { approvalId, toolCallId },
      })
      await writeSessionApprovalState({ sessionOrchestration: store }, auth, sessionId, (metadata) => ({
        ...metadata,
        pendingApproval: {
          id: approvalId,
          toolCallId,
          toolName,
          input,
          requestedAt: now(),
          relatedEventIds: [requestEventId],
        } satisfies PendingSessionApproval,
      }))
      pendingToolCallId = toolCallId
      // Park the session: idle with a requires-action reason ends the turn
      // cooperatively on the next liveness check.
      await store.updateSession(auth.project.id, sessionId, {
        state: 'idle',
        stateReason: 'requires-action',
        updatedAt: now(),
      })
      return { allowed: false, reason: 'Tool call requires user approval' }
    },
  }
}
