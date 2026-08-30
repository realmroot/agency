import type { SessionEvent } from '@shared/session-events'
import type { AgentSubagent } from './agent'
import type {
  EnvironmentNetworking,
  EnvironmentPackages,
  EnvironmentScope,
  EnvironmentType,
  EnvironmentVariable,
} from './environment'
import type { IdentityDescriptor } from './identity'
import type { ResourceMetadata } from './resource'
import type { EnvFromEntry, Volume, VolumeMount } from './runtime/execution-inputs'
import type { RuntimeName } from './runtime-catalog'

export type { SessionEvent }

// Pure session rules and entities. No drizzle, no env, no hono. The operational state
// machine, hosting-mode derivation, prompt-delivery decision, approval-state
// purity, and the pure parts of snapshot construction live here so the usecase
// and runtime layers share one source of truth that is unit-testable in
// milliseconds.

export const SESSION_STATES = ['pending', 'running', 'idle', 'closed', 'error'] as const
export type SessionState = (typeof SESSION_STATES)[number]

export const MESSAGE_DELIVERIES = ['live', 'queued'] as const
export type MessageDelivery = (typeof MESSAGE_DELIVERIES)[number]

export const MESSAGE_STATES = ['accepted', 'delivered', 'failed'] as const
export type MessageState = (typeof MESSAGE_STATES)[number]

export const APPROVAL_STATES = ['pending', 'approved', 'denied'] as const
export type ApprovalState = (typeof APPROVAL_STATES)[number]

export type SessionHostingMode = 'cloud' | 'self_hosted'

export interface Session {
  metadata: SessionMetadata
  spec: SessionSpec
  status: SessionStatus
}
export interface SessionMetadata {
  uid: string
  pid: string
  name: string
  labels: Record<string, string>
  annotations: Record<string, string>
  createdBy: string | null
  createdAt: string
  updatedAt: string
  archivedAt: string | null
}

export interface SessionSpec {
  agentId: string
  environmentId: string | null
  runtime: RuntimeName
  env: Record<string, string>
  envFrom: EnvFromEntry[]
  volumes: Volume[]
  volumeMounts: VolumeMount[]
}

export interface SessionStatus {
  phase: SessionState
  reason: string | null
  conditions: SessionCondition[]
  bindings: SessionBindings
  placement: SessionPlacement | null
  startedAt: string | null
  closedAt: string | null
}

export interface SessionCondition {
  type: 'Scheduled' | 'RuntimeReady' | 'Running' | 'Completed'
  status: 'True' | 'False' | 'Unknown'
  reason: string | null
  message: string | null
  lastTransitionAt: string
}

export interface SessionBindings {
  agent: BoundSessionAgent
  environment: BoundSessionEnvironment
  runtime: RuntimeName
}

export interface BoundSessionAgent {
  versionId: string
  snapshot: SessionAgentSnapshot
}

export interface BoundSessionEnvironment {
  id: string | null
  versionId: string | null
  snapshot: SessionEnvironmentSnapshot | null
}

export interface SessionPlacement {
  hostingMode: SessionHostingMode
  provider: string | null
  model: string | null
  driver: string | null
  backend: string | null
  protocol: string | null
}

export interface SessionAgentSnapshot {
  id: string
  agentId: string
  projectId: string
  version: number
  systemPrompt: string
  provider: string | null
  model: string | null
  skills: string[]
  subagents: AgentSubagent[]
  allowedTools: string[]
  mcpConnectors: string[]
  identity: IdentityDescriptor | null
  createdAt: string
}

export interface SessionEnvironmentSnapshot {
  id: string
  environmentId: string
  projectId: string
  version: number
  scope: EnvironmentScope
  type: EnvironmentType
  networking: EnvironmentNetworking
  packages: EnvironmentPackages
  variables: Record<string, EnvironmentVariable>
  createdAt: string
}

