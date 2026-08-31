import {
  BUNDLED_REALMROOT_GO_PACKAGE,
  BUNDLED_REALMROOT_WEBI_PACKAGE,
  type Environment,
  type EnvironmentConfig,
  hasSecretMaterial,
  RUNTIME_CONFIG_FIELDS,
} from '@server/domain/environment'
import type { Deps } from './deps'
import { type AuthScope, EnvironmentArchivedError, EnvironmentValidationError } from './ports'

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
      packages: `Realmroot Toolbox ${BUNDLED_REALMROOT_GO_PACKAGE} (${BUNDLED_REALMROOT_WEBI_PACKAGE}) is already provided by the cloud image.`,
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
  input: { name: string; description: string | null; config: EnvironmentConfig },
): Promise<Environment> {
  validateConfig(input.config)
  const createdAt = new Date().toISOString()
  const environment = await deps.environments.insert(
    { projectId: auth.project.id, name: input.name, description: input.description, config: input.config },
    createdAt,
  )
  const version = await deps.environments.insertVersion(environment, input.config, createdAt)
  await deps.environments.setCurrentVersion(environment.metadata.uid, version.metadata.uid)
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
  archived?: boolean
}

export interface UpdateEnvironmentResult {
  environment: Environment
  archived: boolean
  unarchived: boolean
}

// Orchestrates a PATCH: archive lifecycle transitions, field merge, config
// validation, and version snapshot creation. Returns the updated record plus
// which lifecycle transition happened (so the route can audit). Throws
// EnvironmentArchivedError when field updates target an archived environment.
export async function updateEnvironment(
  deps: Deps,
  auth: AuthScope,
  environment: Environment,
  patch: UpdateEnvironmentPatch,
): Promise<UpdateEnvironmentResult> {
  const { archived, name: _n, description: _d, ...configFields } = patch
  const hasFieldUpdates =
    patch.name !== undefined || patch.description !== undefined || Object.keys(configFields).length > 0

  if (environment.metadata.archivedAt) {
    if (hasFieldUpdates) {
      throw new EnvironmentArchivedError()
    }
    if (archived === false) {
      const updatedAt = new Date().toISOString()
      await deps.environments.unarchive(auth.project.id, environment.metadata.uid, updatedAt)
      return {
        environment: {
          ...environment,
          metadata: { ...environment.metadata, archivedAt: null, updatedAt },
          status: { ...environment.status, phase: 'active' },
        },
        archived: false,
        unarchived: true,
      }
    }
    // archived: true (idempotent) or empty patch — no change.
    return { environment, archived: false, unarchived: false }
  }

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
  const archivedAt = archived === true ? updatedAt : environment.metadata.archivedAt
  const name = patch.name ?? environment.metadata.name
  const description = patch.description !== undefined ? patch.description : environment.metadata.description
  const currentVersionId = version?.metadata.uid ?? environment.status.currentVersionId

  await deps.environments.update(
    auth.project.id,
    environment.metadata.uid,
    { name, description, config: next, archivedAt, currentVersionId },
    updatedAt,
  )

  const updated: Environment = {
    ...environment,
    metadata: { ...environment.metadata, name, description, archivedAt, updatedAt },
    spec: next,
    status: {
      ...environment.status,
      phase: archivedAt ? 'archived' : 'active',
      currentVersionId,
      version: version?.status.version ?? environment.status.version,
    },
  }
  return { environment: updated, archived: archived === true, unarchived: false }
}
