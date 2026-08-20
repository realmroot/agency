import type { RuntimeRequirement, RuntimeSupport } from '@server/domain/runtime-catalog'

function secretKey(key: string) {
  return /secret|token|password|api[_-]?key/i.test(key)
}

// Runner-scoped secret detection is key-name based. Distinct from the
// agent/environment string-scanning variant.
export function hasSecretMaterial(value: unknown): boolean {
  if (!value || typeof value !== 'object') {
    return false
  }
  if (Array.isArray(value)) {
    return value.some(hasSecretMaterial)
  }
  return Object.entries(value).some(([key, child]) => secretKey(key) || hasSecretMaterial(child))
}

// The runtime a work item requires of a runner, if any. Session
// starts declare it explicitly; local AMA tool calls are recognized by shape.
export function workRuntimeRequirement(payload: Record<string, unknown>): RuntimeRequirement | null {
  const requirement = payload.runtimeRequirement
  if (requirement && typeof requirement === 'object' && !Array.isArray(requirement)) {
    const { runtime, model } = requirement as Record<string, unknown>
    if (typeof runtime === 'string' && runtime) {
      return {
        runtime: runtime as RuntimeRequirement['runtime'],
        ...(typeof model === 'string' && model ? { model } : {}),
      }
    }
  }
  if (
    payload.type !== 'session.start' &&
    (typeof payload.toolName === 'string' ||
      (payload.toolCall !== null && typeof payload.toolCall === 'object' && !Array.isArray(payload.toolCall)))
  ) {
    return { runtime: 'ama' }
  }
  return null
}

// The OIDC binding claims a runner-registration request carries. Built by the
// http layer from the auth context; the binding rules below are pure over it.
export interface RunnerOidcContext {
  isRunnerToken: boolean
  subject: string
  clientId: string | null
}

// The set of runner authentication modes. Single source of truth: the API enum,
// the record type, and the registration logic all derive from this.
export const RUNNER_AUTH_MODES = ['realmroot'] as const
export type RunnerAuthMode = (typeof RUNNER_AUTH_MODES)[number]

// The auth mode a registration resolves to. Realmroot is the only supported mode.
export function runnerAuthModeForRegistration(requested: RunnerAuthMode | undefined): RunnerAuthMode {
  return requested ?? 'realmroot'
}

export function environmentIdForRegistration(requested: string | undefined): string | undefined {
  return requested
}

// Validates that the resolved auth mode is consistent with the token's binding
// claims. Returns field errors when a runner token registers an incompatible
// runner, or null when the binding is acceptable (including non-runner tokens).
export function runnerOidcBindingFields(oidc: RunnerOidcContext, authMode: string): Record<string, string> | null {
  if (!oidc.isRunnerToken) {
    return { authorization: 'Runner registration requires a Realmroot runner device token.' }
  }
  if (authMode !== 'realmroot') {
    return { authMode: 'Runner device tokens can only register Realmroot-authenticated runners.' }
  }
  if (!oidc.clientId) {
    return { authorization: 'Runner OIDC token did not include a bindable client id.' }
  }
  return null
}

export function runnerMachineId(metadata: Record<string, unknown> | undefined): string | null {
  const value = metadata?.machineId
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

// Lease readiness gate: runtime session work is leased only when the runner
// reports the required runtime as ready and enumerates any selected model.
export function runnerSupportsWork(runtimes: RuntimeSupport, payload: Record<string, unknown>): boolean {
  const required = workRuntimeRequirement(payload)
  if (required === null) {
    return payload.type !== 'session.start'
  }
  return runtimes.some(
    (entry) =>
      entry.runtime === required.runtime &&
      entry.state === 'ready' &&
      (required.model === undefined || entry.models.includes(required.model)),
  )
}
