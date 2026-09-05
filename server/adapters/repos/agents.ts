import type { Agent, AgentSpec, AgentSubagentReference, AgentVersion } from '@server/domain/agent'
import { DEFAULT_CONNECTORS } from '@server/domain/connector'
import type { IdentityDescriptor } from '@server/domain/identity'
import { resourceMetadata, resourcePhase } from '@server/domain/resource'
import { runnerHeartbeatStaleBefore } from '@server/domain/runner-queue'
import { newPrimaryKey } from '@server/id'
import type {
  AgentListPage,
  AgentListQuery,
  AgentRepo,
  CreateAgentInput,
  UpdateAgentFields,
} from '@server/usecases/ports'
import {
  AgentInboxIdentityConflictError,
  CreationIdempotencyConflictError,
  IdentityAlreadyBoundError,
  ResourceDeletedDuringMutationError,
} from '@server/usecases/ports'
import {
  and,
  desc,
  eq,
  getTableColumns,
  gte,
  inArray,
  isNotNull,
  isNull,
  like,
  lt,
  lte,
  notExists,
  or,
  sql,
} from 'drizzle-orm'
import type { drizzle } from 'drizzle-orm/d1'
import { agents, agentVersions, connectors, identities, providers, triggers } from '../../db/schema'
import { throwIfDeletedParentConstraint } from './soft-delete-constraints'

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
    subagents: parseJson<AgentSubagentReference[]>(row.subagents),
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

function agentRecordFrom(row: AgentRow, version: number, schedulable = false): Agent {
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
    spec: specFromRow(row),
    status: {
      phase: resourcePhase(row.deletedAt),
      currentVersionId: row.currentVersionId,
      version,
      schedulable,
    },
  }
}

