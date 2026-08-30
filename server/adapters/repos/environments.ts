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
  CreateEnvironmentInput,
  EnvironmentListPage,
  EnvironmentListQuery,
  EnvironmentRepo,
  UpdateEnvironmentFields,
} from '@server/usecases/ports'
import { and, desc, eq, gte, isNotNull, isNull, like, lt, lte, or } from 'drizzle-orm'
import type { drizzle } from 'drizzle-orm/d1'
import { connectors, environments, environmentVersions } from '../../db/schema'
import { DEFAULT_CONNECTORS } from '../../domain/connector'

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
      archivedAt: row.archivedAt,
    }),
    spec: configFromRow(row),
    status: {
      phase: resourcePhase(row.archivedAt),
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

export function createEnvironmentRepo(db: Db): EnvironmentRepo {
  return {
    async list(query: EnvironmentListQuery): Promise<EnvironmentListPage> {
      const filters = [
        eq(environments.projectId, query.projectId),
        query.archived ? isNotNull(environments.archivedAt) : isNull(environments.archivedAt),
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
        .where(and(eq(environments.id, environmentId), eq(environments.projectId, projectId)))
        .get()
      if (!row) {
        return null
      }
      return environmentRecordFrom(row, await versionNumberOf(db, row.id, row.currentVersionId))
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
      await db.insert(environmentVersions).values(row)
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

    async insert(input: CreateEnvironmentInput, createdAt): Promise<Environment> {
      const row = {
        id: newPrimaryKey(),
        projectId: input.projectId,
        name: input.name,
        description: input.description,
        archivedAt: null,
        currentVersionId: null,
        createdAt,
        updatedAt: createdAt,
        ...configColumns(input.config),
      }
      await db.insert(environments).values(row)
      return environmentRecordFrom(row, 0)
    },

    async setCurrentVersion(environmentId, versionId) {
      await db.update(environments).set({ currentVersionId: versionId }).where(eq(environments.id, environmentId))
    },

    async update(projectId, environmentId, fields: UpdateEnvironmentFields, updatedAt) {
      await db
        .update(environments)
        .set({
          name: fields.name,
          description: fields.description,
          archivedAt: fields.archivedAt,
          currentVersionId: fields.currentVersionId,
          updatedAt,
          ...configColumns(fields.config),
        })
        .where(and(eq(environments.id, environmentId), eq(environments.projectId, projectId)))
    },

    async unarchive(projectId, environmentId, updatedAt) {
      await db
        .update(environments)
        .set({ archivedAt: null, updatedAt })
        .where(and(eq(environments.id, environmentId), eq(environments.projectId, projectId)))
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
