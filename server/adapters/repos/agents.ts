import type { Agent, AgentSpec, AgentSubagent, AgentVersion } from '@server/domain/agent'
import { DEFAULT_CONNECTORS } from '@server/domain/connector'
import type { IdentityDescriptor } from '@server/domain/identity'
import { resourceMetadata, resourcePhase } from '@server/domain/resource'
import { newPrimaryKey } from '@server/id'
import type {
  AgentListPage,
  AgentListQuery,
  AgentRepo,
  CreateAgentInput,
  UpdateAgentFields,
} from '@server/usecases/ports'
import { AgentInboxIdentityConflictError, IdentityAlreadyBoundError } from '@server/usecases/ports'
import { and, desc, eq, gte, inArray, isNotNull, isNull, like, lt, lte, notExists, or, sql } from 'drizzle-orm'
import type { drizzle } from 'drizzle-orm/d1'
import { agents, agentVersions, connectors, identities, providers, triggers } from '../../db/schema'

type Db = ReturnType<typeof drizzle>
type AgentRow = typeof agents.$inferSelect
type AgentVersionRow = typeof agentVersions.$inferSelect

function parseJson<T>(value: string) {
  return JSON.parse(value) as T
}

function stringify(value: unknown) {
  return JSON.stringify(value)
}

function isIdentityBindingConflict(error: unknown) {
  let current: unknown = error
  for (let depth = 0; depth < 4 && current instanceof Error; depth += 1) {
    if (current.message.includes('identity_already_bound')) return true
    current = current.cause
  }
  return false
}

function specFromRow(row: AgentRow | AgentVersionRow): AgentSpec {
  return {
    systemPrompt: row.systemPrompt,
    provider: row.providerId,
    model: row.model,
    skills: parseJson<string[]>(row.skills),
    subagents: parseJson<AgentSubagent[]>(row.subagents),
    allowedTools: parseJson<string[]>(row.allowedTools),
    mcpConnectors: parseJson<string[]>(row.mcpConnectors),
    identity: row.identitySnapshot ? parseJson<IdentityDescriptor>(row.identitySnapshot) : null,
  }
}

