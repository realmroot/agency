// Cloud turn execution, runtime startup, and the queue consumer — deps-first.
//
// This cluster owns the cloud-side model turn loop: launching the cloud runtime
// for a pending session row (startSessionRuntimeForRow), running a single model
// turn with the approval/policy gate (executeCloudSessionTurn), the queue
// consumer that dispatches start/step/turn messages (consumeCloudTurnQueueMessage),
// and the initial-prompt dispatch that seeds the first turn after startup
// (dispatchPrompt).
//
// VERBATIM logic: the lease CAS, the continuation-depth cap, the soft-budget
// pause, and the message-dispatch control flow are byte-for-byte the same as the
// former server/runtime/cloud-turn module. Only dependency ACQUISITION changed —
// the orchestration store, runtime lifecycle/turn executor, queue, audit,
// runtime input, and the event/turn-callbacks/provisioning helpers arrive as ports/usecases on
// `deps` instead of being built from env/db. The module is infra-free: it
// reaches for ports + domain + shared contracts + the AMA turn engine + sibling
// usecases only.

import type { RuntimeName } from '@server/contracts/environment-contracts'
import { isRuntimeName, runtimeDriver, runtimeDriverName } from '@server/domain/runtime/driver'
import type { EnvFromEntry, Volume, VolumeMount } from '@server/domain/runtime/execution-inputs'
import { resolveSessionProviderModel } from '@server/domain/runtime/provider'
import {
  type AgentSnapshot,
  agentSnapshotWithWorkspaceContext,
  type EnvironmentSnapshot,
  parseAgentSnapshot,
  parseJson,
} from '@server/domain/runtime/session-snapshot'
import { cloudTurnSystemAuth } from '@server/domain/runtime/system-auth'
import {
  CONTINUATION_LIMIT_REASON,
  MAX_CONTINUATION_DEPTH,
  newTurnId,
  TURN_LEASE_RETRY_DELAY_SECONDS,
  turnLeaseExpiry,
} from '@server/domain/runtime/turn'
import { now, RUNTIME_START_TIMEOUT_MS, stringify, withTimeout } from '@server/domain/runtime/util'
import { safeRuntimeError } from '@server/runtime-error'
import { type AmaEvent, SESSION_DO_EVENT_STORE } from '@shared/session-events'
import type {
  AmaTurnExecutor,
  AuditPort,
  AuthScope,
  CloudRuntimeLifecycle,
  CloudTurnQueue,
  CloudTurnQueueMessage,
  EventStore,
  PolicyPort,
  ProviderRepo,
  RuntimeSecretGateway,
  SessionOrchestrationStore,
  SessionRow,
} from '../ports'
import type { ToolApprovalGate } from './approval-gate'
import { isRuntimePolicyDenied, isRuntimeTurnCancelled } from './engine/errors'
import { appendRuntimeEvent, appendUserPromptEvent, loadRuntimeMessages, markPromptFailed } from './events'
import { mcpConnectorIds, resolveMcpServers } from './provisioning'
import { buildSessionTurnCallbacks, type SessionTurnCallbacks } from './turn-callbacks'

// Per-invocation soft budget for new model turns (see executeCloudSessionTurn).
const CLOUD_TURN_SOFT_BUDGET_MS = 4 * 60_000

// The approval gate factory threaded into buildSessionTurnCallbacks.
type CreateApprovalGate = (values: {
  auth: AuthScope
  sessionId: string
  sessionMetadata: Record<string, unknown>
  appendEvent: (event: AmaEvent) => Promise<string>
}) => ToolApprovalGate

export type CloudTurnDeps = {
  sessionOrchestration: SessionOrchestrationStore
  sessionEventStore: EventStore
  policy: PolicyPort
  providers: ProviderRepo
  audit: AuditPort
  cloudRuntime: CloudRuntimeLifecycle
  amaTurnExecutor: AmaTurnExecutor
  cloudTurnQueue: CloudTurnQueue
  runtimeSecrets: RuntimeSecretGateway
  createApprovalGate: CreateApprovalGate
}

