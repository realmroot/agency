// Pure trigger rules: secret-material detection (so raw secrets are kept out of
// metadata, resource refs, and plain env — they must use secret references),
// and interval-based next-due computation.

import type { ResourceMetadata, ResourcePhase } from './resource'
import type { SessionSpec } from './session'

export type TriggerType = 'scheduled' | 'http'
export type TriggerRunPhase = 'claimed' | 'dispatched' | 'failed'
export type TriggerSourceType = 'schedule' | 'http'
export type TriggerSessionTemplateSpec = Pick<
  SessionSpec,
  'agentId' | 'environmentId' | 'runtime' | 'env' | 'envFrom' | 'volumes' | 'volumeMounts'
> & {
  promptTemplate: string
}

export interface TriggerSessionTemplate {
  metadata: {
    labels: Record<string, string>
    annotations: Record<string, string>
  }
  spec: TriggerSessionTemplateSpec
}

export interface TriggerSchedule {
  type: 'interval'
  intervalSeconds: number
  windowSeconds: number
}

export type TriggerSource =
  | {
      type: 'schedule'
      schedule: TriggerSchedule
    }
  | {
      type: 'http'
    }

export interface Trigger {
  metadata: ResourceMetadata
  spec: TriggerSpec
  status: TriggerStatus
}

export interface TriggerSpec {
  source: TriggerSource
  suspend: boolean
  template: TriggerSessionTemplate
}

export interface TriggerStatus {
  phase: ResourcePhase
  nextDueAt: string | null
  lastDispatchedAt: string | null
  lastRunId: string | null
}

export interface TriggerRun {
  metadata: ResourceMetadata
  spec: TriggerRunSpec
  status: TriggerRunStatus
}

export interface TriggerRunSpec {
  triggerId: string
  scheduledFor: string | null
  idempotencyKey: string
  correlationId: string
  metadata: Record<string, unknown>
}

export interface TriggerRunStatus {
  phase: TriggerRunPhase
  heartbeatAt: string | null
  triggeredAt: string
  sessionId: string | null
  errorMessage: string | null
}

function secretKey(key: string) {
  const normalized = key.toLowerCase().replaceAll(/[^a-z0-9]/g, '')
  return (
    normalized.includes('secret') ||
    normalized.includes('token') ||
    normalized.includes('apikey') ||
    normalized.includes('password') ||
    normalized.includes('privatekey')
  )
}

export function hasSecretMaterial(value: unknown): boolean {
  if (!value || typeof value !== 'object') {
    return false
  }
  if (Array.isArray(value)) {
    return value.some(hasSecretMaterial)
  }
  return Object.entries(value).some(([key, child]) => secretKey(key) || hasSecretMaterial(child))
}

export function nextDueFromInterval(intervalSeconds: number, from: number = Date.now()) {
  return new Date(from + intervalSeconds * 1000).toISOString()
}
