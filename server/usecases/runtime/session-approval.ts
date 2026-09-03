// Approval decision continuation — deps-first.
//
// This cluster owns deciding a pending tool approval: recording the policy
// decision event + audit, updating the approval grant state, executing (or
// denying) the tool, emitting the tool-result events, and resuming the cloud
// turn loop.
//
// Deps-first: state writes go through deps.sessionOrchestration, audit through
// deps.audit, tool execution through deps.sandboxExecutor.executeTool, and the
// resumed turn through the cloud-turn usecase (inline) or deps.cloudTurnQueue
// (queued). The pure approval-state read lives in domain/runtime/approval-state.
// The module is infra-free. Logic is verbatim from the former
// server/runtime/session-approval module; only dependency acquisition changed.

import { type SessionApprovalGrants, sessionApprovalState } from '@server/domain/runtime/approval-state'
import { parseAgentSnapshot, parseJson } from '@server/domain/runtime/session-snapshot'
import { newTurnId, turnLeaseExpiry } from '@server/domain/runtime/turn'
import { now, requestIdFrom, stringify } from '@server/domain/runtime/util'
import { safeRuntimeError } from '@server/runtime-error'
import { isEnborSandboxToolName } from '@shared/agent-tools'
import type { AuthScope, SessionSandboxExecutor } from '../ports'
import { writeSessionApprovalState } from './approval-gate'
import type { CloudTurnDeps } from './cloud-turn'
import { activateCloudSessionForTurn, executeCloudSessionTurn, handleTurnOutcome } from './cloud-turn'
import { appendRuntimeEvent } from './events'

type SessionRuntimeError = {
  status: 400 | 403 | 404 | 409 | 500
  code: string
  message: string
  fields?: Record<string, string>
  detail?: Record<string, unknown>
}

// The approval continuation resumes the cloud turn loop and may execute one
// approved sandbox tool before resuming.
export type ApprovalDeps = CloudTurnDeps & { sandboxExecutor: SessionSandboxExecutor }

export type ApprovalDecisionResult =
  | { ok: true; approval: ApprovalRowOutput }
  | { ok: false; error: SessionRuntimeError }

export type ApprovalRowOutput = {
  id: string
  organizationId: string
  projectId: string
  sessionId: string
  toolCallId: string
  toolName: string
  input: string
  relatedEventIds: string
  state: 'approved' | 'denied'
  reason: string | null
  result: string | null
  decidedByUserId: string
  decidedAt: string
  requestedAt: string
  createdAt: string
  updatedAt: string
}

