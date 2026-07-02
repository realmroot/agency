// Pure trigger rules: secret-material detection (so raw secrets are kept out of
// metadata, resource refs, and plain env — they must use secret references),
// interval-based next-due computation, and the constrained HTTP prompt template
// renderer.

import { Liquid } from 'liquidjs'
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

export class PromptTemplateRenderError extends Error {
  readonly field: string
  constructor(message: string, field: string) {
    super(message)
    this.name = 'PromptTemplateRenderError'
    this.field = field
  }
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

export interface HttpTriggerTemplateContext {
  body: unknown
  header: Record<string, string>
  run?: {
    session_reused: boolean
    session_id: string | null
    session_state: string | null
  }
}

const promptTemplateEngine = new Liquid({
  jsTruthy: true,
  strictFilters: false,
  strictVariables: false,
})

function normalizeRootPaths(template: string): string {
  return template.replace(
    /({[{%]-?\s*)(.*?)(\s*-?[}%]})/gs,
    (_match, open: string, expression: string, close: string) => {
      const normalized = expression.replace(/(^|[^\w"'])\.(?=[A-Za-z_])/g, '$1')
      return `${open}${normalized}${close}`
    },
  )
}

function templateContext(context: HttpTriggerTemplateContext): Record<string, unknown> {
  return {
    body: context.body,
    header: context.header,
    ama: {
      run: context.run ?? {
        session_reused: false,
        session_id: null,
        session_state: null,
      },
    },
  }
}

export function renderHttpPromptTemplate(template: string, context: HttpTriggerTemplateContext): string {
  try {
    return promptTemplateEngine.parseAndRenderSync(normalizeRootPaths(template), templateContext(context))
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new PromptTemplateRenderError(message, 'promptTemplate')
  }
}
