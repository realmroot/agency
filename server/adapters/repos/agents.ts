import type { Agent, AgentSpec, AgentSubagent, AgentVersion } from '@server/domain/agent'
import { DEFAULT_CONNECTORS } from '@server/domain/connector'
import { resourceMetadata, resourcePhase } from '@server/domain/resource'
import type {
  AgentListPage,
  AgentListQuery,
  AgentRepo,
  CreateAgentInput,
  UpdateAgentFields,
} from '@server/usecases/ports'
import { and, asc, desc, eq, gte, inArray, isNotNull, isNull, like, lt, lte, or } from 'drizzle-orm'
import type { drizzle } from 'drizzle-orm/d1'
import { agents, agentVersions, connectors, providers } from '../../db/schema'

type Db = ReturnType<typeof drizzle>
type AgentRow = typeof agents.$inferSelect
type AgentVersionRow = typeof agentVersions.$inferSelect

function newId(prefix: string) {
  return `${prefix}_${crypto.randomUUID().replaceAll('-', '')}`
}

function parseJson<T>(value: string) {
  return JSON.parse(value) as T
}

function stringify(value: unknown) {
  return JSON.stringify(value)
}

function specFromRow(row: AgentRow | AgentVersionRow): AgentSpec {
  return {
    runtime: row.runtime,
    systemPrompt: row.systemPrompt,
    provider: row.providerId,
    model: row.model,
    skills: parseJson<string[]>(row.skills),
    subagents: parseJson<AgentSubagent[]>(row.subagents),
    allowedTools: parseJson<string[]>(row.allowedTools),
    mcpConnectors: parseJson<string[]>(row.mcpConnectors),
  }
}

function specColumns(spec: AgentSpec) {
  return {
    runtime: spec.runtime,
    systemPrompt: spec.systemPrompt,
    providerId: spec.provider,
    model: spec.model,
    skills: stringify(spec.skills),
    subagents: stringify(spec.subagents),
    allowedTools: stringify(spec.allowedTools),
    mcpConnectors: stringify(spec.mcpConnectors),
  }
}

function committedAgent() {
  return and(isNotNull(agents.currentVersionId), isNotNull(agents.identityCredentialRef))!
}

async function versionNumberOf(db: Db, agentId: string, versionId: string | null) {
  if (!versionId) {
    return 0
  }
  const row = await db
    .select({ version: agentVersions.version })
    .from(agentVersions)
    .where(and(eq(agentVersions.id, versionId), eq(agentVersions.agentId, agentId)))
    .get()
  return row?.version ?? 0
}

function agentRecordFrom(row: AgentRow, version: number): Agent {
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
    identity: {
      issuer: row.identityIssuer,
      subject: row.identitySubject,
      username: row.username,
      runtime: 'ama',
      credentialRef: row.identityCredentialRef ?? '',
    },
    spec: specFromRow(row),
    status: {
      phase:
        row.retirementState === 'retired'
          ? 'retired'
          : row.retirementState
            ? 'retiring'
            : resourcePhase(row.archivedAt),
      ready: !row.archivedAt && !row.retirementState && Boolean(row.currentVersionId && row.identityCredentialRef),
      retirementStage: row.retirementState,
      currentVersionId: row.currentVersionId,
      version,
    },
  }
}

function versionRecordFrom(row: AgentVersionRow): AgentVersion {
  return {
    metadata: resourceMetadata({
      uid: row.id,
      pid: row.projectId,
      name: `v${row.version}`,
      createdAt: row.createdAt,
      updatedAt: row.createdAt,
    }),
    spec: specFromRow(row),
    status: {
      agentId: row.agentId,
      version: row.version,
    },
  }
}

