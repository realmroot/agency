import type { ResourceMetadata, ResourcePhase } from './resource'
import type { RuntimeName } from './runtime-catalog'

export const IDENTITY_STATES = ['provisioning', 'active', 'error'] as const
export type IdentityState = (typeof IDENTITY_STATES)[number]

export interface IdentityDescriptor {
  identityId: string
  agentId: string
  issuer: string
  subject: string
  username: string
  runtime: RuntimeName
  credentialRef: string
}

export interface Identity {
  metadata: ResourceMetadata
  spec: { username: string; runtime: RuntimeName }
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
    readonly expected: RuntimeName,
    readonly actual: RuntimeName,
  ) {
    super(`Runtime must match the selected Identity runtime: ${expected}.`)
    this.name = 'IdentityRuntimeMismatchError'
  }
}
