import type { RunnerAuthMode } from '@server/domain/runner-queue'
import { effectiveRunnerState, runnerHeartbeatStaleBefore } from '@server/domain/runner-queue'
import type {
  CreateRunnerInput,
  ListPageResult,
  RunnerAuthRecord,
  RunnerHeartbeatFields,
  RunnerListQuery,
  RunnerRepo,
  RunnerRuntime,
  RuntimeUsage,
  UpdateRunnerFields,
} from '@server/usecases/ports'
import { and, desc, eq, gte, isNotNull, isNull, like, lt, lte, or, sql } from 'drizzle-orm'
import type { drizzle } from 'drizzle-orm/d1'
import { environments, runners, vaultCredentials, vaultCredentialVersions } from '../../db/schema'
import { credentialScopedSecretRef, credentialVersionSecretRef, secretRefIdentity } from '../../domain/vault'

type Db = ReturnType<typeof drizzle>
type RunnerRow = typeof runners.$inferSelect
// The DB column is a closed enum; the port types carry the value as a plain
// string, so writes/filters cast through this single schema-derived alias.
type RunnerStateColumn = RunnerRow['state']

function newId(prefix: string) {
  return `${prefix}_${crypto.randomUUID().replaceAll('-', '')}`
}

function parseJson<T>(value: string | null) {
  return value ? (JSON.parse(value) as T) : null
}

function parseRawJson<T>(value: string | null) {
  return value ? (JSON.parse(value) as T) : null
}

function stringify(value: unknown) {
  return JSON.stringify(value)
}

async function secretRefFromColumns(db: Db, row: RunnerRow) {
  if (!row.credentialId) {
    return null
  }
  if (row.credentialVersionId) {
    const version = await db
      .select({ vaultId: vaultCredentialVersions.vaultId })
      .from(vaultCredentialVersions)
      .where(
        and(
          eq(vaultCredentialVersions.id, row.credentialVersionId),
          eq(vaultCredentialVersions.credentialId, row.credentialId),
        ),
      )
      .get()
    return version
      ? credentialVersionSecretRef({
          vaultId: version.vaultId,
          credentialId: row.credentialId,
          versionId: row.credentialVersionId,
        })
      : null
  }
  const credential = await db
    .select({ vaultId: vaultCredentials.vaultId })
    .from(vaultCredentials)
    .where(eq(vaultCredentials.id, row.credentialId))
    .get()
  return credential ? credentialScopedSecretRef({ vaultId: credential.vaultId, credentialId: row.credentialId }) : null
}

