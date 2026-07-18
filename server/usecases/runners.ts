import {
  environmentIdForRegistration,
  hasSecretMaterial,
  type RunnerAuthMode,
  type RunnerOidcContext,
  runnerAuthModeForRegistration,
  runnerMachineId,
  runnerOidcBindingFields,
} from '@server/domain/runner-queue'
import type { Deps } from './deps'
import {
  type AuthScope,
  type CreateRunnerInput,
  type RunnerAuthRecord,
  RunnerConflictError,
  type RunnerRuntime,
  RunnerValidationError,
  type RuntimeUsage,
} from './ports'

export interface RegisterRunnerInput {
  name: string
  environmentId: string | undefined
  secretRef: string | undefined
  authMode: RunnerAuthMode | undefined
  maxConcurrent: number
  metadata: Record<string, unknown>
}

export interface RegisterRunnerResult {
  runner: RunnerAuthRecord
  reregistered: boolean
}

// Registers (or federated re-registers) a self-hosted runner: rejects raw
// secret material, resolves the OIDC binding, validates the environment and
// secret references, and reuses a machine-bound runner row when present.
export async function registerRunner(
  deps: Deps,
  auth: AuthScope,
  oidc: RunnerOidcContext,
  input: RegisterRunnerInput,
): Promise<RegisterRunnerResult> {
  if (hasSecretMaterial(input.metadata)) {
    throw new RunnerValidationError('Runner metadata must not contain raw secret material')
  }
  const environmentId = environmentIdForRegistration(oidc, input.environmentId)
  if (environmentId && !(await deps.runners.environmentUsable(auth.project.id, environmentId))) {
    throw new RunnerConflictError('Runner environment is unavailable')
  }
  const authMode = runnerAuthModeForRegistration(oidc, input.authMode)
  const bindingFields = runnerOidcBindingFields(oidc, authMode)
  if (bindingFields) {
    throw new RunnerValidationError('Runner OIDC token is missing required binding claims', bindingFields)
  }
  if (input.secretRef) {
    const usable = await deps.runners.secretRefUsable(auth.organization.id, auth.project.id, input.secretRef)
    if (usable.credentialMissing) {
      throw new RunnerValidationError('Runner secret reference is invalid', {
        secretRef: 'Runner secret reference is not an active vault credential.',
      })
    }
    if (usable.versionMissing) {
      throw new RunnerValidationError('Runner secret reference is invalid', {
        secretRef: 'Runner secret reference is not an active credential version.',
      })
    }
  }
  const createInput: CreateRunnerInput = {
    organizationId: auth.organization.id,
    projectId: auth.project.id,
    name: input.name,
    environmentId: environmentId ?? null,
    secretRef: input.secretRef ?? null,
    authMode,
    oidcSubject: oidc.subject,
    oidcClientId: oidc.clientId,
    maxConcurrent: input.maxConcurrent,
    metadata: input.metadata,
  }
  const timestamp = new Date().toISOString()
  const machineId = runnerMachineId(input.metadata)
  const reusable = await deps.runners.findForMachineRegistration(
    auth.project.id,
    authMode,
    oidc.subject,
    environmentId ?? null,
    machineId,
  )
  if (reusable) {
    // Machine-bound re-registration is only valid for the federated runner that
    // owns the row; anything else is a conflicting registration of the same id.
    if (
      reusable.projectId !== auth.project.id ||
      reusable.authMode !== 'federated' ||
      reusable.oidcSubject !== oidc.subject
    ) {
      throw new RunnerConflictError('Runner id is already registered')
    }
    const runner = await deps.runners.reregister(auth.project.id, reusable.id, createInput, timestamp)
    return { runner, reregistered: true }
  }
  const runner = await deps.runners.insert(createInput, timestamp)
  return { runner, reregistered: false }
}

export interface UpdateRunnerPatch {
  name?: string
  state?: 'active' | 'draining' | 'disabled'
  maxConcurrent?: number
  metadata?: Record<string, unknown>
  archived?: boolean
}

// Updates runner management fields and the archive lifecycle. Rejects raw
// secret material; absent fields retain their current value.
export async function updateRunner(
  deps: Deps,
  projectId: string,
  runner: RunnerAuthRecord,
  patch: UpdateRunnerPatch,
): Promise<RunnerAuthRecord> {
  if (hasSecretMaterial(patch.metadata)) {
    throw new RunnerValidationError('Runner metadata must not contain raw secret material')
  }
  const timestamp = new Date().toISOString()
  const archivedAt =
    patch.archived === undefined ? runner.archivedAt : patch.archived ? (runner.archivedAt ?? timestamp) : null
  return deps.runners.update(
    projectId,
    runner.id,
    {
      name: patch.name ?? runner.name,
      state: patch.state ?? runner.state,
      maxConcurrent: patch.maxConcurrent ?? runner.maxConcurrent,
      metadata: patch.metadata ?? runner.metadata,
      archivedAt,
    },
    timestamp,
  )
}

export interface HeartbeatPatch {
  state?: 'active' | 'draining' | 'offline'
  runtimeUsage?: RuntimeUsage[]
  runtimes?: RunnerRuntime[]
  metadata?: Record<string, unknown>
}

// Replaces the runner heartbeat singleton. Archived and disabled runners cannot
// heartbeat; raw secret material in metadata/inventory is rejected. The state
// defaults to 'active' when the heartbeat omits it.
export async function recordRunnerHeartbeat(
  deps: Deps,
  projectId: string,
  runner: RunnerAuthRecord,
  patch: HeartbeatPatch,
): Promise<RunnerAuthRecord> {
  if (runner.archivedAt) {
    throw new RunnerConflictError('Archived runners cannot heartbeat')
  }
  if (runner.state === 'disabled') {
    throw new RunnerConflictError('Disabled runners cannot heartbeat until re-enabled by an operator')
  }
  if (hasSecretMaterial(patch.metadata) || hasSecretMaterial(patch.runtimes)) {
    throw new RunnerValidationError('Runner heartbeat metadata must not contain raw secret material')
  }
  const timestamp = new Date().toISOString()
  return deps.runners.heartbeat(
    projectId,
    runner.id,
    {
      state: patch.state ?? 'active',
      runtimeUsage: patch.runtimeUsage ?? runner.runtimeUsage,
      runtimes: patch.runtimes ?? runner.runtimes,
      metadata: patch.metadata ?? runner.metadata,
    },
    timestamp,
  )
}
