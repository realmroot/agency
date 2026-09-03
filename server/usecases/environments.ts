import {
  BUNDLED_REALMROOT_GO_PACKAGE,
  BUNDLED_REALMROOT_WEBI_PACKAGE,
  type Environment,
  type EnvironmentConfig,
  hasSecretMaterial,
  RUNTIME_CONFIG_FIELDS,
} from '@server/domain/environment'
import { creationDigest, creationFingerprint } from './creation-idempotency'
import type { Deps } from './deps'
import { type AuthScope, CreationIdempotencyConflictError, EnvironmentValidationError } from './ports'

// Validates the config against sibling resources (MCP catalog entries) and the
// secret-free-object rules. Throws
// EnvironmentValidationError on the first failure.
function validateConfig(config: EnvironmentConfig, validateBundledPackages = true) {
  if (hasSecretMaterial(config.variables)) {
    throw new EnvironmentValidationError('Invalid environment configuration', {
      variables: 'Secret material must be stored in a vault.',
    })
  }
  if (
    (validateBundledPackages &&
      config.packages.go.some((declaration) => declaration.startsWith('github.com/realmroot/cli@'))) ||
    (validateBundledPackages && config.packages.webi.some((declaration) => declaration.startsWith('realmroot@')))
  ) {
    throw new EnvironmentValidationError('Invalid environment configuration', {
      packages:
        config.type === 'cloud'
          ? `Realmroot Toolbox ${BUNDLED_REALMROOT_GO_PACKAGE} (${BUNDLED_REALMROOT_WEBI_PACKAGE}) is already provided by the cloud image.`
          : 'Self-hosted Environment packages are not installed by AMA; commands are resolved from the Runner host at execution time.',
    })
  }
}

function packagesEqual(left: EnvironmentConfig['packages'], right: EnvironmentConfig['packages']): boolean {
  return (
    left.type === right.type &&
    (['apt', 'cargo', 'gem', 'go', 'npm', 'pip', 'webi'] as const).every(
      (manager) =>
        left[manager].length === right[manager].length &&
        left[manager].every((declaration, index) => declaration === right[manager][index]),
    )
  )
}

export async function createEnvironment(
  deps: Deps,
  auth: AuthScope,
  input: { name: string; description: string | null; config: EnvironmentConfig; idempotencyKey?: string },
): Promise<Environment> {
  validateConfig(input.config)
  const requestFingerprint = input.idempotencyKey
    ? await creationFingerprint({ name: input.name, description: input.description, config: input.config })
    : undefined
  const keyHash = input.idempotencyKey ? await creationDigest(input.idempotencyKey) : undefined
  if (keyHash && requestFingerprint) {
    const replay = await deps.environments.findCreation(auth.project.id, keyHash)
    if (replay) {
      if (replay.fingerprint !== requestFingerprint) throw new CreationIdempotencyConflictError()
      return replay.environment
    }
  }
  const createdAt = new Date().toISOString()
  const { environment, version } = await deps.environments.insertWithInitialVersion(
    {
      projectId: auth.project.id,
      name: input.name,
      description: input.description,
      config: input.config,
      ...(keyHash && requestFingerprint ? { creationKeyHash: keyHash, creationFingerprint: requestFingerprint } : {}),
    },
    createdAt,
  )
  return {
    ...environment,
    status: { ...environment.status, currentVersionId: version.metadata.uid, version: version.status.version },
  }
}

export interface UpdateEnvironmentPatch {
  name?: string
  description?: string | null
  scope?: EnvironmentConfig['scope']
  type?: EnvironmentConfig['type']
  networking?: EnvironmentConfig['networking']
  packages?: EnvironmentConfig['packages']
  variables?: EnvironmentConfig['variables']
}

export interface UpdateEnvironmentResult {
  environment: Environment
}

// Orchestrates a PATCH: field merge, config validation, and version snapshots.
export async function updateEnvironment(
  deps: Deps,
  auth: AuthScope,
  environment: Environment,
  patch: UpdateEnvironmentPatch,
): Promise<UpdateEnvironmentResult> {
  const { name: _n, description: _d, ...configFields } = patch

  const next: EnvironmentConfig = {
    scope: configFields.scope ?? environment.spec.scope,
    type: configFields.type ?? environment.spec.type,
    networking: configFields.networking ?? environment.spec.networking,
    packages: configFields.packages ?? environment.spec.packages,
    variables: configFields.variables ?? environment.spec.variables,
  }
  const packagesChanged =
    configFields.packages !== undefined && !packagesEqual(configFields.packages, environment.spec.packages)
  validateConfig(next, packagesChanged)

  const updatedAt = new Date().toISOString()
  const runtimeChanged = RUNTIME_CONFIG_FIELDS.some((field) => configFields[field] !== undefined)
  // A runtime change snapshots a new immutable version; otherwise the current
  // version (id + number) is retained.
  const version = runtimeChanged ? await deps.environments.insertVersion(environment, next, updatedAt) : null
  const name = patch.name ?? environment.metadata.name
  const description = patch.description !== undefined ? patch.description : environment.metadata.description
  const currentVersionId = version?.metadata.uid ?? environment.status.currentVersionId

  await deps.environments.update(
    auth.project.id,
    environment.metadata.uid,
    { name, description, config: next, currentVersionId },
    updatedAt,
  )

  const updated: Environment = {
    ...environment,
    metadata: { ...environment.metadata, name, description, updatedAt },
    spec: next,
    status: {
      ...environment.status,
      phase: 'active',
      currentVersionId,
      version: version?.status.version ?? environment.status.version,
    },
  }
  return { environment: updated }
}