export async function startSessionRuntimeForRow(
  deps: CloudTurnDeps,
  auth: AuthScope,
  input: {
    pending: SessionRow
    agentSnapshot: AgentSnapshot
    environmentSnapshot: EnvironmentSnapshot | null
    runtime: RuntimeName
    runtimeConfig: Record<string, unknown>
    env?: Record<string, string>
    envFrom?: EnvFromEntry[]
    volumes?: Volume[]
    volumeMounts?: VolumeMount[]
    prompt?: string
  },
) {
  const store = deps.sessionOrchestration
  const { pending, agentSnapshot, environmentSnapshot, runtime, runtimeConfig, prompt } = input
  const sessionEnv = input.env
  const sessionEnvFrom = input.envFrom ?? []
  const sessionVolumes = input.volumes ?? []
  const sessionVolumeMounts = input.volumeMounts ?? []
  const runtimeAgentSnapshot = agentSnapshotWithWorkspaceContext(agentSnapshot, sessionVolumes, sessionVolumeMounts)
  const sessionId = pending.id
  const sandboxId = pending.sandboxId ?? sessionId.toLowerCase()
  const runtimeName = runtime
  const driver = runtimeDriver(runtimeName)
  if (!driver.supportsCloudStartup) {
    throw new Error(`Runtime ${runtimeName} does not support cloud session startup`)
  }
  try {
    const mcpServers = await resolveMcpServers(deps, auth, sessionId, agentSnapshot, environmentSnapshot)
    const environmentSnapshotWithRuntimeConfig = environmentSnapshot ? { ...environmentSnapshot, runtimeConfig } : null
    const resolvedEnv = await deps.runtimeSecrets.resolveEnv(
      { organizationId: auth.organization.id, projectId: auth.project.id },
      sessionEnvFrom,
    )
    const workspaceManifest = await deps.runtimeSecrets.resolveWorkspaceManifest(
      { organizationId: auth.organization.id, projectId: auth.project.id },
      sessionVolumes,
      sessionVolumeMounts,
    )
    const env = { ...(sessionEnv ?? {}), ...resolvedEnv }
    const startedRuntime = await withTimeout(
      deps.cloudRuntime.startCloudSession({
        sessionId,
        sandboxId,
        runtime: runtimeName,
        provider: agentSnapshot.provider,
        model: agentSnapshot.model,
        agentSnapshot: runtimeAgentSnapshot,
        environmentSnapshot: environmentSnapshotWithRuntimeConfig,
        mcpServers,
        volumes: sessionVolumes,
        volumeMounts: sessionVolumeMounts,
        workspaceManifest,
        env,
      }),
      RUNTIME_START_TIMEOUT_MS,
      'Session runtime startup timed out',
    )
    const current = await store.findSession(auth.project.id, sessionId)
    if (current?.state !== 'pending') {
      if (current?.state !== 'idle') {
        await deps.cloudRuntime.stopCloudSession(sandboxId).catch(() => undefined)
      }
      return
    }
    const startedAt = now()
    const existingMetadata = parseJson<Record<string, unknown>>(pending.metadata) ?? {}
    const metadata = {
      ...existingMetadata,
      ...startedRuntime.metadata,
      runtimeDriver: runtimeDriverName(runtimeName, 'cloud'),
      runtimeBackend: driver.cloudBackend,
      runtimeProtocol: driver.cloudProtocol,
      mcpConnectors: mcpConnectorIds(mcpServers),
      // "Storage follows the loop": the cloud ama loop owns this session's events,
      // so route its firehose to the Session DO (the event-store router reads
      // this stamp). Self-hosted CLI sessions never reach this path.
      eventStore: SESSION_DO_EVENT_STORE,
    }
    const started = {
      sandboxId,
      resumeToken: null,
      runtimeEndpointPath: null,
      state: 'idle',
      metadata: stringify(metadata),
      startedAt,
      closedAt: null,
      updatedAt: startedAt,
    }
    const recorded = await store.updateSessionWhenState(auth.project.id, sessionId, 'pending', started)
    if (!recorded) {
      // The row left 'pending' between the re-read and this CAS (concurrent stop
      // or a duplicate session.start). The just-provisioned sandbox is recorded
      // on no row, so tear it down here — let a teardown error reach the catch.
      await deps.cloudRuntime.stopCloudSession(sandboxId)
      return
    }
    await deps.audit.record(auth, {
      action: 'session.runtime.start',
      resourceType: 'session',
      resourceId: sessionId,
      outcome: 'success',
      sessionId,
      metadata: { sandboxId: startedRuntime.sandboxId },
    })
    if (prompt) {
      await dispatchPrompt(
        deps,
        auth,
        { ...pending, ...started, stateReason: null, closedAt: null, archivedAt: null },
        prompt,
      )
    }
  } catch (error) {
    const safeError = safeRuntimeError(error)
    const failedAt = now()
    const failed = {
      state: 'error',
      stateReason: safeError.message,
      metadata: stringify({
        ...(parseJson<Record<string, unknown>>(pending.metadata) ?? {}),
        runtimeDriver: runtimeDriverName(runtimeName, 'cloud'),
        runtimeBackend: driver.cloudBackend,
        error: safeError,
      }),
      updatedAt: failedAt,
    }
    await store.updateSessionWhenState(auth.project.id, sessionId, 'pending', failed)
    await deps.audit.record(auth, {
      action: 'session.runtime.start',
      resourceType: 'session',
      resourceId: sessionId,
      outcome: 'failure',
      sessionId,
      metadata: { ...safeError },
    })
    await deps.cloudRuntime.stopCloudSession(sandboxId).catch(() => undefined)
  }
}