function schedulableExpression() {
  const agentId = sql.raw('"agents"."id"')
  const projectId = sql.raw('"agents"."project_id"')
  const identityId = sql.raw('"agents"."identity_id"')
  const deletedAt = sql.raw('"agents"."deleted_at"')
  const providerId = sql.raw('"agents"."provider_id"')
  const model = sql.raw('"agents"."model"')
  const selectedModel = sql`case
    when ${providerId} is not null and ${model} like ${providerId} || '/%'
      then substr(${model}, length(${providerId}) + 2)
    else ${model}
  end`
  return sql<number>`case when ${deletedAt} is null and exists (
    select 1
    from identities scheduling_identity
    join triggers scheduling_trigger
      on scheduling_trigger.agent_id = ${agentId}
      and scheduling_trigger.project_id = ${projectId}
    where scheduling_identity.id = ${identityId}
      and scheduling_identity.project_id = ${projectId}
      and scheduling_identity.state = 'active'
      and scheduling_identity.deleted_at is null
      and scheduling_identity.bound_agent_id = ${agentId}
      and scheduling_trigger.trigger_type = 'inbox'
      and scheduling_trigger.enabled = 1
      and scheduling_trigger.deleted_at is null
      and scheduling_trigger.inbox_provisioning_state = 'active'
      and scheduling_trigger.inbox_registered_agent_subject = scheduling_identity.subject
      and scheduling_trigger.runtime = scheduling_identity.runtime
      and (
        exists (
          select 1
          from environments cloud_environment
          where cloud_environment.id = scheduling_trigger.environment_id
            and cloud_environment.project_id = ${projectId}
            and cloud_environment.deleted_at is null
            and cloud_environment.current_version_id is not null
            and cloud_environment.hosting_mode = 'cloud'
            and scheduling_trigger.runtime = 'enbor'
        )
        or exists (
          select 1
          from runners scheduling_runner
          join environments runner_environment
            on runner_environment.id = scheduling_runner.environment_id
            and runner_environment.project_id = scheduling_runner.project_id
          join json_each(scheduling_runner.runtimes) scheduling_runtime
          where scheduling_runner.project_id = ${projectId}
            and scheduling_runner.state = 'active'
            and scheduling_runner.deleted_at is null
            and scheduling_runner.last_heartbeat_at >= ${runnerHeartbeatStaleBefore()}
            and runner_environment.deleted_at is null
            and runner_environment.current_version_id is not null
            and runner_environment.hosting_mode = 'self_hosted'
            and (scheduling_trigger.environment_id is null or scheduling_trigger.environment_id = scheduling_runner.environment_id)
            and json_extract(scheduling_runtime.value, '$.runtime') = scheduling_trigger.runtime
            and json_extract(scheduling_runtime.value, '$.state') = 'ready'
            and (
              scheduling_trigger.runtime = 'enbor'
              or ${model} is null
              or exists (
                select 1
                from json_each(json_extract(scheduling_runtime.value, '$.models')) scheduling_model
                where scheduling_model.value = ${selectedModel}
              )
            )
        )
      )
  ) then 1 else 0 end`
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

async function findCreation(db: Db, projectId: string, creationKeyHash: string) {
  const schedulable = schedulableExpression()
  const row = await db
    .select({ ...getTableColumns(agents), schedulable })
    .from(agents)
    .where(and(eq(agents.projectId, projectId), eq(agents.creationKeyHash, creationKeyHash)))
    .get()
  if (!row?.creationFingerprint) return null
  if (row.deletedAt) throw new CreationIdempotencyConflictError('Idempotency-Key belongs to a deleted Agent')
  const initialVersion = await db
    .select()
    .from(agentVersions)
    .where(and(eq(agentVersions.agentId, row.id), eq(agentVersions.version, 1)))
    .get()
  if (!initialVersion) throw new Error('Idempotent Agent creation is missing its initial version')
  const agent = agentRecordFrom(
    {
      ...row,
      name: row.creationName ?? row.name,
      description: row.creationDescription,
      deletedAt: null,
      currentVersionId: initialVersion.id,
      updatedAt: row.createdAt,
    },
    1,
    false,
  )
  return {
    agent: {
      ...agent,
      spec: versionRecordFrom(initialVersion).spec,
      status: {
        ...agent.status,
        phase: resourcePhase(null),
        currentVersionId: initialVersion.id,
        version: 1,
        schedulable: false,
      },
    },
    fingerprint: row.creationFingerprint,
  }
}

export function createAgentRepo(db: Db): AgentRepo {
  return {
    async list(query: AgentListQuery): Promise<AgentListPage> {
      const schedulable = schedulableExpression()
      const identity = query.identityAgentId
        ? await db
            .select({ id: identities.id, boundAgentId: identities.boundAgentId })
            .from(identities)
            .where(
              and(
                eq(identities.projectId, query.projectId),
                eq(identities.remoteAgentId, query.identityAgentId),
                eq(identities.state, 'active'),
                isNull(identities.deletedAt),
              ),
            )
            .get()
        : null
      if (query.identityAgentId && !identity?.boundAgentId) {
        return { rows: [], hasMore: false }
      }
      const filters = [
        eq(agents.projectId, query.projectId),
        isNull(agents.deletedAt),
        identity?.boundAgentId ? eq(agents.id, identity.boundAgentId) : undefined,
        identity ? eq(agents.identityId, identity.id) : undefined,
        query.identityBound === undefined
          ? undefined
          : query.identityBound
            ? isNotNull(agents.identityId)
            : isNull(agents.identityId),
        query.runtime
          ? eq(sql<string>`json_extract(${agents.identitySnapshot}, '$.runtime')`, query.runtime)
          : undefined,
        query.schedulable !== undefined ? eq(schedulable, query.schedulable ? 1 : 0) : undefined,
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
        .select({ ...getTableColumns(agents), schedulable })
        .from(agents)
        .where(and(...filters))
        .orderBy(desc(agents.createdAt), desc(agents.id))
        .limit(query.limit + 1)
      const hasMore = rows.length > query.limit
      const page = rows.slice(0, query.limit)
      const records = await Promise.all(
        page.map(async (row) =>
          agentRecordFrom(row, await versionNumberOf(db, row.id, row.currentVersionId), Boolean(row.schedulable)),
        ),
      )
      return { rows: records, hasMore }
    },

    async find(projectId, agentId) {
      const schedulable = schedulableExpression()
      const row = await db
        .select({ ...getTableColumns(agents), schedulable })
        .from(agents)
        .where(and(eq(agents.id, agentId), eq(agents.projectId, projectId), isNull(agents.deletedAt)))
        .get()
      if (!row) {
        return null
      }
      return agentRecordFrom(row, await versionNumberOf(db, row.id, row.currentVersionId), Boolean(row.schedulable))
    },

    async findCreation(projectId, creationKeyHash) {
      return findCreation(db, projectId, creationKeyHash)
    },

    async liveAgents(projectId) {
      const schedulable = schedulableExpression()
      const rows = await db
        .select({ ...getTableColumns(agents), schedulable })
        .from(agents)
        .where(and(eq(agents.projectId, projectId), isNull(agents.deletedAt)))
        .orderBy(desc(agents.createdAt), desc(agents.id))
      return Promise.all(
        rows.map(async (row) =>
          agentRecordFrom(row, await versionNumberOf(db, row.id, row.currentVersionId), Boolean(row.schedulable)),
        ),
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
        deletedAt: null,
        currentVersionId: versionId,
        createdAt,
        updatedAt: createdAt,
        creationKeyHash: input.creationKeyHash ?? null,
        creationFingerprint: input.creationFingerprint ?? null,
        creationName: input.creationKeyHash ? input.name : null,
        creationDescription: input.creationKeyHash ? input.description : null,
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
        throwIfDeletedParentConstraint(error, 'Agent')
        if (input.creationKeyHash && input.creationFingerprint) {
          const replay = await findCreation(db, input.projectId, input.creationKeyHash)
          if (replay) {
            if (replay.fingerprint !== input.creationFingerprint) throw new CreationIdempotencyConflictError()
            const version = await db
              .select()
              .from(agentVersions)
              .where(eq(agentVersions.id, replay.agent.status.currentVersionId ?? ''))
              .get()
            if (!version) throw new Error('Idempotent Agent creation is missing its initial version')
            return { agent: replay.agent, version: versionRecordFrom(version) }
          }
        }
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
              currentVersionId: versionId,
              updatedAt,
              ...specColumns(fields.spec),
            })
            .where(
              and(
                eq(agents.id, agent.metadata.uid),
                eq(agents.projectId, projectId),
                isNull(agents.deletedAt),
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
                            isNull(triggers.deletedAt),
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
          const live = await db
            .select({ id: agents.id })
            .from(agents)
            .where(and(eq(agents.id, agent.metadata.uid), eq(agents.projectId, projectId), isNull(agents.deletedAt)))
            .get()
          if (!live) throw new ResourceDeletedDuringMutationError('Agent')
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
        const updated = await db
          .update(agents)
          .set({
            name: fields.name,
            description: fields.description,
            currentVersionId: fields.currentVersionId,
            updatedAt,
            ...specColumns(fields.spec),
          })
          .where(and(eq(agents.id, agentId), eq(agents.projectId, projectId), isNull(agents.deletedAt)))
          .returning({ id: agents.id })
        if (updated.length === 0) throw new ResourceDeletedDuringMutationError('Agent')
      } catch (error) {
        if (isIdentityBindingConflict(error)) throw new IdentityAlreadyBoundError()
        throw error
      }
    },

    async delete(projectId, agentId, deletedAt) {
      const rows = await db
        .update(agents)
        .set({ deletedAt, updatedAt: deletedAt })
        .where(and(eq(agents.id, agentId), eq(agents.projectId, projectId), isNull(agents.deletedAt)))
        .returning({ id: agents.id })
      return rows.length > 0
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