export function createAgentRepo(db: Db): AgentRepo {
  return {
    async list(query: AgentListQuery): Promise<AgentListPage> {
      const filters = [
        eq(agents.projectId, query.projectId),
        committedAgent(),
        query.archived ? isNotNull(agents.archivedAt) : isNull(agents.archivedAt),
        query.archived ? undefined : isNull(agents.retirementState),
        query.search ? like(agents.name, `%${query.search}%`) : undefined,
        query.createdFrom ? gte(agents.createdAt, query.createdFrom) : undefined,
        query.createdTo ? lte(agents.createdAt, query.createdTo) : undefined,
        query.identityIssuer ? eq(agents.identityIssuer, query.identityIssuer) : undefined,
        query.identitySubject ? eq(agents.identitySubject, query.identitySubject) : undefined,
        query.cursor
          ? or(
              lt(agents.createdAt, query.cursor.createdAt),
              and(eq(agents.createdAt, query.cursor.createdAt), lt(agents.id, query.cursor.id)),
            )
          : undefined,
      ].filter((filter) => filter !== undefined)
      const rows = await db
        .select()
        .from(agents)
        .where(and(...filters))
        .orderBy(desc(agents.createdAt), desc(agents.id))
        .limit(query.limit + 1)
      const hasMore = rows.length > query.limit
      const page = rows.slice(0, query.limit)
      const records = await Promise.all(
        page.map(async (row) => agentRecordFrom(row, await versionNumberOf(db, row.id, row.currentVersionId))),
      )
      return { rows: records, hasMore }
    },

    async find(projectId, agentId) {
      const row = await db
        .select()
        .from(agents)
        .where(and(eq(agents.id, agentId), eq(agents.projectId, projectId), committedAgent()))
        .get()
      if (!row) {
        return null
      }
      return agentRecordFrom(row, await versionNumberOf(db, row.id, row.currentVersionId))
    },

    async liveAgents(projectId) {
      const rows = await db
        .select()
        .from(agents)
        .where(
          and(
            eq(agents.projectId, projectId),
            isNull(agents.archivedAt),
            isNull(agents.retirementState),
            committedAgent(),
          ),
        )
        .orderBy(desc(agents.createdAt), desc(agents.id))
      return Promise.all(
        rows.map(async (row) => agentRecordFrom(row, await versionNumberOf(db, row.id, row.currentVersionId))),
      )
    },

    async latestVersionNumber(agentId) {
      const row = await db
        .select({ version: agentVersions.version })
        .from(agentVersions)
        .where(eq(agentVersions.agentId, agentId))
        .orderBy(desc(agentVersions.version))
        .limit(1)
        .get()
      return row?.version ?? null
    },

    async insertVersion(agent, spec, createdAt): Promise<AgentVersion> {
      const latest = await this.latestVersionNumber(agent.metadata.uid)
      const row = {
        id: newId('agentver'),
        agentId: agent.metadata.uid,
        projectId: agent.metadata.pid ?? '',
        version: (latest ?? 0) + 1,
        createdAt,
        ...specColumns(spec),
      }
      await db.insert(agentVersions).values(row)
      return versionRecordFrom(row)
    },

    async listVersions(projectId, agentId) {
      const rows = await db
        .select()
        .from(agentVersions)
        .where(and(eq(agentVersions.agentId, agentId), eq(agentVersions.projectId, projectId)))
        .orderBy(desc(agentVersions.version))
      return rows.map(versionRecordFrom)
    },

    async findVersion(projectId, agentId, version) {
      const row = await db
        .select()
        .from(agentVersions)
        .where(
          and(
            eq(agentVersions.agentId, agentId),
            eq(agentVersions.projectId, projectId),
            eq(agentVersions.version, version),
          ),
        )
        .get()
      return row ? versionRecordFrom(row) : null
    },

    async insert(input: CreateAgentInput, createdAt): Promise<Agent> {
      const row = {
        id: input.id ?? newId('agent'),
        projectId: input.projectId,
        name: input.name,
        username: input.username,
        description: input.description,
        archivedAt: null,
        retirementState: null,
        retiredAt: null,
        currentVersionId: null,
        createdAt,
        updatedAt: createdAt,
        identityIssuer: input.identity.issuer,
        identitySubject: input.identity.subject,
        identityCredentialRef: input.identity.credentialRef,
        ...specColumns(input.spec),
      }
      await db.insert(agents).values(row)
      return agentRecordFrom(row, 0)
    },

    async createWithInitialVersion(input, versionId, createdAt) {
      const agentRow = {
        id: input.id,
        projectId: input.projectId,
        name: input.name,
        username: input.username,
        description: input.description,
        archivedAt: null,
        retirementState: null,
        retiredAt: null,
        // Visibility is committed only after the immutable v1 row exists. A
        // null pointer is a durable, retryable creation checkpoint and is
        // excluded by committedAgent() from every public lookup/list path.
        currentVersionId: null,
        createdAt,
        updatedAt: createdAt,
        identityIssuer: input.identity.issuer,
        identitySubject: input.identity.subject,
        identityCredentialRef: input.identity.credentialRef,
        ...specColumns(input.spec),
      } satisfies typeof agents.$inferInsert
      const versionRow = {
        id: versionId,
        agentId: input.id,
        projectId: input.projectId,
        version: 1,
        createdAt,
        ...specColumns(input.spec),
      } satisfies typeof agentVersions.$inferInsert
      // D1 batches from two concurrent requests can both advance past an
      // INSERT ... ON CONFLICT before the winning batch commits, leaving the
      // losing batch unable to satisfy agent_versions' FK. Persist the hidden
      // Agent checkpoint first, then create v1, then publish the pointer. Each
      // statement is idempotent and a crash at either boundary is completed by
      // the next request without exposing a partial Agent.
      await db.insert(agents).values(agentRow).onConflictDoNothing()
      const persistedCheckpoint = await db.select().from(agents).where(eq(agents.id, input.id)).get()
      if (
        !persistedCheckpoint ||
        persistedCheckpoint.projectId !== input.projectId ||
        persistedCheckpoint.username !== input.username ||
        persistedCheckpoint.name !== input.name ||
        persistedCheckpoint.description !== input.description ||
        persistedCheckpoint.identityIssuer !== input.identity.issuer ||
        persistedCheckpoint.identitySubject !== input.identity.subject ||
        persistedCheckpoint.identityCredentialRef !== input.identity.credentialRef ||
        (persistedCheckpoint.currentVersionId !== null && persistedCheckpoint.currentVersionId !== versionId) ||
        JSON.stringify(specFromRow(persistedCheckpoint)) !== JSON.stringify(input.spec)
      ) {
        throw new Error('Agent creation idempotency state conflicts with persisted Agent data')
      }
      await db.insert(agentVersions).values(versionRow).onConflictDoNothing()
      const persistedVersion = await db.select().from(agentVersions).where(eq(agentVersions.id, versionId)).get()
      if (
        !persistedVersion ||
        persistedVersion.agentId !== input.id ||
        persistedVersion.projectId !== input.projectId ||
        persistedVersion.version !== 1 ||
        JSON.stringify(specFromRow(persistedVersion)) !== JSON.stringify(input.spec)
      ) {
        throw new Error('Agent creation idempotency state conflicts with persisted Agent version data')
      }
      await db
        .update(agents)
        .set({ currentVersionId: versionId })
        .where(
          and(eq(agents.id, input.id), or(isNull(agents.currentVersionId), eq(agents.currentVersionId, versionId))),
        )
      const persistedAgent = await db.select().from(agents).where(eq(agents.id, input.id)).get()
      if (
        !persistedAgent ||
        persistedAgent.projectId !== input.projectId ||
        persistedAgent.username !== input.username ||
        persistedAgent.name !== input.name ||
        persistedAgent.description !== input.description ||
        persistedAgent.identityIssuer !== input.identity.issuer ||
        persistedAgent.identitySubject !== input.identity.subject ||
        persistedAgent.identityCredentialRef !== input.identity.credentialRef ||
        persistedAgent.currentVersionId !== versionId ||
        JSON.stringify(specFromRow(persistedAgent)) !== JSON.stringify(input.spec)
      ) {
        throw new Error('Agent creation idempotency state conflicts with persisted Agent data')
      }
      return agentRecordFrom(persistedAgent, 1)
    },

    async setCurrentVersion(agentId, versionId) {
      await db.update(agents).set({ currentVersionId: versionId }).where(eq(agents.id, agentId))
    },

    async update(projectId, agentId, fields: UpdateAgentFields, updatedAt) {
      await db
        .update(agents)
        .set({
          name: fields.name,
          description: fields.description,
          archivedAt: fields.archivedAt,
          currentVersionId: fields.currentVersionId,
          updatedAt,
          ...specColumns(fields.spec),
        })
        .where(and(eq(agents.id, agentId), eq(agents.projectId, projectId)))
    },

    async unarchive(projectId, agentId, updatedAt) {
      await db
        .update(agents)
        .set({ archivedAt: null, updatedAt })
        .where(and(eq(agents.id, agentId), eq(agents.projectId, projectId)))
    },

    async delete(projectId, agentId) {
      await db.delete(agents).where(and(eq(agents.id, agentId), eq(agents.projectId, projectId)))
    },

    async markRetirement(projectId, agentId, state, timestamp) {
      await db
        .update(agents)
        .set({
          retirementState: state,
          ...(state === 'retired' ? { retiredAt: timestamp, identityCredentialRef: null } : {}),
          updatedAt: timestamp,
        })
        .where(and(eq(agents.id, agentId), eq(agents.projectId, projectId)))
    },

    async retiring(limit) {
      const rows = await db
        .select()
        .from(agents)
        .where(and(inArray(agents.retirementState, ['stopping', 'identity_retired']), committedAgent()))
        .orderBy(asc(agents.updatedAt))
        .limit(limit)
      return await Promise.all(
        rows.map(async (row) => agentRecordFrom(row, await versionNumberOf(db, row.id, row.currentVersionId))),
      )
    },

    async providerEnabled(_projectId, providerId) {
      const provider = await db
        .select({ enabled: providers.enabled })
        .from(providers)
        .where(eq(providers.id, providerId))
        .get()
      return Boolean(provider?.enabled)
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