export async function decideSessionApproval(
  deps: ApprovalDeps,
  auth: AuthScope,
  sessionId: string,
  approvalId: string,
  body: { decision: 'approve' | 'deny'; reason?: string; result?: Record<string, unknown> },
  requestId?: string | null,
): Promise<ApprovalDecisionResult> {
  const store = deps.sessionOrchestration
  const session = await store.findSession(auth.project.id, sessionId)
  if (!session) {
    return { ok: false, error: { status: 404, code: 'not_found', message: 'Session not found' } }
  }
  const { pending } = sessionApprovalState(parseJson<Record<string, unknown>>(session.metadata) ?? {})
  if (!pending) {
    const alreadyDecided = await store.findApproval(auth.project.id, session.id, approvalId)
    if (alreadyDecided) {
      return { ok: false, error: { status: 409, code: 'conflict', message: 'Approval is already decided' } }
    }
    return { ok: false, error: { status: 404, code: 'not_found', message: 'No pending approval for the session' } }
  }
  if (pending.id !== approvalId) {
    return { ok: false, error: { status: 409, code: 'conflict', message: 'Approval is no longer pending' } }
  }

  const approvalTurnId = newTurnId()
  const acquiredAt = now()
  const acquired = await store.acquireIdleTurnLease(
    auth.project.id,
    session.id,
    approvalTurnId,
    turnLeaseExpiry(acquiredAt),
    acquiredAt,
  )
  if (!acquired) {
    return { ok: false, error: { status: 409, code: 'conflict', message: 'Session is no longer awaiting approval' } }
  }

  try {
    const approved = body.decision === 'approve'
    const decisionEventId = await appendRuntimeEvent(deps, {
      auth,
      sessionId: session.id,
      event: {
        type: 'permission.resolved',
        payload: {
          permissionId: pending.id,
          allowed: approved,
          ...(body.reason ? { reason: body.reason } : {}),
          toolCall: { id: pending.toolCallId, name: pending.toolName, input: pending.input },
          details: {
            approvalId: pending.id,
            toolCallId: pending.toolCallId,
            resourceType: 'tool',
            resourceId: pending.toolName,
            operation: 'tool_approval_decision',
            ruleId: 'toolPolicy.requireApprovalTools',
            state: approved ? 'approved' : 'denied',
            ...(body.result ? { customResult: true } : {}),
          },
        },
      },
    })
    await deps.audit.record(auth, {
      action: approved ? 'session.tool_approval_approved' : 'session.tool_approval_denied',
      resourceType: 'tool',
      resourceId: pending.toolName,
      outcome: approved ? 'success' : 'denied',
      sessionId: session.id,
      policyCategory: 'approval',
      metadata: { approvalId: pending.id, toolCallId: pending.toolCallId, decisionEventId },
    })
    await writeSessionApprovalState(deps, auth, session.id, (metadata) => {
      const grants = ((metadata.approvalGrants as SessionApprovalGrants | undefined) ?? {}) as SessionApprovalGrants
      const { pendingApproval: _pendingApproval, ...rest } = metadata
      return {
        ...rest,
        approvalGrants: {
          ...grants,
          ...(approved && !body.result ? { approved: { ...grants.approved, [pending.toolCallId]: true } } : {}),
          ...(approved && body.result ? { results: { ...grants.results, [pending.toolCallId]: body.result } } : {}),
          ...(!approved
            ? { denied: { ...grants.denied, [pending.toolCallId]: body.reason ?? 'Tool call denied by the user' } }
            : {}),
        },
      }
    })
    const decidedAt = now()
    const approvalRow: ApprovalRowOutput = {
      id: pending.id,
      organizationId: session.organizationId ?? auth.organization.id,
      projectId: auth.project.id,
      sessionId: session.id,
      toolCallId: pending.toolCallId,
      toolName: pending.toolName,
      input: stringify(pending.input),
      relatedEventIds: stringify(pending.relatedEventIds),
      state: approved ? 'approved' : 'denied',
      reason: body.reason ?? null,
      result: body.result ? stringify(body.result) : null,
      decidedByUserId: auth.user.id,
      decidedAt,
      requestedAt: pending.requestedAt,
      createdAt: decidedAt,
      updatedAt: decidedAt,
    }
    await store.upsertApproval(approvalRow, decidedAt)
    let resultOutput: Record<string, unknown>
    let resultIsError = false
    if (approved && body.result) {
      resultOutput = body.result
    } else if (approved) {
      if (!isEnborSandboxToolName(pending.toolName)) {
        throw new Error(`Unsupported approved sandbox tool: ${pending.toolName}`)
      }
      const agentSnapshot = parseAgentSnapshot(session.agentSnapshot)
      if (!agentSnapshot) throw new Error('Session agent snapshot is required')
      await activateCloudSessionForTurn(deps, auth, session, agentSnapshot)
      const executed = await deps.sandboxExecutor.executeTool({
        sessionId: session.id,
        sandboxId: session.sandboxId ?? '',
        toolCallId: pending.toolCallId,
        toolName: pending.toolName,
        input: pending.input,
        cwd: '/workspace',
      })
      if (executed.error) {
        resultOutput = executed.error as Record<string, unknown>
        resultIsError = true
      } else {
        resultOutput = executed.output
      }
    } else {
      resultOutput = { denied: true, reason: body.reason ?? 'Tool call denied by the user' }
      resultIsError = true
    }
    const resultText =
      typeof resultOutput.stdout === 'string' || typeof resultOutput.stderr === 'string'
        ? [resultOutput.stdout, resultOutput.stderr]
            .filter((value): value is string => typeof value === 'string' && value.length > 0)
            .join('\n')
        : JSON.stringify(resultOutput)
    await appendRuntimeEvent(deps, {
      auth,
      sessionId: session.id,
      event: {
        type: 'message.completed',
        payload: {
          message: {
            id: crypto.randomUUID(),
            role: 'tool',
            parentToolCallId: pending.toolCallId,
            content: [
              {
                type: 'tool_result',
                toolCallId: pending.toolCallId,
                result: { content: [{ type: 'text', text: resultText }], structuredContent: resultOutput },
                ...(resultIsError
                  ? { error: { message: resultText || 'Tool execution failed', details: resultOutput } }
                  : {}),
              },
            ],
          },
        },
      },
    })
    const resumed = await store.findSession(auth.project.id, session.id)
    if (!resumed) {
      throw new Error('Session row is required after approval decision')
    }
    if (deps.cloudTurnQueue.runsInline()) {
      const outcome = await executeCloudSessionTurn(deps, auth, resumed, { continuation: true }, 'session.command')
      await handleTurnOutcome(deps, auth, resumed, approvalTurnId, 'session.command', outcome, requestId)
    } else {
      await deps.cloudTurnQueue.enqueue({
        type: 'session.step',
        sessionId: session.id,
        organizationId: auth.organization.id,
        projectId: auth.project.id,
        requestId: requestIdFrom(requestId),
        turnId: approvalTurnId,
        auditAction: 'session.command',
      })
    }
    return { ok: true, approval: approvalRow }
  } catch (error) {
    const runtime = safeRuntimeError(error)
    await store.releaseTurnLease(auth.project.id, session.id, approvalTurnId, {
      state: 'error',
      stateReason: runtime.message,
      updatedAt: now(),
    })
    throw error
  }
}