function specColumns(spec: AgentSpec) {
  return {
    systemPrompt: spec.systemPrompt,
    providerId: spec.provider,
    model: spec.model,
    skills: stringify(spec.skills),
    subagents: stringify(spec.subagents),
    allowedTools: stringify(spec.allowedTools),
    mcpConnectors: stringify(spec.mcpConnectors),
    identityId: spec.identity?.identityId ?? null,
    identitySnapshot: spec.identity ? stringify(spec.identity) : null,
  }
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
    spec: specFromRow(row),
    status: {
      phase: resourcePhase(row.archivedAt),
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
      const identity = query.identityAgentId
        ? await db
            .select({ id: identities.id, boundAgentId: identities.boundAgentId })
            .from(identities)
            .where(
              and(
                eq(identities.projectId, query.projectId),
                eq(identities.remoteAgentId, query.identityAgentId),
                eq(identities.state, 'active'),
                isNull(identities.archivedAt),
              ),
            )
            .get()
        : null
      if (query.identityAgentId && !identity?.boundAgentId) {
        return { rows: [], hasMore: false }
      }
      const filters = [
        eq(agents.projectId, query.projectId),
        query.archived ? isNotNull(agents.archivedAt) : isNull(agents.archivedAt),
        identity?.boundAgentId ? eq(agents.id, identity.boundAgentId) : undefined,
        identity ? eq(agents.identityId, identity.id) : undefined,
        query.search ? like(agents.name, `%${query.search}%`) : undefined,
        query.createdFrom ? gte(agents.createdAt, query.createdFrom) : undefined,
        query.createdTo ? lte(agents.createdAt, query.createdTo) : undefined,
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
        .where(and(eq(agents.id, agentId), eq(agents.projectId, projectId)))
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
        .where(and(eq(agents.projectId, projectId), isNull(agents.archivedAt)))
        .orderBy(desc(agents.createdAt), desc(agents.id))
      return Promise.all(
        rows.map(async (row) => agentRecordFrom(row, await versionNumberOf(db, row.id, row.currentVersionId))),
      )
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

    async insertWithVersion(input: CreateAgentInput, createdAt) {
      const agentId = newPrimaryKey()
      const versionId = newPrimaryKey()
      const row = {
        id: agentId,
        projectId: input.projectId,
        name: input.name,
        description: input.description,
        archivedAt: null,
        currentVersionId: versionId,
        createdAt,
        updatedAt: createdAt,
        ...specColumns(input.spec),
      }
      const versionRow = {
        id: versionId,
        agentId,
        projectId: input.projectId,
        version: 1,
        createdAt,
        ...specColumns(input.spec),
      }
      try {
        await db.batch([db.insert(agents).values(row), db.insert(agentVersions).values(versionRow)])
      } catch (error) {
        if (isIdentityBindingConflict(error)) throw new IdentityAlreadyBoundError()
        throw error
      }
      return { agent: agentRecordFrom(row, 1), version: versionRecordFrom(versionRow) }
    },

    async updateWithVersion(projectId, agent, fields, updatedAt) {
      const versionId = newPrimaryKey()
      const identityChanged = fields.spec.identity?.identityId !== agent.spec.identity?.identityId
      const versionSpec = specColumns(fields.spec)
      const versionRow = {
        id: versionId,
        agentId: agent.metadata.uid,
        projectId,
        version: agent.status.version + 1,
        createdAt: updatedAt,
        ...versionSpec,
      }
      try {
        const [updated, inserted] = await db.batch([
          db
            .update(agents)
            .set({
              name: fields.name,
              description: fields.description,
              archivedAt: fields.archivedAt,
              currentVersionId: versionId,
              updatedAt,
              ...specColumns(fields.spec),
            })
            .where(
              and(
                eq(agents.id, agent.metadata.uid),
                eq(agents.projectId, projectId),
                identityChanged
                  ? notExists(
                      db
                        .select({ id: triggers.id })
                        .from(triggers)
                        .where(
                          and(
                            eq(triggers.projectId, projectId),
                            eq(triggers.agentId, agent.metadata.uid),
                            eq(triggers.triggerType, 'inbox'),
                            eq(triggers.enabled, true),
                            isNull(triggers.archivedAt),
                            inArray(triggers.inboxProvisioningState, ['pending', 'active', 'error']),
                          ),
                        ),
                    )
                  : undefined,
              ),
            )
            .returning({ id: agents.id }),
          db
            .insert(agentVersions)
            .select(
              db
                .select({
                  id: sql<string>`${versionRow.id}`.as('id'),
                  agentId: sql<string>`${versionRow.agentId}`.as('agent_id'),
                  projectId: sql<string>`${versionRow.projectId}`.as('project_id'),
                  version: sql<number>`${versionRow.version}`.as('version'),
                  systemPrompt: sql<string>`${versionSpec.systemPrompt}`.as('system_prompt'),
                  providerId: sql<string | null>`${versionSpec.providerId}`.as('provider_id'),
                  model: sql<string | null>`${versionSpec.model}`.as('model'),
                  skills: sql<string>`${versionSpec.skills}`.as('skills'),
                  subagents: sql<string>`${versionSpec.subagents}`.as('subagents'),
                  allowedTools: sql<string>`${versionSpec.allowedTools}`.as('allowed_tools'),
                  mcpConnectors: sql<string>`${versionSpec.mcpConnectors}`.as('mcp_connectors'),
                  identityId: sql<string | null>`${versionSpec.identityId}`.as('identity_id'),
                  identitySnapshot: sql<string | null>`${versionSpec.identitySnapshot}`.as('identity_snapshot'),
                  createdAt: sql<string>`${versionRow.createdAt}`.as('created_at'),
                })
                .from(agents)
                .where(
                  and(
                    eq(agents.id, agent.metadata.uid),
                    eq(agents.projectId, projectId),
                    eq(agents.currentVersionId, versionId),
                  ),
                ),
            )
            .returning({ id: agentVersions.id }),
        ])
        if (updated.length === 0) {
          if (identityChanged) throw new AgentInboxIdentityConflictError()
          throw new Error('Agent update affected no rows')
        }
        if (inserted.length === 0) throw new Error('Agent version insert affected no rows')
      } catch (error) {
        if (error instanceof AgentInboxIdentityConflictError) throw error
        if (isIdentityBindingConflict(error)) throw new IdentityAlreadyBoundError()
        throw error
      }
      return versionRecordFrom(versionRow)
    },

    async update(projectId, agentId, fields: UpdateAgentFields, updatedAt) {
      try {
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
      } catch (error) {
        if (isIdentityBindingConflict(error)) throw new IdentityAlreadyBoundError()
        throw error
      }
    },

    async unarchive(projectId, agentId, updatedAt) {
      await db
        .update(agents)
        .set({ archivedAt: null, updatedAt })
        .where(and(eq(agents.id, agentId), eq(agents.projectId, projectId)))
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
