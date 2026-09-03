// The usecases/runtime barrel: deps-first runtime helpers lifted out of the
// env-bound server/runtime data plane. Grows as later steps fold more of the
// runtime orchestration into this layer.

export {
  createToolApprovalGate,
  type ToolApprovalGate,
  writeSessionApprovalState,
} from './approval-gate'
export {
  type CloudTurnDeps,
  type CloudTurnOutcome,
  consumeCloudTurnQueueMessage,
  dispatchPrompt as dispatchCloudPrompt,
  executeCloudSessionTurn,
  markCloudTurnDeadLettered,
  startSessionRuntimeForRow,
} from './cloud-turn'
export { appendRuntimeEvent, loadRuntimeMessages, markPromptFailed } from './events'
export { mcpConnectorIds, resolveMcpServers, validateRuntimeProviderModel } from './provisioning'
export {
  decideRelayPermissionRequest,
  type RunnerChannelDeps,
  type SessionCommandReply,
} from './runner-channel-ingest'
export {
  type ApprovalDecisionResult,
  type ApprovalDeps,
  type ApprovalRowOutput,
  decideSessionApproval,
} from './session-approval'
export {
  type CreateSessionDeps,
  type CreateSessionOptions,
  type CreateSessionResult,
  createSessionForAgent,
  enqueueSelfHostedSessionWork,
  latestRunnerResumeToken,
} from './session-create'
export {
  archiveSession,
  type CloseSessionResult,
  closeSession,
  markExpiredPendingSessions,
  reopenSession,
  unarchiveSession,
} from './session-lifecycle'
export {
  dispatchSessionPrompt,
  type PromptDeps,
  type PromptDispatchOutcome,
} from './session-prompt'
export {
  archiveSession as archiveRuntimeSession,
  closeSession as closeRuntimeSession,
  createSession as createRuntimeSession,
  decideApproval as decideRuntimeApproval,
  dispatchPrompt as dispatchRuntimePrompt,
  markExpiredPending as markRuntimeExpiredPending,
  reopenSession as reopenRuntimeSession,
  unarchiveSession as unarchiveRuntimeSession,
} from './sessions'
export {
  assertRuntimeSessionRunning,
  buildSessionTurnCallbacks,
  type SessionTurnCallbacks,
} from './turn-callbacks'
export { markStalledCloudSessions } from './watchdog'
