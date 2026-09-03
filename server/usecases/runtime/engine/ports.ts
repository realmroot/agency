// Enbor cloud-loop execution contract.
//
// This is the single source of the Enbor first-party turn engine. The loop runs
// only in the cloud control plane; self-hosted runners may provide a sandbox
// executor, but they do not host this loop. The engine depends only on the
// agent libraries, runtime contracts, and the ports below — never on Env,
// Cloudflare Sandbox SDK, D1, Hono, runner channels, or fetch.

import type { AgentMessage } from '@earendil-works/pi-agent-core'
import type { AssistantMessage, Context, Model } from '@earendil-works/pi-ai'
import type { ToolExecutionInput, ToolExecutionResult } from '@enbor/runtime-contracts/sandbox-tools'
import type { EnborEvent } from '@shared/session-events'

export type { ToolExecutionInput, ToolExecutionResult }

// ── Tool execution ──────────────────────────────────────────────────────────

// Sandbox tool execution. The Worker implements it against the Cloudflare
// Sandbox or the self-hosted runner channel. The engine only sees the contract.
export interface ToolExecutor {
  execute(input: ToolExecutionInput, signal?: AbortSignal): Promise<ToolExecutionResult>
  stop?(sandboxId: string): Promise<void>
}

// ── Tool policy (canonical home; server/runtime/session-runtime re-exports) ───

export type RuntimeToolPolicyInput = {
  toolCallId: string
  toolName: string
  input: Record<string, unknown>
}

export type RuntimeToolPolicyDecision = {
  allowed: boolean
  reason?: string
}

// ── Ports (formalize the SessionTurnInput inline callbacks) ───────────────────

// Canonical session events leave the engine through here. The Worker appends to
// D1; the runner forwards over its channel. A suppression decorator (approval
// gate) wraps this without the engine knowing.
export interface RuntimeEventSink {
  emit(event: EnborEvent): Promise<void>
}

// Gates a tool call before execution (sandbox/network policy + approval).
export interface ToolPolicyGate {
  approve(input: RuntimeToolPolicyInput): Promise<RuntimeToolPolicyDecision>
}

// Supplies a caller-provided tool result (e.g. an approved custom tool outcome)
// instead of executing the tool. Returns null to fall through to the executor.
export interface ToolResultResolver {
  resolve(input: RuntimeToolPolicyInput): Promise<Record<string, unknown> | null>
}

// Liveness check run before each model call after the first; throws to cancel.
export interface TurnLiveness {
  ensureActive(): Promise<void>
}

// Execution-budget check; returning true pauses the run for continuation.
export interface TurnBudget {
  shouldPause(): boolean
}

// Model egress. The Worker implements it against the Workers AI binding
// (env.AI), with test-mode simulation. Owns provider/test specifics and request
// mapping so the engine stays free of both. Throws ProviderCallError
// (adapter-normalized) on failure.
export interface ModelClient {
  complete(model: Model<string>, context: Context, signal?: AbortSignal): Promise<AssistantMessage>
}

// ── The engine ────────────────────────────────────────────────────────────────

export type TurnEngineResult = {
  // 'paused': the run wants more model turns but yielded its execution budget;
  // the caller re-enters with `continuation` to resume from the persisted
  // transcript (whose last message is a tool result).
  status: 'idle' | 'aborted' | 'paused'
}

export type TurnEngineInput = {
  sessionId: string
  // Opaque to the engine; forwarded to executor.execute.
  sandboxId: string
  // The fully-resolved model object (host builds it; the engine never resolves
  // provider/model defaults).
  model: Model<string>
  // Display labels for the usage / runtime.error events.
  providerLabel: string
  modelLabel: string
  agentSnapshot: Record<string, unknown>
  // Required unless `continuation` is set.
  prompt?: string
  continuation?: boolean
  messages?: AgentMessage[]
  sink: RuntimeEventSink
  policy: ToolPolicyGate
  toolResults: ToolResultResolver
  liveness: TurnLiveness
  budget?: TurnBudget
  executor: ToolExecutor
  modelClient: ModelClient
  // Optional external cancellation source. When it aborts, the engine aborts the
  // in-flight agent loop (model + tool calls). Additive: hosts may omit it and
  // rely on the cooperative liveness check instead.
  signal?: AbortSignal
}