async function recordFrom(db: Db, row: RunnerRow, now = new Date()): Promise<RunnerAuthRecord> {
  return {
    id: row.id,
    organizationId: row.organizationId,
    projectId: row.projectId,
    name: row.name,
    environmentId: row.environmentId,
    secretRef: await secretRefFromColumns(db, row),
    // DB text column constrained to the auth-mode set by every write path.
    authMode: row.authMode as RunnerAuthMode,
    state: effectiveRunnerState(row.state, row.lastHeartbeatAt, now),
    currentLoad: row.currentLoad,
    maxConcurrent: row.maxConcurrent,
    runtimeUsage: parseRawJson<RuntimeUsage[]>(row.runtimeUsage) ?? [],
    runtimes: parseRawJson<RunnerRuntime[]>(row.runtimes) ?? [],
    metadata: parseJson<Record<string, unknown>>(row.metadata) ?? {},
    oidcSubject: row.oidcSubject,
    oidcClientId: row.oidcClientId,
    lastHeartbeatAt: row.lastHeartbeatAt,
    archivedAt: row.archivedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

function stateFilter(state: RunnerStateColumn, staleBefore: string) {
  if (state === 'active') {
    return and(eq(runners.state, state), gte(runners.lastHeartbeatAt, staleBefore))
  }
  if (state === 'offline') {
    return or(
      eq(runners.state, 'offline'),
      and(eq(runners.state, 'active'), or(isNull(runners.lastHeartbeatAt), lt(runners.lastHeartbeatAt, staleBefore))),
    )
  }
  return eq(runners.state, state)
}

function columnsFromInput(input: CreateRunnerInput) {
  const identity = input.secretRef ? secretRefIdentity(input.secretRef) : null
  return {
    organizationId: input.organizationId,
    projectId: input.projectId,
    name: input.name,
    environmentId: input.environmentId,
    credentialId: identity?.credentialId ?? null,
    credentialVersionId: identity?.versionId ?? null,
    authMode: input.authMode,
    oidcSubject: input.oidcSubject,
    oidcClientId: input.oidcClientId,
    maxConcurrent: input.maxConcurrent,
    metadata: stringify(input.metadata),
  }
}

async function findRow(db: Db, projectId: string, runnerId: string): Promise<RunnerRow | null> {
  return (
    (await db
      .select()
      .from(runners)
      .where(and(eq(runners.id, runnerId), eq(runners.projectId, projectId)))
      .get()) ?? null
  )
}

export function createRunnerRepo(db: Db): RunnerRepo {
  return {
    async list(query: RunnerListQuery): Promise<ListPageResult<RunnerAuthRecord>> {
      const now = new Date()
      const staleBefore = runnerHeartbeatStaleBefore(now)
      const filters = [
        eq(runners.projectId, query.projectId),
        query.runnerId ? eq(runners.id, query.runnerId) : undefined,
        query.oidcSubject ? eq(runners.oidcSubject, query.oidcSubject) : undefined,
        query.oidcClientId ? eq(runners.oidcClientId, query.oidcClientId) : undefined,
        query.archived ? isNotNull(runners.archivedAt) : isNull(runners.archivedAt),
        query.state ? stateFilter(query.state as RunnerStateColumn, staleBefore) : undefined,
        query.environmentId ? eq(runners.environmentId, query.environmentId) : undefined,
        query.search ? like(runners.name, `%${query.search}%`) : undefined,
        query.createdFrom ? gte(runners.createdAt, query.createdFrom) : undefined,
        query.createdTo ? lte(runners.createdAt, query.createdTo) : undefined,
        query.cursor
          ? or(
              lt(runners.createdAt, query.cursor.createdAt),
              and(eq(runners.createdAt, query.cursor.createdAt), lt(runners.id, query.cursor.id)),
            )
          : undefined,
      ].filter((filter) => filter !== undefined)
      const rows = await db
        .select()
        .from(runners)
        .where(and(...filters))
        .orderBy(desc(runners.createdAt), desc(runners.id))
        .limit(query.limit + 1)
      const hasMore = rows.length > query.limit
      return { rows: await Promise.all(rows.slice(0, query.limit).map((row) => recordFrom(db, row, now))), hasMore }
    },

    async find(projectId, runnerId) {
      const row = await findRow(db, projectId, runnerId)
      return row ? recordFrom(db, row) : null
    },

    async findForMachineRegistration(projectId, authMode, oidcSubject, environmentId, machineId) {
      if (!machineId || authMode !== 'realmroot') {
        return null
      }
      const row = await db
        .select()
        .from(runners)
        .where(
          and(
            eq(runners.projectId, projectId),
            eq(runners.authMode, authMode),
            eq(runners.oidcSubject, oidcSubject),
            environmentId ? eq(runners.environmentId, environmentId) : isNull(runners.environmentId),
            sql`json_extract(${runners.metadata}, '$.machineId') = ${machineId}`,
          ),
        )
        .get()
      return row ? recordFrom(db, row) : null
    },

    async insert(input, timestamp) {
      const row = {
        id: newId('runner'),
        ...columnsFromInput(input),
        state: 'offline',
        currentLoad: 0,
        runtimeUsage: '[]',
        runtimes: '[]',
        lastHeartbeatAt: null,
        archivedAt: null,
        createdAt: timestamp,
        updatedAt: timestamp,
      } satisfies typeof runners.$inferInsert
      await db.insert(runners).values(row)
      const inserted = await findRow(db, input.projectId, row.id)
      if (!inserted) {
        throw new Error('Inserted runner row is required')
      }
      return recordFrom(db, inserted)
    },

    async reregister(projectId, runnerId, input, timestamp) {
      await db
        .update(runners)
        .set({ ...columnsFromInput(input), archivedAt: null, updatedAt: timestamp })
        .where(and(eq(runners.id, runnerId), eq(runners.projectId, projectId)))
      const row = await findRow(db, projectId, runnerId)
      if (!row) {
        throw new Error('Realmroot runner registration update did not return a runner')
      }
      return recordFrom(db, row)
    },

    async update(projectId, runnerId, fields: UpdateRunnerFields, timestamp) {
      await db
        .update(runners)
        .set({
          name: fields.name,
          state: fields.state as RunnerStateColumn,
          maxConcurrent: fields.maxConcurrent,
          metadata: stringify(fields.metadata),
          archivedAt: fields.archivedAt,
          updatedAt: timestamp,
        })
        .where(and(eq(runners.id, runnerId), eq(runners.projectId, projectId)))
      const row = await findRow(db, projectId, runnerId)
      if (!row) {
        throw new Error('Updated runner row is required')
      }
      return recordFrom(db, row)
    },

    async heartbeat(projectId, runnerId, fields: RunnerHeartbeatFields, timestamp) {
      await db
        .update(runners)
        .set({
          state: fields.state as RunnerStateColumn,
          runtimeUsage: stringify(fields.runtimeUsage),
          runtimes: stringify(fields.runtimes),
          metadata: stringify(fields.metadata),
          lastHeartbeatAt: timestamp,
          updatedAt: timestamp,
        })
        .where(and(eq(runners.id, runnerId), eq(runners.projectId, projectId)))
      const row = await findRow(db, projectId, runnerId)
      if (!row) {
        throw new Error('Heartbeat runner row is required')
      }
      return recordFrom(db, row)
    },

    async environmentUsable(projectId, environmentId) {
      const environment = await db
        .select({ id: environments.id })
        .from(environments)
        .where(
          and(
            eq(environments.id, environmentId),
            eq(environments.projectId, projectId),
            isNull(environments.archivedAt),
          ),
        )
        .get()
      return Boolean(environment)
    },

    async secretRefUsable(organizationId, projectId, secretRef: string) {
      const ref = secretRefIdentity(secretRef)
      if (!ref?.credentialId) {
        return { credentialMissing: true, versionMissing: false }
      }
      const credential = await db
        .select({ id: vaultCredentials.id })
        .from(vaultCredentials)
        .where(
          and(
            eq(vaultCredentials.id, ref.credentialId),
            eq(vaultCredentials.organizationId, organizationId),
            or(eq(vaultCredentials.projectId, projectId), isNull(vaultCredentials.projectId)),
            eq(vaultCredentials.state, 'active'),
          ),
        )
        .get()
      if (!credential) {
        return { credentialMissing: true, versionMissing: false }
      }
      if (ref.versionId) {
        const version = await db
          .select({ id: vaultCredentialVersions.id })
          .from(vaultCredentialVersions)
          .where(
            and(
              eq(vaultCredentialVersions.id, ref.versionId),
              eq(vaultCredentialVersions.credentialId, ref.credentialId),
              eq(vaultCredentialVersions.state, 'active'),
            ),
          )
          .get()
        if (!version) {
          return { credentialMissing: false, versionMissing: true }
        }
      }
      return { credentialMissing: false, versionMissing: false }
    },
  }
}