// ── Cloud turn execution + queue consumer ───────────────────────────────────

export type CloudTurnOutcome =
  | { ok: true; requiresAction?: boolean; paused?: boolean }
  | { ok: false; cancelled: true }
  | { ok: false; cancelled: false; error: ReturnType<typeof safeRuntimeError> }

export async function executeCloudSessionTurn(
  deps: CloudTurnDeps,
  auth: AuthScope,
  session: SessionRow,
  work: { prompt?: string; continuation?: boolean },
  auditAction: 'session.prompt' | 'session.command',
): Promise<CloudTurnOutcome> {
  const store = deps.sessionOrchestration
  let callbacks: SessionTurnCallbacks | null = null
  try {
    const agentSnapshot = parseAgentSnapshot(session.agentSnapshot)
    if (!agentSnapshot) {
      throw new Error('Session agent snapshot is required')
    }
    const volumes = parseJson<Volume[]>(session.volumes) ?? []
    const volumeMounts = parseJson<VolumeMount[]>(session.volumeMounts) ?? []
    const runtimeAgentSnapshot = agentSnapshotWithWorkspaceContext(agentSnapshot, volumes, volumeMounts)
    const modelConfig = parseJson<Record<string, unknown>>(session.modelConfig) ?? {}
    const messages = await loadRuntimeMessages(deps, session.id)
    const { provider: turnProvider, model: turnModel } = resolveSessionProviderModel(
      session,
      agentSnapshot,
      modelConfig,
    )
    if (work.prompt !== undefined) {
      await appendUserPromptEvent(deps, {
        auth,
        sessionId: session.id,
        prompt: work.prompt,
      })
    }
    callbacks = buildSessionTurnCallbacks(deps, {
      auth,
      session,
      recordPolicyDenial: async (blocked) => {
        const operationFields =
          blocked.operation.operation === 'command'
            ? { command: blocked.operation.command }
            : { host: blocked.operation.host }
        await appendRuntimeEvent(deps, {
          auth,
          sessionId: session.id,
          event: {
            type: 'permission.denied',
            payload: {
              reason: blocked.decision.category,
              resourceType: blocked.operation.resourceType,
              resourceId: blocked.operation.resourceId,
              operation: blocked.operation.operation,
              details: {
                ruleId: blocked.decision.rule,
                decision: blocked.decision,
                ...operationFields,
              },
            },
          },
        })
        await deps.audit.record(auth, {
          action: 'runtime_sandbox.operation',
          resourceType: blocked.operation.resourceType,
          resourceId: blocked.operation.resourceId,
          outcome: 'denied',
          sessionId: session.id,
          policyCategory: blocked.decision.category,
          metadata: { operation: blocked.operation.operation, ...operationFields, decision: blocked.decision },
        })
      },
    })
    const startedAt = Date.now()
    const result = await deps.amaTurnExecutor.runTurn({
      sessionId: session.id,
      sandboxId: session.sandboxId ?? '',
      provider: turnProvider,
      model: turnModel,
      agentSnapshot: runtimeAgentSnapshot,
      ...(work.prompt !== undefined ? { prompt: work.prompt } : {}),
      ...(work.continuation ? { continuation: true } : {}),
      messages,
      ...(deps.cloudTurnQueue.runsInline()
        ? {}
        : { shouldPause: () => Date.now() - startedAt > CLOUD_TURN_SOFT_BUDGET_MS }),
      ensureActive: callbacks.ensureActive,
      onEvent: callbacks.onEvent,
      resolveToolResult: callbacks.resolveToolResult,
      approveToolCall: callbacks.approveToolCall,
    })
    if (result.status === 'idle') {
      await store.updateSessionWhenState(auth.project.id, session.id, 'running', {
        state: 'idle',
        updatedAt: now(),
      })
    }

    if (result.status === 'paused') {
      await store.updateSessionWhenState(auth.project.id, session.id, 'running', {
        updatedAt: now(),
      })
      // The queue consumer owns the continuation (lease renewal + step cap), so a
      // paused turn just reports it instead of enqueuing the next step itself.
      return { ok: true, paused: true }
    }

    await deps.audit.record(auth, {
      action: auditAction,
      resourceType: 'session',
      resourceId: session.id,
      outcome: 'success',
      sessionId: session.id,
      metadata: auditAction === 'session.prompt' ? { source: 'api', promptDispatched: true } : { type: 'prompt' },
    })
    return { ok: true }
  } catch (error) {
    if (isRuntimeTurnCancelled(error)) {
      if (callbacks?.approvalGate.requiresAction()) {
        return { ok: true, requiresAction: true }
      }
      return { ok: false, cancelled: true }
    }
    const safeError = safeRuntimeError(error)
    if (callbacks?.wasPolicyDenied() || isRuntimePolicyDenied(error)) {
      await store.updateSessionWhenState(auth.project.id, session.id, 'running', {
        state: 'idle',
        stateReason: 'policy-denied',
        updatedAt: now(),
      })
      return { ok: false, cancelled: false, error: safeError }
    }
    await markPromptFailed(deps, auth, session, safeError.message)
    return { ok: false, cancelled: false, error: safeError }
  }
}

