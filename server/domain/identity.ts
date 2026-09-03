import type { ResourceMetadata, ResourcePhase } from './resource'
import type { RuntimeName } from './runtime-catalog'

export const IDENTITY_STATES = ['provisioning', 'active', 'error'] as const
export type IdentityState = (typeof IDENTITY_STATES)[number]
export type IdentityRuntime = string
export const IDENTITY_RUNTIME_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/

export function isIdentityRuntime(value: unknown): value is IdentityRuntime {
  return typeof value === 'string' && IDENTITY_RUNTIME_PATTERN.test(value)
}

export interface IdentityDescriptor {
  identityId: string
  agentId: string
  issuer: string
  subject: string
  username: string
  runtime: IdentityRuntime
  credentialRef: string
}

export interface Identity {
  metadata: ResourceMetadata
  spec: { username: string; runtime: IdentityRuntime }
  status: {
    phase: ResourcePhase
    state: IdentityState
    failureCode: string | null
    boundAgentId: string | null
    descriptor: IdentityDescriptor | null
  }
}

export interface IdentityCheckpoint {
  version: 1
  stage: 'initialized' | 'enrolled'
  state: Record<string, unknown>
  remote: Omit<IdentityDescriptor, 'identityId' | 'credentialRef'> | null
}

export function resolveIdentityRuntime(runtime: RuntimeName | undefined, descriptor: IdentityDescriptor | null) {
  if (!descriptor) {
    if (!runtime) throw new IdentityRuntimeRequiredError()
    return runtime
  }
  if (runtime && runtime !== descriptor.runtime) throw new IdentityRuntimeMismatchError(descriptor.runtime, runtime)
  return descriptor.runtime
}

export class IdentityRuntimeUnsupportedError extends Error {
  readonly code = 'identity_runtime_unsupported'
  constructor(readonly runtime: IdentityRuntime) {
    super(`Identity runtime is not supported by this AMA deployment: ${runtime}.`)
    this.name = 'IdentityRuntimeUnsupportedError'
  }
}

export class IdentityRuntimeRequiredError extends Error {
  readonly code = 'runtime_required'
  constructor() {
    super('Runtime is required when the Agent has no Identity.')
    this.name = 'IdentityRuntimeRequiredError'
  }
}

export class IdentityRuntimeMismatchError extends Error {
  readonly code = 'identity_runtime_mismatch'
  constructor(
    readonly expected: IdentityRuntime,
    readonly actual: RuntimeName,
  ) {
    super(`Runtime must match the selected Identity runtime: ${expected}.`)
    this.name = 'IdentityRuntimeMismatchError'
  }
}
