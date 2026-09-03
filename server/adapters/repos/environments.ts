import type {
  Environment,
  EnvironmentConfig,
  EnvironmentNetworking,
  EnvironmentPackages,
  EnvironmentScope,
  EnvironmentVariable,
  EnvironmentVersion,
} from '@server/domain/environment'
import { defaultEnvironmentPackages } from '@server/domain/environment'
import { resourceMetadata, resourcePhase } from '@server/domain/resource'
import { newPrimaryKey } from '@server/id'
import type {
  EnvironmentListPage,
  EnvironmentListQuery,
  EnvironmentRepo,
  UpdateEnvironmentFields,
} from '@server/usecases/ports'
import { CreationIdempotencyConflictError, ResourceDeletedDuringMutationError } from '@server/usecases/ports'
import { and, desc, eq, exists, gt, gte, isNull, like, lt, lte, notExists, or, sql } from 'drizzle-orm'
import type { drizzle } from 'drizzle-orm/d1'
import { connectors, environments, environmentVersions, leases, runners } from '../../db/schema'
import { DEFAULT_CONNECTORS } from '../../domain/connector'
import { throwIfDeletedParentConstraint } from './soft-delete-constraints'

type Db = ReturnType<typeof drizzle>
type EnvironmentRow = typeof environments.$inferSelect
type EnvironmentVersionRow = typeof environmentVersions.$inferSelect

function parseJson<T>(value: string) {
  return JSON.parse(value) as T
}

function stringify(value: unknown) {
  return JSON.stringify(value)
}

function scopeValue(value: unknown): EnvironmentScope {
  return value === 'organization' ? 'organization' : 'project'
}

function normalizePackages(value: unknown): EnvironmentPackages {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const packages = value as Record<string, unknown>
    return {
      ...defaultEnvironmentPackages(),
      type: 'packages',
      apt: stringArray(packages.apt),
      cargo: stringArray(packages.cargo),
      gem: stringArray(packages.gem),
      go: stringArray(packages.go),
      npm: stringArray(packages.npm),
      pip: stringArray(packages.pip),
      webi: stringArray(packages.webi),
    }
  }
  return defaultEnvironmentPackages()
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

function networkingFromRow(row: EnvironmentRow | EnvironmentVersionRow): EnvironmentNetworking {
  const policy = parseJson<Record<string, unknown>>(row.networkPolicy)
  const mode = policy.mode
  return {
    type: mode === 'offline' ? 'closed' : mode === 'restricted' ? 'limited' : 'open',
    allowMcpServers: policy.allowMcpServers === true,
    allowPackageManagers: policy.allowPackageManagers !== false,
    ...(Array.isArray(policy.allowedHosts) ? { allowedHosts: stringArray(policy.allowedHosts) } : {}),
  }
}

function networkPolicyColumns(networking: EnvironmentNetworking) {
  if (networking.type === 'closed') {
    return {
      mode: 'offline',
      allowMcpServers: networking.allowMcpServers,
      allowPackageManagers: networking.allowPackageManagers,
    }
  }
  if (networking.type === 'limited') {
    return {
      mode: 'restricted',
      allowMcpServers: networking.allowMcpServers,
      allowPackageManagers: networking.allowPackageManagers,
      allowedHosts: networking.allowedHosts ?? [],
    }
  }
  return {
    mode: 'unrestricted',
    allowMcpServers: networking.allowMcpServers,
    allowPackageManagers: networking.allowPackageManagers,
  }
}

function configFromRow(row: EnvironmentRow | EnvironmentVersionRow): EnvironmentConfig {
  const metadata = parseJson<Record<string, unknown>>(row.metadata)
  return {
    scope: scopeValue(metadata.scope),
    type: row.hostingMode === 'self_hosted' ? 'self_hosted' : 'cloud',
    networking: networkingFromRow(row),
    packages: normalizePackages(parseJson<unknown>(row.packages)),
    variables: parseJson<Record<string, EnvironmentVariable>>(row.variables),
  }
}