// Maps a completed turn's outcome to the continuation decision under the lease we
// hold (turnId). A paused turn extends the chain — bumping the depth, enforcing
// the cap, renewing the lease, and enqueuing the next step. Any terminal outcome
// releases the lease so the next queued turn can claim it.
async function handleTurnOutcome(
  deps: CloudTurnDeps,
  auth: AuthScope,
  session: SessionRow,
  turnId: string,
  auditAction: 'session.prompt' | 'session.command',
  outcome: CloudTurnOutcome,
): Promise<void> {
  const store = deps.sessionOrchestration
  if (outcome.ok && outcome.paused) {
    const depth = await store.incrementContinuationDepth(auth.project.id, session.id, turnId)
    if (depth >= MAX_CONTINUATION_DEPTH) {
      await store.releaseTurnLease(auth.project.id, session.id, turnId, {
        state: 'idle',
        stateReason: CONTINUATION_LIMIT_REASON,
        updatedAt: now(),
      })
      return
    }
    await store.renewTurnLease(auth.project.id, session.id, turnId, turnLeaseExpiry())
    await deps.cloudTurnQueue.enqueue({
      type: 'session.step',
      sessionId: session.id,
      organizationId: auth.organization.id,
      projectId: auth.project.id,
      turnId,
      auditAction,
    })
    return
  }
  // Terminal (idle / error / cancelled / requires-action): executeCloudSessionTurn
  // already set the session state; just clear the lease for the next turn.
  await store.releaseTurnLease(auth.project.id, session.id, turnId, {})
}

// Runs a fresh turn under a newly-acquired lease. If the lease is held by another
// in-flight turn the message is deferred (re-enqueued after a short delay) instead
// of racing it — this is the per-session serialization (H1).
async function runLeasedTurn(
  deps: CloudTurnDeps,
  auth: AuthScope,
  session: SessionRow,
  work: { prompt?: string; continuation?: boolean },
  auditAction: 'session.prompt' | 'session.command',
  deferMessage: CloudTurnQueueMessage,
): Promise<void> {
  const store = deps.sessionOrchestration
  const turnId = newTurnId()
  const acquiredAt = now()
  const acquired = await store.acquireTurnLease(
    auth.project.id,
    session.id,
    turnId,
    turnLeaseExpiry(acquiredAt),
    acquiredAt,
  )
  if (!acquired) {
    await deps.cloudTurnQueue.enqueue(deferMessage, { delaySeconds: TURN_LEASE_RETRY_DELAY_SECONDS })
    return
  }
  const outcome = await executeCloudSessionTurn(deps, auth, session, work, auditAction)
  await handleTurnOutcome(deps, auth, session, turnId, auditAction, outcome)
}

