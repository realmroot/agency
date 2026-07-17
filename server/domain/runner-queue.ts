import {
  RUNTIME_PROVIDER_MODEL_CAPABILITY_PREFIX,
  transitionalRuntimeLevelRuntimes,
} from '@server/domain/runtime-catalog'

function secretKey(key: string) {
  return /secret|token|password|api[_-]?key/i.test(key)
}

// Runner-scoped secret detection: key-name based only (runner metadata and
// capabilities are operator-supplied diagnostic fields, so a secret-shaped key
// is the signal). Distinct from the agent/environment string-scanning variant.
export function hasSecretMaterial(value: unknown): boolean {
  if (!value || typeof value !== 'object') {
    return false
  }
  if (Array.isArray(value)) {
    return value.some(hasSecretMaterial)
  }
  return Object.entries(value).some(([key, child]) => secretKey(key) || hasSecretMaterial(child))
}

// The runtime capability a work item requires of a runner, if any. Session
// starts declare it explicitly; local AMA tool calls are recognized by shape.
export function requiredRunnerCapability(payload: Record<string, unknown>): string | null {
  if (typeof payload.requiredRunnerCapability === 'string') {
    return payload.requiredRunnerCapability
  }
  if (
    payload.type !== 'session.start' &&
    (typeof payload.toolName === 'string' ||
      (payload.toolCall !== null && typeof payload.toolCall === 'object' && !Array.isArray(payload.toolCall)))
  ) {
    return 'ama'
  }
  return null
}

// Whether a runner's advertised capabilities can claim the work item. Unscoped
// work is claimable by anyone except session starts, which always carry a
// runtime requirement.
export function runnerCapabilityEligible(capabilities: string[], payload: Record<string, unknown>): boolean {
  const required = requiredRunnerCapability(payload)
  if (required === null) {
    return payload.type !== 'session.start'
  }
  const eligible = new Set(capabilities)
  for (const capability of capabilities) {
    if (capability.startsWith(`${RUNTIME_PROVIDER_MODEL_CAPABILITY_PREFIX}:`)) {
      const runtime = capability.split(':')[1]
      if (runtime) {
        eligible.add(runtime)
      }
    }
  }
  if (eligible.has(required)) {
    return true
  }
  // TRANSITIONAL: runners deployed before host model enumeration declare the
  // bare runtime name. A declared bare runtime capability still claims
  // model-specific session work for wildcard-model runtimes so those runners
  // don't strand work. Removable once the runner fleet advertises enumerated
  // per-model capabilities.
  return transitionalRuntimeLevelRuntimes().some(
    (runtime) =>
      capabilities.includes(runtime) && required.startsWith(`${RUNTIME_PROVIDER_MODEL_CAPABILITY_PREFIX}:${runtime}:`),
  )
}

// The OIDC binding claims a runner-registration request carries. Built by the
// http layer from the auth context; the binding rules below are pure over it.
export interface RunnerOidcContext {
  isRunnerToken: boolean
  subject: string
  clientId: string | null
  runnerProjectId: string | null
  runnerEnvironmentId: string | null
  externalTenantId: string | null
}

// The set of runner authentication modes. Single source of truth: the API enum,
// the record type, and the registration logic all derive from this.
export const RUNNER_AUTH_MODES = ['bearer', 'mtls', 'oidc', 'federated'] as const
export type RunnerAuthMode = (typeof RUNNER_AUTH_MODES)[number]

// The auth mode a registration resolves to: an explicit request wins, otherwise
// a federated binding (project/tenant/environment claim) implies 'federated'
// and a bare device-login token implies 'oidc'.
export function runnerAuthModeForRegistration(
  oidc: RunnerOidcContext,
  requested: RunnerAuthMode | undefined,
): RunnerAuthMode {
  return requested ?? (oidc.runnerProjectId || oidc.externalTenantId || oidc.runnerEnvironmentId ? 'federated' : 'oidc')
}

// A federated runner token's environment binding overrides the requested one.
export function environmentIdForRegistration(
  oidc: RunnerOidcContext,
  requested: string | undefined,
): string | undefined {
  return oidc.runnerEnvironmentId ?? requested
}

// Validates that the resolved auth mode is consistent with the token's binding
// claims. Returns field errors when a runner token registers an incompatible
// runner, or null when the binding is acceptable (including non-runner tokens).
export function runnerOidcBindingFields(oidc: RunnerOidcContext, authMode: string): Record<string, string> | null {
  if (!oidc.isRunnerToken) {
    return null
  }
  if (oidc.runnerProjectId || oidc.externalTenantId || oidc.runnerEnvironmentId) {
    if (authMode !== 'federated') {
      return { authMode: 'Federated runner tokens can only register federated runners.' }
    }
    if (!oidc.runnerProjectId && !oidc.externalTenantId) {
      return { authorization: 'Federated runner token did not include a project or external tenant binding.' }
    }
    return null
  }
  if (authMode !== 'oidc') {
    return { authMode: 'Runner device-login tokens can only register OIDC-authenticated runners.' }
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

// Lease readiness gate: once a runner reports runtime inventory, runtime
// session work is leased only when the required runtime has a ready inventory
// entry. Runners that have not reported inventory yet are transitional and
// fall back to capability matching alone.
export function runnerRuntimeReady(
  inventory: Array<{ runtime: string; state: string }>,
  payload: Record<string, unknown>,
): boolean {
  if (inventory.length === 0) {
    return true
  }
  const required = requiredRunnerCapability(payload)
  if (required === null) {
    return true
  }
  const readyRuntimes = [...new Set(inventory.filter((entry) => entry.state === 'ready').map((entry) => entry.runtime))]
  return readyRuntimes.some(
    (runtime) => required === runtime || required.startsWith(`${RUNTIME_PROVIDER_MODEL_CAPABILITY_PREFIX}:${runtime}:`),
  )
}