function configColumns(config: EnvironmentConfig) {
  return {
    packages: stringify(config.packages),
    variables: stringify(config.variables),
    hostingMode: config.type,
    networkPolicy: stringify(networkPolicyColumns(config.networking)),
    mcpPolicy: stringify({}),
    packageManagerPolicy: stringify({}),
    resourceLimits: stringify({}),
    runtimeConfig: stringify({}),
    metadata: stringify({ scope: config.scope }),
  }
}

async function versionNumberOf(db: Db, environmentId: string, versionId: string | null) {
  if (!versionId) {
    return 0
  }
  const row = await db
    .select({ version: environmentVersions.version })
    .from(environmentVersions)
    .where(and(eq(environmentVersions.id, versionId), eq(environmentVersions.environmentId, environmentId)))
    .get()
  return row?.version ?? 0
}

function environmentRecordFrom(row: EnvironmentRow, version: number): Environment {
  return {
    metadata: resourceMetadata({
      uid: row.id,
      pid: row.projectId,
      name: row.name,
      description: row.description,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      deletedAt: row.deletedAt,
    }),
    spec: configFromRow(row),
    status: {
      phase: resourcePhase(row.deletedAt),
      currentVersionId: row.currentVersionId,
      version,
    },
  }
}

function versionRecordFrom(row: EnvironmentVersionRow): EnvironmentVersion {
  return {
    metadata: resourceMetadata({
      uid: row.id,
      pid: row.projectId,
      name: `v${row.version}`,
      createdAt: row.createdAt,
      updatedAt: row.createdAt,
    }),
    spec: configFromRow(row),
    status: {
      environmentId: row.environmentId,
      version: row.version,
    },
  }
}

async function findCreation(db: Db, projectId: string, creationKeyHash: string) {
  const row = await db
    .select()
    .from(environments)
    .where(and(eq(environments.projectId, projectId), eq(environments.creationKeyHash, creationKeyHash)))
    .get()
  if (!row?.creationFingerprint) return null
  if (row.deletedAt) throw new CreationIdempotencyConflictError('Idempotency-Key belongs to a deleted Environment')
  const initialVersion = await db
    .select()
    .from(environmentVersions)
    .where(and(eq(environmentVersions.environmentId, row.id), eq(environmentVersions.version, 1)))
    .get()
  if (!initialVersion) throw new Error('Idempotent Environment creation is missing its initial version')
  const environment = environmentRecordFrom(
    {
      ...row,
      name: row.creationName ?? row.name,
      description: row.creationDescription,
      deletedAt: null,
      currentVersionId: initialVersion.id,
      updatedAt: row.createdAt,
    },
    1,
  )
  return {
    environment: {
      ...environment,
      spec: versionRecordFrom(initialVersion).spec,
      status: {
        ...environment.status,
        phase: resourcePhase(null),
        currentVersionId: initialVersion.id,
        version: 1,
      },
    },
    fingerprint: row.creationFingerprint,
  }
}