export async function consumeCloudTurnQueueMessage(deps: CloudTurnDeps, message: CloudTurnQueueMessage): Promise<void> {
  const store = deps.sessionOrchestration
  const auth = cloudTurnSystemAuth(message)
  const session = await store.findSession(auth.project.id, message.sessionId)
  if (!session) {
    return
  }
  if (message.type === 'session.start') {
    if (session.state !== 'pending') {
      return
    }
    const agentSnapshot = parseAgentSnapshot(session.agentSnapshot)
    if (!agentSnapshot) {
      throw new Error('Session agent snapshot is required for cloud startup')
    }
    // message.runtime is an untrusted queue string; an unknown runtime would
    // otherwise reach runtimeDriver() and fail late, after side effects. Mark
    // the session errored up front instead of casting blindly.
    if (!isRuntimeName(message.runtime)) {
      await markCloudTurnDeadLettered(deps, message)
      return
    }
    await startSessionRuntimeForRow(deps, auth, {
      pending: session,
      agentSnapshot,
      environmentSnapshot: parseJson<EnvironmentSnapshot>(session.environmentSnapshot),
      runtime: message.runtime,
      runtimeConfig: message.runtimeConfig,
      env: message.env,
      envFrom: message.envFrom,
      volumes: message.volumes,
      volumeMounts: message.volumeMounts,
      ...(message.prompt !== undefined ? { prompt: message.prompt } : {}),
    })
    return
  }
  if (message.type === 'session.step') {
    if (session.state !== 'running') {
      return
    }
    if (message.turnId) {
      // Budget continuation of an in-flight chain: renew the SAME lease so a
      // concurrent prompt that arrived mid-chain stays deferred. If the lease was
      // lost (cleared, or reclaimed after expiry by another worker) — stop.
      const renewed = await store.renewTurnLease(auth.project.id, session.id, message.turnId, turnLeaseExpiry())
      if (!renewed) {
        return
      }
      const outcome = await executeCloudSessionTurn(deps, auth, session, { continuation: true }, message.auditAction)
      await handleTurnOutcome(deps, auth, session, message.turnId, message.auditAction, outcome)
      return
    }
    // Approval-resume (continuation with no held lease): acquire a fresh lease.
    await runLeasedTurn(deps, auth, session, { continuation: true }, message.auditAction, message)
    return
  }
  if (session.state === 'idle') {
    const reclaimed = await store.updateSessionWhenState(auth.project.id, session.id, 'idle', {
      state: 'running',
      stateReason: null,
      updatedAt: now(),
    })
    if (!reclaimed) {
      return
    }
  } else if (session.state !== 'running') {
    return
  }
  await runLeasedTurn(deps, auth, session, { prompt: message.prompt }, message.auditAction, message)
}

export async function dispatchPrompt(deps: CloudTurnDeps, auth: AuthScope, session: SessionRow, prompt: string) {
  const store = deps.sessionOrchestration
  const submittedAt = now()
  const started = await store.updateSessionWhenState(auth.project.id, session.id, ['idle', 'running'], {
    state: 'running',
    stateReason: null,
    updatedAt: submittedAt,
  })
  if (!started) {
    throw new Error('Session runtime is no longer active')
  }

  if (deps.cloudTurnQueue.runsInline()) {
    await executeCloudSessionTurn(deps, auth, session, { prompt: prompt }, 'session.prompt')
    return
  }
  await deps.cloudTurnQueue.enqueue({
    type: 'session.turn',
    sessionId: session.id,
    organizationId: auth.organization.id,
    projectId: auth.project.id,
    prompt: prompt,
    auditAction: 'session.prompt',
  })
}

// A cloud turn message that exhausted its retries lands in the dead-letter queue.
// Mark the stranded session errored (clearing any lease it held) so clients
// recover it immediately instead of waiting for the 20-minute stall sweep.
export async function markCloudTurnDeadLettered(deps: CloudTurnDeps, message: CloudTurnQueueMessage): Promise<void> {
  const store = deps.sessionOrchestration
  const auth = cloudTurnSystemAuth(message)
  await store.updateSessionWhenState(auth.project.id, message.sessionId, ['pending', 'running'], {
    state: 'error',
    stateReason: 'cloud-turn-failed',
    activeTurnId: null,
    turnLeaseExpiresAt: null,
    updatedAt: now(),
  })
  await deps.audit.record(auth, {
    action: message.type === 'session.start' ? 'session.runtime.start' : 'session.command',
    resourceType: 'session',
    resourceId: message.sessionId,
    outcome: 'failure',
    sessionId: message.sessionId,
    metadata: { reason: 'cloud_turn_dead_lettered', messageType: message.type },
  })
}