export interface SessionMessage {
  id: string
  sessionId: string
  type: 'prompt'
  content: string
  delivery: MessageDelivery
  state: MessageState
  error: string | null
  createdAt: string
  updatedAt: string
}

export interface SessionApproval {
  id: string
  sessionId: string
  toolCallId: string
  toolName: string
  input: Record<string, unknown>
  relatedEventIds: string[]
  state: ApprovalState
  reason: string | null
  result: Record<string, unknown> | null
  requestedAt: string
  decidedAt: string | null
  createdAt: string
  updatedAt: string
}

// A session accepts prompts only while its runtime is live (idle or running).
export function sessionAcceptsPrompts(state: SessionState): boolean {
  return state === 'idle' || state === 'running'
}

// A session is terminal once it has errored. Closed sessions can be reopened.
export function sessionIsTerminal(state: SessionState): boolean {
  return state === 'error'
}

// Self-hosted sessions never own a sandbox; cloud sessions always do. The
// sandboxId presence is therefore the canonical hosting-mode discriminator at
// the runtime layer, where the environment snapshot is not always rehydrated.
export function hostingModeFromSandbox(sandboxId: string | null): SessionHostingMode {
  return sandboxId ? 'cloud' : 'self_hosted'
}

// Derives the hosting mode from a (normalized) environment snapshot. A missing
// or non-self-hosted snapshot defaults to cloud.
export function hostingModeFromSnapshot(hostingMode: unknown): SessionHostingMode {
  return hostingMode === 'self_hosted' ? 'self_hosted' : 'cloud'
}

// Detects raw secret material in caller-provided config so it is rejected
// before it can be persisted: any key that looks like a secret, or any URL
// carrying embedded credentials, is treated as secret material.
export function hasSecretMaterial(value: unknown): boolean {
  if (!value || typeof value !== 'object') {
    return false
  }
  if (Array.isArray(value)) {
    return value.some(hasSecretMaterial)
  }
  return Object.entries(value).some(([key, child]) => secretKey(key) || hasSecretMaterial(child))
}

function secretKey(key: string) {
  if (key === 'secretRef') {
    return false
  }
  return /secret|token|password|api[_-]?key/i.test(key)
}

export function hasEmbeddedCredentialUrl(value: unknown): boolean {
  if (typeof value === 'string') {
    try {
      const url = new URL(value)
      return Boolean(url.username || url.password)
    } catch {
      return false
    }
  }
  if (!value || typeof value !== 'object') {
    return false
  }
  if (Array.isArray(value)) {
    return value.some(hasEmbeddedCredentialUrl)
  }
  return Object.values(value).some(hasEmbeddedCredentialUrl)
}

export function sessionUserMetadata(
  input: Record<string, unknown> | undefined,
): Pick<ResourceMetadata, 'labels' | 'annotations'> {
  const labels = stringRecord(input?.labels)
  const annotations = stringRecord(input?.annotations)
  return { labels, annotations }
}

export function mergeSessionUserMetadata(
  current: Record<string, unknown>,
  update: Record<string, unknown>,
): Record<string, unknown> {
  const currentLabels = stringRecord(current.labels)
  const currentAnnotations = stringRecord(current.annotations)
  const { labels: patchLabels, annotations: patchAnnotations } = sessionUserMetadata(update)
  for (const [key, value] of Object.entries(objectRecord(update.labels))) {
    if (value === null) {
      delete currentLabels[key]
    } else if (typeof value === 'string') {
      currentLabels[key] = value
    }
  }
  for (const [key, value] of Object.entries(objectRecord(update.annotations))) {
    if (value === null) {
      delete currentAnnotations[key]
    } else if (typeof value === 'string') {
      currentAnnotations[key] = value
    }
  }
  return {
    ...current,
    labels: { ...currentLabels, ...patchLabels },
    annotations: { ...currentAnnotations, ...patchAnnotations },
  }
}

function objectRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

function stringRecord(value: unknown): Record<string, string> {
  return Object.fromEntries(
    Object.entries(objectRecord(value)).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
  )
}