export function createEnvironmentRepo(db: Db): EnvironmentRepo {
  return {
    async list(query: EnvironmentListQuery): Promise<EnvironmentListPage> {
      const filters = [
        eq(environments.projectId, query.projectId),
        isNull(environments.deletedAt),
        query.search ? like(environments.name, `%${query.search}%`) : undefined,
        query.createdFrom ? gte(environments.createdAt, query.createdFrom) : undefined,
        query.createdTo ? lte(environments.createdAt, query.createdTo) : undefined,
        query.cursor
          ? or(
              lt(environments.createdAt, query.cursor.createdAt),
              and(eq(environments.createdAt, query.cursor.createdAt), lt(environments.id, query.cursor.id)),
            )
          : undefined,
      ].filter((filter) => filter !== undefined)
      const rows = await db
        .select()
        .from(environments)
        .where(and(...filters))
        .orderBy(desc(environments.createdAt), desc(environments.id))
        .limit(query.limit + 1)
      const hasMore = rows.length > query.limit
      const page = rows.slice(0, query.limit)
      const records = await Promise.all(
        page.map(async (row) => environmentRecordFrom(row, await versionNumberOf(db, row.id, row.currentVersionId))),
      )
      return { rows: records, hasMore }
    },

    async find(projectId, environmentId) {
      const row = await db
        .select()
        .from(environments)
        .where(
          and(
            eq(environments.id, environmentId),
            eq(environments.projectId, projectId),
            isNull(environments.deletedAt),
          ),
        )
        .get()
      if (!row) {
        return null
      }
      return environmentRecordFrom(row, await versionNumberOf(db, row.id, row.currentVersionId))
    },

    async findCreation(projectId, creationKeyHash) {
      return findCreation(db, projectId, creationKeyHash)
    },

    async insertVersion(environment, config, createdAt): Promise<EnvironmentVersion> {
      const latest = await db
        .select({ version: environmentVersions.version })
        .from(environmentVersions)
        .where(eq(environmentVersions.environmentId, environment.metadata.uid))
        .orderBy(desc(environmentVersions.version))
        .limit(1)
        .get()
      const row = {
        id: newPrimaryKey(),
        environmentId: environment.metadata.uid,
        projectId: environment.metadata.pid ?? '',
        version: (latest?.version ?? 0) + 1,
        createdAt,
        ...configColumns(config),
      }
      const configRow = configColumns(config)
      const inserted = await db
        .insert(environmentVersions)
        .select(
          db
            .select({
              id: sql<string>`${row.id}`.as('id'),
              environmentId: sql<string>`${row.environmentId}`.as('environment_id'),
              projectId: sql<string>`${row.projectId}`.as('project_id'),
              version: sql<number>`${row.version}`.as('version'),
              packages: sql<string>`${configRow.packages}`.as('packages'),
              variables: sql<string>`${configRow.variables}`.as('variables'),
              hostingMode: sql<string>`${configRow.hostingMode}`.as('hosting_mode'),
              networkPolicy: sql<string>`${configRow.networkPolicy}`.as('network_policy'),
              mcpPolicy: sql<string>`${configRow.mcpPolicy}`.as('mcp_policy'),
              packageManagerPolicy: sql<string>`${configRow.packageManagerPolicy}`.as('package_manager_policy'),
              resourceLimits: sql<string>`${configRow.resourceLimits}`.as('resource_limits'),
              runtimeConfig: sql<string>`${configRow.runtimeConfig}`.as('runtime_config'),
              metadata: sql<string>`${configRow.metadata}`.as('metadata'),
              createdAt: sql<string>`${createdAt}`.as('created_at'),
            })
            .from(environments)
            .where(
              and(
                eq(environments.id, environment.metadata.uid),
                eq(environments.projectId, row.projectId),
                isNull(environments.deletedAt),
              ),
            ),
        )
        .returning({ id: environmentVersions.id })
      if (inserted.length === 0) throw new ResourceDeletedDuringMutationError('Environment')
      return versionRecordFrom(row)
    },

    async listVersions(projectId, environmentId) {
      const rows = await db
        .select()
        .from(environmentVersions)
        .where(and(eq(environmentVersions.environmentId, environmentId), eq(environmentVersions.projectId, projectId)))
        .orderBy(desc(environmentVersions.version))
      return rows.map(versionRecordFrom)
    },

    async findVersion(projectId, environmentId, version) {
      const row = await db
        .select()
        .from(environmentVersions)
        .where(
          and(
            eq(environmentVersions.environmentId, environmentId),
            eq(environmentVersions.projectId, projectId),
            eq(environmentVersions.version, version),
          ),
        )
        .get()
      return row ? versionRecordFrom(row) : null
    },

    async insertWithInitialVersion(input, createdAt) {
      const environmentId = newPrimaryKey()
      const versionId = newPrimaryKey()
      const environmentRow = {
        id: environmentId,
        projectId: input.projectId,
        name: input.name,
        description: input.description,
        deletedAt: null,
        currentVersionId: versionId,
        creationKeyHash: input.creationKeyHash ?? null,
        creationFingerprint: input.creationFingerprint ?? null,
        creationName: input.creationKeyHash ? input.name : null,
        creationDescription: input.creationKeyHash ? input.description : null,
        createdAt,
        updatedAt: createdAt,
        ...configColumns(input.config),
      }
      const versionRow = {
        id: versionId,
        environmentId,
        projectId: input.projectId,
        version: 1,
        createdAt,
        ...configColumns(input.config),
      }
      try {
        await db.batch([
          db.insert(environments).values(environmentRow),
          db.insert(environmentVersions).values(versionRow),
        ])
      } catch (error) {
        throwIfDeletedParentConstraint(error, 'Environment')
        if (input.creationKeyHash && input.creationFingerprint) {
          const replay = await findCreation(db, input.projectId, input.creationKeyHash)
          if (replay) {
            if (replay.fingerprint !== input.creationFingerprint) throw new CreationIdempotencyConflictError()
            const version = await db
              .select()
              .from(environmentVersions)
              .where(eq(environmentVersions.id, replay.environment.status.currentVersionId ?? ''))
              .get()
            if (!version) throw new Error('Idempotent Environment creation is missing its initial version')
            return { environment: replay.environment, version: versionRecordFrom(version) }
          }
        }
        throw error
      }
      return { environment: environmentRecordFrom(environmentRow, 1), version: versionRecordFrom(versionRow) }
    },

    async update(projectId, environmentId, fields: UpdateEnvironmentFields, updatedAt) {
      const updated = await db
        .update(environments)
        .set({
          name: fields.name,
          description: fields.description,
          currentVersionId: fields.currentVersionId,
          updatedAt,
          ...configColumns(fields.config),
        })
        .where(
          and(
            eq(environments.id, environmentId),
            eq(environments.projectId, projectId),
            isNull(environments.deletedAt),
          ),
        )
        .returning({ id: environments.id })
      if (updated.length === 0) throw new ResourceDeletedDuringMutationError('Environment')
    },

    async delete(projectId, environmentId, deletedAt) {
      const activeLease = exists(
        db
          .select({ id: leases.id })
          .from(leases)
          .where(and(eq(leases.runnerId, runners.id), eq(leases.projectId, projectId), eq(leases.state, 'active'))),
      )
      const busyRunner = db
        .select({ id: runners.id })
        .from(runners)
        .where(
          and(
            eq(runners.projectId, projectId),
            eq(runners.environmentId, environmentId),
            isNull(runners.deletedAt),
            or(gt(runners.currentLoad, 0), activeLease),
          ),
        )
      const environmentDeletedByThisBatch = exists(
        db
          .select({ id: environments.id })
          .from(environments)
          .where(
            and(
              eq(environments.id, environmentId),
              eq(environments.projectId, projectId),
              eq(environments.deletedAt, deletedAt),
            ),
          ),
      )

      const [deletedEnvironments, deletedRunners, liveEnvironments] = await db.batch([
        db
          .update(environments)
          .set({ deletedAt, updatedAt: deletedAt })
          .where(
            and(
              eq(environments.id, environmentId),
              eq(environments.projectId, projectId),
              isNull(environments.deletedAt),
              notExists(busyRunner),
            ),
          )
          .returning({ id: environments.id }),
        db
          .update(runners)
          .set({ deletedAt, updatedAt: deletedAt, state: 'disabled' })
          .where(
            and(
              eq(runners.projectId, projectId),
              eq(runners.environmentId, environmentId),
              isNull(runners.deletedAt),
              environmentDeletedByThisBatch,
            ),
          )
          .returning({ id: runners.id }),
        db
          .select({ id: environments.id })
          .from(environments)
          .where(
            and(
              eq(environments.id, environmentId),
              eq(environments.projectId, projectId),
              isNull(environments.deletedAt),
            ),
          ),
      ])

      if (deletedEnvironments.length > 0) {
        return { status: 'deleted', runnerIds: deletedRunners.map(({ id }) => id) }
      }
      return liveEnvironments.length > 0 ? { status: 'conflict' } : { status: 'not_found' }
    },

    async connectorAvailable(connectorId) {
      const connector = await db
        .select({ availability: connectors.availability })
        .from(connectors)
        .where(eq(connectors.id, connectorId))
        .get()
      if (connector) {
        return connector.availability === 'available'
      }
      return DEFAULT_CONNECTORS.some((item) => item.id === connectorId && item.availability === 'available')
    },
  }
}
