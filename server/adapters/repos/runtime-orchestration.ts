import { parseJson } from '@server/domain/runtime/session-snapshot'
import { runtimesSupport } from '@server/domain/runtime-catalog'
import { secretRefIdentity, vaultIdFromRef } from '@server/domain/vault'
import { AMA_ANNOTATION_KEY_SESSION_IDLE_TIMEOUT_SECONDS } from '@server/metadata-keys'
import type { ConnectorRecord, RunnerRuntime, SessionOrchestrationStore } from '@server/usecases/ports'
import type {
  AgentRow,
  AgentVersionRow,
  EnvironmentRow,
  EnvironmentVersionRow,
  SessionApprovalInsert,
  SessionInsert,
  SessionRow,
  SessionUpdate,
  WorkItemInsert,
  WorkItemRow,
} from '@shared/runtime-rows'
import { and, asc, desc, eq, inArray, isNotNull, isNull, lt, ne, notLike, or, sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import {
  agents,
  agentVersions,
  connectors,
  environments,
  environmentVersions,
  leases,
  memoryStoreMemories,
  memoryStores,
  runners,
  sessionApprovals,
  sessionChannels,
  sessionEvents,
  sessions,
  vaultCredentials,
  vaultCredentialVersions,
  workItems,
} from '../../db/schema'
import { domainSessionState, persistedSessionState, persistedSessionStates } from '../../db/session-state'
import { type ConnectorCatalogEntry, DEFAULT_CONNECTORS } from '../../domain/connector'
import { amaMemoryRef, memoryStoreMountPath } from '../../domain/memory-store'

type Db = ReturnType<typeof drizzle>

// The store's row shapes are the plain shared types (so usecases/ports can name
// the SessionOrchestrationStore boundary without drizzle). The drizzle
// $inferSelect rows are structurally assignable to them, verified by typecheck.
export type {
  AgentRow,
  AgentVersionRow,
  EnvironmentRow,
  EnvironmentVersionRow,
  SessionRow,
  WorkItemRow,
} from '@shared/runtime-rows'

// The store boundary names the plain shared row shapes (string-typed
// discriminators). Drizzle's enum-narrowed insert/update types are stricter, so
// writes cast through these schema-derived aliases at the .values()/.set() call.
type SessionInsertColumns = typeof sessions.$inferInsert
type SessionUpdateColumns = Partial<typeof sessions.$inferInsert>
type SessionStateColumn = (typeof sessions.$inferSelect)['state']
type WorkItemInsertColumns = typeof workItems.$inferInsert
type SessionApprovalInsertColumns = typeof sessionApprovals.$inferInsert
type ConnectorRow = typeof connectors.$inferSelect
const STATIC_CATALOG_TIMESTAMP = '1970-01-01T00:00:00.000Z'

function connectorRecordFrom(row: ConnectorRow): ConnectorRecord {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    category: row.category as ConnectorRecord['category'],
    trustLevel: row.trustLevel as ConnectorRecord['trustLevel'],
    capabilities: parseJson<string[]>(row.capabilities) ?? [],
    supportedAuthModes: parseJson<ConnectorRecord['supportedAuthModes']>(row.supportedAuthModes) ?? [],
    setupRequirements: parseJson<string[]>(row.setupRequirements) ?? [],
    tools: parseJson<ConnectorRecord['tools']>(row.tools) ?? [],
    metadata: parseJson<Record<string, unknown>>(row.metadata) ?? {},
    availability: row.availability as ConnectorRecord['availability'],
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

function staticConnectorRecordFrom(connector: ConnectorCatalogEntry): ConnectorRecord {
  return {
    id: connector.id,
    name: connector.name,
    description: connector.description,
    category: connector.category,
    trustLevel: connector.trustLevel,
    capabilities: [...connector.capabilities],
    supportedAuthModes: [...connector.supportedAuthModes],
    setupRequirements: [...connector.setupRequirements],
    tools: [...connector.tools],
    metadata: { ...connector.metadata },
    availability: connector.availability,
    createdAt: STATIC_CATALOG_TIMESTAMP,
    updatedAt: STATIC_CATALOG_TIMESTAMP,
  }
}

function domainSessionRow<T extends SessionRow | null>(row: T): T {
  return row ? ({ ...row, state: domainSessionState(row.state) } as T) : row
}

function persistedSessionWrite<T extends SessionInsert | SessionUpdate>(fields: T): T {
  return typeof fields.state === 'string' ? ({ ...fields, state: persistedSessionState(fields.state) } as T) : fields
}

function sessionStateGuard(expected: string | string[]) {
  return Array.isArray(expected)
    ? or(...persistedSessionStates(expected).map((state) => eq(sessions.state, state as SessionStateColumn)))
    : eq(sessions.state, persistedSessionState(expected) as SessionStateColumn)
}

// Runtime-internal persistence boundary. The env-bound session execution engine
// (server/runtime/*) routes every drizzle read/write here so the runtime layer
// itself stays drizzle-free. This repo is intentionally runtime-shaped (raw
// session rows, work-item/lease/channel mechanics, snapshot reads) — distinct
// from the REST-facing SessionRepo, which serializes DTOs. Both are the only
// places these tables are touched.
export function createRuntimeOrchestrationRepo(db: Db): SessionOrchestrationStore & { db: Db } {
  return {
    // The persistence handle the runtime forwards to the cross-cutting policy
    // engine (server/policy.ts), which routes its own reads through repos. The
    // handle is not part of the SessionOrchestrationStore port surface; it stays
    // on the concrete repo for the current direct-db callers (removed in a later
    // step) and never leaves for ad-hoc drizzle use in runtime/.
    db,

    // ── session reads ─────────────────────────────────────────────────────
    async findSession(projectId: string, sessionId: string): Promise<SessionRow | null> {
      return domainSessionRow(
        (await db
          .select()
          .from(sessions)
          .where(and(eq(sessions.id, sessionId), eq(sessions.projectId, projectId)))
          .get()) ?? null,
      )
    },

    async sessionState(projectId: string, sessionId: string): Promise<{ state: string } | null> {
      const row =
        (await db
          .select({ state: sessions.state })
          .from(sessions)
          .where(and(eq(sessions.id, sessionId), eq(sessions.projectId, projectId)))
          .get()) ?? null
      return row ? { state: domainSessionState(row.state) } : null
    },

    async sessionMetadata(projectId: string, sessionId: string): Promise<{ metadata: string | null } | null> {
      return (
        (await db
          .select({ metadata: sessions.metadata })
          .from(sessions)
          .where(and(eq(sessions.id, sessionId), eq(sessions.projectId, projectId)))
          .get()) ?? null
      )
    },

    // ── session writes ────────────────────────────────────────────────────
    async insertSession(row: SessionInsert): Promise<void> {
      await db.insert(sessions).values(persistedSessionWrite(row) as SessionInsertColumns)
    },

    async updateSession(projectId: string, sessionId: string, fields: SessionUpdate): Promise<void> {
      await db
        .update(sessions)
        .set(persistedSessionWrite(fields) as SessionUpdateColumns)
        .where(and(eq(sessions.id, sessionId), eq(sessions.projectId, projectId)))
    },

    // Conditional state transition; returns true when the guarded row matched.
    async updateSessionWhenState(
      projectId: string,
      sessionId: string,
      expected: string | string[],
      fields: SessionUpdate,
    ): Promise<boolean> {
      const stateGuard = sessionStateGuard(expected)
      const updated = await db
        .update(sessions)
        .set(persistedSessionWrite(fields) as SessionUpdateColumns)
        .where(and(eq(sessions.id, sessionId), eq(sessions.projectId, projectId), stateGuard))
        .returning({ id: sessions.id })
        .get()
      return Boolean(updated)
    },

    async queueSessionWorkWhenState(
      projectId: string,
      sessionId: string,
      expected: string | string[],
      fields: SessionUpdate,
      workItem: WorkItemInsert,
    ): Promise<boolean> {
      if (typeof fields.state !== 'string' || typeof fields.updatedAt !== 'string') {
        throw new Error('Queued session work requires state and updatedAt session fields')
      }
      const [updated, inserted] = await db.batch([
        db
          .update(sessions)
          .set(persistedSessionWrite(fields) as SessionUpdateColumns)
          .where(and(eq(sessions.id, sessionId), eq(sessions.projectId, projectId), sessionStateGuard(expected)))
          .returning({ id: sessions.id }),
        db
          .insert(workItems)
          .select(
            db
              .select({
                id: sql<string>`${workItem.id}`.as('id'),
                organizationId: sql<string>`${workItem.organizationId}`.as('organization_id'),
                projectId: sql<string>`${workItem.projectId}`.as('project_id'),
                sessionId: sql<string | null>`${workItem.sessionId ?? null}`.as('session_id'),
                environmentId: sql<string | null>`${workItem.environmentId ?? null}`.as('environment_id'),
                runnerId: sql<string | null>`${workItem.runnerId ?? null}`.as('runner_id'),
                leaseId: sql<string | null>`${workItem.leaseId ?? null}`.as('lease_id'),
                type: sql<string>`${workItem.type}`.as('type'),
                state: sql<string>`${workItem.state ?? 'available'}`.as('state'),
                priority: sql<number>`${workItem.priority ?? 0}`.as('priority'),
                attempts: sql<number>`${workItem.attempts ?? 0}`.as('attempts'),
                maxAttempts: sql<number>`${workItem.maxAttempts ?? 3}`.as('max_attempts'),
                payload: sql<string>`${workItem.payload}`.as('payload'),
                result: sql<string | null>`${workItem.result ?? null}`.as('result'),
                error: sql<string | null>`${workItem.error ?? null}`.as('error'),
                availableAt: sql<string>`${workItem.availableAt}`.as('available_at'),
                createdAt: sql<string>`${workItem.createdAt}`.as('created_at'),
                updatedAt: sql<string>`${workItem.updatedAt}`.as('updated_at'),
              })
              .from(sessions)
              .where(
                and(
                  eq(sessions.id, sessionId),
                  eq(sessions.projectId, projectId),
                  eq(sessions.state, persistedSessionState(fields.state) as SessionStateColumn),
                  eq(sessions.updatedAt, fields.updatedAt),
                ),
              ),
          )
          .returning({ id: workItems.id }),
      ])
      return updated.length > 0 && inserted.length > 0
    },

    // ── per-session turn lease (serializes concurrent cloud turns) ────────────

    // Claim the turn lease for a fresh turn chain. Atomic compare-and-set: it
    // succeeds only when the session is running AND no live lease is held (free,
    // or expired past `now`). This is the real mutex the multi-state guard isn't —
    // it fails on running→running while another turn holds the lease. Resets the
    // continuation depth for the new chain.
    async acquireTurnLease(
      projectId: string,
      sessionId: string,
      turnId: string,
      leaseExpiresAt: string,
      now: string,
    ): Promise<boolean> {
      const updated = await db
        .update(sessions)
        .set({ activeTurnId: turnId, turnLeaseExpiresAt: leaseExpiresAt, continuationDepth: 0, updatedAt: now })
        .where(
          and(
            eq(sessions.id, sessionId),
            eq(sessions.projectId, projectId),
            eq(sessions.state, 'running'),
            or(isNull(sessions.activeTurnId), lt(sessions.turnLeaseExpiresAt, now)),
          ),
        )
        .returning({ id: sessions.id })
        .get()
      return Boolean(updated)
    },

    // Extend the lease we already hold (matched by turnId). Returns false if the
    // lease was lost (cleared or stolen after expiry) — the caller must stop.
    async renewTurnLease(
      projectId: string,
      sessionId: string,
      turnId: string,
      leaseExpiresAt: string,
    ): Promise<boolean> {
      const updated = await db
        .update(sessions)
        .set({ turnLeaseExpiresAt: leaseExpiresAt })
        .where(and(eq(sessions.id, sessionId), eq(sessions.projectId, projectId), eq(sessions.activeTurnId, turnId)))
        .returning({ id: sessions.id })
        .get()
      return Boolean(updated)
    },

    // Clear the lease and apply terminal fields, iff we still hold it (turnId).
    async releaseTurnLease(
      projectId: string,
      sessionId: string,
      turnId: string,
      fields: SessionUpdate,
    ): Promise<boolean> {
      const updated = await db
        .update(sessions)
        .set({ ...persistedSessionWrite(fields), activeTurnId: null, turnLeaseExpiresAt: null } as SessionUpdateColumns)
        .where(and(eq(sessions.id, sessionId), eq(sessions.projectId, projectId), eq(sessions.activeTurnId, turnId)))
        .returning({ id: sessions.id })
        .get()
      return Boolean(updated)
    },

    // Bump the continuation depth for the chain we hold; returns the new depth so
    // the caller can enforce the cap. No-op (returns 0) if the lease was lost.
    async incrementContinuationDepth(projectId: string, sessionId: string, turnId: string): Promise<number> {
      const updated = await db
        .update(sessions)
        .set({ continuationDepth: sql`${sessions.continuationDepth} + 1` })
        .where(and(eq(sessions.id, sessionId), eq(sessions.projectId, projectId), eq(sessions.activeTurnId, turnId)))
        .returning({ continuationDepth: sessions.continuationDepth })
        .get()
      return updated?.continuationDepth ?? 0
    },

    // ── snapshot reads (create-session orchestration) ─────────────────────
    async findAgent(projectId: string, agentId: string): Promise<AgentRow | null> {
      return (
        (await db
          .select()
          .from(agents)
          .where(and(eq(agents.id, agentId), eq(agents.projectId, projectId)))
          .get()) ?? null
      )
    },

    async findAgentVersion(agentId: string, versionId: string): Promise<AgentVersionRow | null> {
      return (
        (await db
          .select()
          .from(agentVersions)
          .where(and(eq(agentVersions.id, versionId), eq(agentVersions.agentId, agentId)))
          .get()) ?? null
      )
    },

    async findActiveMemoryStoreResource(projectId, storeId) {
      const store = await db
        .select()
        .from(memoryStores)
        .where(
          and(eq(memoryStores.id, storeId), eq(memoryStores.projectId, projectId), isNull(memoryStores.archivedAt)),
        )
        .get()
      if (!store) {
        return null
      }
      const memories = await db
        .select({ path: memoryStoreMemories.path, content: memoryStoreMemories.content })
        .from(memoryStoreMemories)
        .where(and(eq(memoryStoreMemories.storeId, storeId), eq(memoryStoreMemories.projectId, projectId)))
        .orderBy(asc(memoryStoreMemories.path))
      return {
        type: 'memory',
        memoryRef: amaMemoryRef(storeId),
        name: store.name,
        description: store.description,
        mountPath: memoryStoreMountPath(storeId),
        memories,
      }
    },

    async activeMemoryStoreExists(projectId, storeId) {
      const store = await db
        .select({ id: memoryStores.id })
        .from(memoryStores)
        .where(
          and(eq(memoryStores.id, storeId), eq(memoryStores.projectId, projectId), isNull(memoryStores.archivedAt)),
        )
        .get()
      return Boolean(store)
    },

    async replaceMemoryStoreMemories(projectId, storeId, memories, updatedAt) {
      await db.batch([
        db
          .delete(memoryStoreMemories)
          .where(and(eq(memoryStoreMemories.projectId, projectId), eq(memoryStoreMemories.storeId, storeId))),
        ...memories.map((memory) =>
          db.insert(memoryStoreMemories).values({
            id: `memory_${crypto.randomUUID().replaceAll('-', '')}`,
            projectId,
            storeId,
            path: memory.path,
            content: memory.content,
            metadata: '{}',
            createdAt: updatedAt,
            updatedAt,
          }),
        ),
        db
          .update(memoryStores)
          .set({ updatedAt })
          .where(and(eq(memoryStores.id, storeId), eq(memoryStores.projectId, projectId))),
      ])
    },

    async findEnvironment(projectId: string, environmentId: string): Promise<EnvironmentRow | null> {
      return (
        (await db
          .select()
          .from(environments)
          .where(
            and(
              eq(environments.id, environmentId),
              eq(environments.projectId, projectId),
              isNull(environments.archivedAt),
            ),
          )
          .get()) ?? null
      )
    },

    async findEnvironmentVersion(projectId: string, versionId: string): Promise<EnvironmentVersionRow | null> {
      return (
        (await db
          .select()
          .from(environmentVersions)
          .where(and(eq(environmentVersions.id, versionId), eq(environmentVersions.projectId, projectId)))
          .get()) ?? null
      )
    },

    // ── runner runtime validation ─────────────────────────────────────────
    async activeRunnerRuntimes(projectId: string, environmentId: string): Promise<RunnerRuntime[][]> {
      const activeRunners = await db
        .select({ runtimes: runners.runtimes })
        .from(runners)
        .where(
          and(eq(runners.projectId, projectId), eq(runners.environmentId, environmentId), eq(runners.state, 'active')),
        )
      return activeRunners.map((runner) => parseJson<RunnerRuntime[]>(runner.runtimes) ?? [])
    },

    async resolveEnvironmentForRuntime(projectId, runtime, model): Promise<string | null> {
      // Candidate = an active, non-archived runner bound to a usable environment
      // (live + has a current version). The join plus isNotNull drops unbound
      // runners (environment_id null) since the session needs a concrete
      // environment. Least-loaded first so the capacity preference below is
      // deterministic rather than dependent on row order.
      const rows = await db
        .select({
          environmentId: runners.environmentId,
          runtimes: runners.runtimes,
          currentLoad: runners.currentLoad,
          maxConcurrent: runners.maxConcurrent,
        })
        .from(runners)
        .innerJoin(environments, eq(runners.environmentId, environments.id))
        .where(
          and(
            eq(runners.projectId, projectId),
            eq(runners.state, 'active'),
            isNull(runners.archivedAt),
            isNotNull(runners.environmentId),
            isNull(environments.archivedAt),
            isNotNull(environments.currentVersionId),
          ),
        )
        .orderBy(asc(runners.currentLoad), asc(runners.id))
      const capable = rows
        .map((row) => ({
          environmentId: row.environmentId,
          runtimes: parseJson<RunnerRuntime[]>(row.runtimes) ?? [],
          available: row.currentLoad < row.maxConcurrent,
        }))
        .filter((row) => runtimesSupport(row.runtimes, runtime, model))
      if (capable.length === 0) {
        return null
      }
      const chosen = capable.find((row) => row.available) ?? capable[0]
      return chosen?.environmentId ?? null
    },

    // ── MCP manifest resolution ────────────────────────────────────────────
    async mcpCatalogEntries(connectorIds: string[]): Promise<ConnectorRecord[]> {
      if (connectorIds.length === 0) {
        return []
      }
      const rows = await db.select().from(connectors).where(inArray(connectors.id, connectorIds))
      const byId = new Map(rows.map((row) => [row.id, connectorRecordFrom(row)]))
      const defaultsById = new Map(
        DEFAULT_CONNECTORS.map((connector) => [connector.id, staticConnectorRecordFrom(connector)]),
      )
      return connectorIds
        .map((connectorId) => byId.get(connectorId) ?? defaultsById.get(connectorId))
        .filter((row): row is ConnectorRecord => !!row)
    },

    // ── secret reference validation ────────────────────────────────────
    async activeCredentialVersionExists(
      organizationId: string,
      projectId: string,
      versionId: string,
    ): Promise<boolean> {
      const version = await db
        .select({ id: vaultCredentialVersions.id })
        .from(vaultCredentialVersions)
        .where(
          and(
            eq(vaultCredentialVersions.id, versionId),
            eq(vaultCredentialVersions.organizationId, organizationId),
            or(eq(vaultCredentialVersions.projectId, projectId), isNull(vaultCredentialVersions.projectId)),
            eq(vaultCredentialVersions.state, 'active'),
          ),
        )
        .get()
      return Boolean(version)
    },

    async activeCredentialExists(organizationId: string, projectId: string, credentialId: string): Promise<boolean> {
      const credential = await db
        .select({ id: vaultCredentials.id })
        .from(vaultCredentials)
        .where(
          and(
            eq(vaultCredentials.id, credentialId),
            eq(vaultCredentials.organizationId, organizationId),
            or(eq(vaultCredentials.projectId, projectId), isNull(vaultCredentials.projectId)),
            eq(vaultCredentials.state, 'active'),
          ),
        )
        .get()
      return Boolean(credential)
    },

    // ── secret materialization (runtime dispatch) ──────────────────────────
    async secretVersionForResolution(
      organizationId: string,
      projectId: string,
      secretRef: string,
    ): Promise<{ state: string; metadata: string; secretRef: string } | null> {
      const identity = secretRefIdentity(secretRef)
      if (identity?.credentialId && !identity.versionId) {
        return (
          (await db
            .select({
              state: vaultCredentialVersions.state,
              metadata: vaultCredentialVersions.metadata,
              secretRef: vaultCredentialVersions.secretRef,
            })
            .from(vaultCredentials)
            .innerJoin(vaultCredentialVersions, eq(vaultCredentials.activeVersionId, vaultCredentialVersions.id))
            .where(
              and(
                eq(vaultCredentials.id, identity.credentialId),
                eq(vaultCredentials.vaultId, identity.vaultId),
                eq(vaultCredentials.organizationId, organizationId),
                or(eq(vaultCredentials.projectId, projectId), isNull(vaultCredentials.projectId)),
                eq(vaultCredentials.state, 'active'),
                eq(vaultCredentialVersions.state, 'active'),
              ),
            )
            .get()) ?? null
        )
      }
      return (
        (await db
          .select({
            state: vaultCredentialVersions.state,
            metadata: vaultCredentialVersions.metadata,
            secretRef: vaultCredentialVersions.secretRef,
          })
          .from(vaultCredentialVersions)
          .innerJoin(vaultCredentials, eq(vaultCredentialVersions.credentialId, vaultCredentials.id))
          .where(
            and(
              eq(vaultCredentialVersions.secretRef, secretRef),
              eq(vaultCredentialVersions.organizationId, organizationId),
              or(eq(vaultCredentialVersions.projectId, projectId), isNull(vaultCredentialVersions.projectId)),
              eq(vaultCredentials.state, 'active'),
            ),
          )
          .get()) ?? null
      )
    },

    async vaultVersionsForResolution(
      organizationId: string,
      projectId: string,
      secretRef: string,
    ): Promise<{ name: string; state: string; metadata: string; secretRef: string }[] | null> {
      const vaultId = vaultIdFromRef(secretRef)
      if (!vaultId) {
        return null
      }
      return await db
        .select({
          name: vaultCredentials.name,
          state: vaultCredentialVersions.state,
          metadata: vaultCredentialVersions.metadata,
          secretRef: vaultCredentialVersions.secretRef,
        })
        .from(vaultCredentials)
        .innerJoin(vaultCredentialVersions, eq(vaultCredentials.activeVersionId, vaultCredentialVersions.id))
        .where(
          and(
            eq(vaultCredentials.vaultId, vaultId),
            eq(vaultCredentials.organizationId, organizationId),
            or(eq(vaultCredentials.projectId, projectId), isNull(vaultCredentials.projectId)),
            eq(vaultCredentials.state, 'active'),
            eq(vaultCredentialVersions.state, 'active'),
          ),
        )
    },

    // ── work-item enqueue + resume ──────────────────────────────────────────
    async insertWorkItem(row: WorkItemInsert): Promise<void> {
      await db.insert(workItems).values(row as WorkItemInsertColumns)
    },

    async recentSessionWorkItems(
      projectId: string,
      sessionId: string,
      limit: number,
    ): Promise<{ state: string; payload: string; result: string | null }[]> {
      return db
        .select({ state: workItems.state, payload: workItems.payload, result: workItems.result })
        .from(workItems)
        .where(and(eq(workItems.projectId, projectId), eq(workItems.sessionId, sessionId)))
        .orderBy(desc(workItems.updatedAt))
        .limit(limit)
    },

    // ── self-hosted stop: active work items + lease/runner accounting ───────
    async activeSessionWorkItems(
      projectId: string,
      sessionId: string,
    ): Promise<{ id: string; runnerId: string | null; leaseId: string | null }[]> {
      return db
        .select({ id: workItems.id, runnerId: workItems.runnerId, leaseId: workItems.leaseId })
        .from(workItems)
        .where(
          and(
            eq(workItems.projectId, projectId),
            eq(workItems.sessionId, sessionId),
            inArray(workItems.state, ['available', 'leased']),
          ),
        )
    },

    async cancelWorkItems(
      projectId: string,
      workItemIds: string[],
      errorJson: string,
      timestamp: string,
    ): Promise<void> {
      await db
        .update(workItems)
        .set({ state: 'cancelled', error: errorJson, updatedAt: timestamp })
        .where(and(eq(workItems.projectId, projectId), inArray(workItems.id, workItemIds)))
    },

    async cancelLeases(projectId: string, leaseIds: string[], timestamp: string): Promise<void> {
      await db
        .update(leases)
        .set({ state: 'cancelled', updatedAt: timestamp })
        .where(and(eq(leases.projectId, projectId), inArray(leases.id, leaseIds)))
    },

    async decrementRunnerLoad(projectId: string, runnerId: string, timestamp: string): Promise<void> {
      await db
        .update(runners)
        .set({
          currentLoad: sql`case when ${runners.currentLoad} > 0 then ${runners.currentLoad} - 1 else 0 end`,
          updatedAt: timestamp,
        })
        .where(and(eq(runners.id, runnerId), eq(runners.projectId, projectId)))
    },

    // ── turn execution reads ────────────────────────────────────────────────
    async sessionEventStream(sessionId: string): Promise<{ type: string; payload: string }[]> {
      return db
        .select({ type: sessionEvents.type, payload: sessionEvents.payload })
        .from(sessionEvents)
        .where(eq(sessionEvents.sessionId, sessionId))
        .orderBy(asc(sessionEvents.sequence))
        .all()
    },

    // ── pending session sweep ────────────────────────────────────────────────
    async markExpiredPendingSessions(projectId: string, expiredBefore: string, timestamp: string): Promise<void> {
      await db
        .update(sessions)
        .set({ state: 'error', stateReason: 'Session runtime startup timed out', updatedAt: timestamp })
        .where(
          and(
            eq(sessions.projectId, projectId),
            eq(sessions.state, 'pending'),
            or(
              isNull(sessions.stateReason),
              and(
                ne(sessions.stateReason, 'requires-runner'),
                ne(sessions.stateReason, 'waiting-for-runner'),
                ne(sessions.stateReason, 'waiting-for-runner-recovery'),
              ),
            ),
            sql`${sessions.createdAt} < ${expiredBefore}`,
          ),
        )
    },

    // ── approval decision ────────────────────────────────────────────────────
    async findApproval(projectId: string, sessionId: string, approvalId: string): Promise<unknown> {
      return await db
        .select()
        .from(sessionApprovals)
        .where(
          and(
            eq(sessionApprovals.id, approvalId),
            eq(sessionApprovals.sessionId, sessionId),
            eq(sessionApprovals.projectId, projectId),
          ),
        )
        .get()
    },

    async upsertApproval(row: SessionApprovalInsert, decidedAt: string): Promise<void> {
      const columns = row as SessionApprovalInsertColumns
      await db
        .insert(sessionApprovals)
        .values(columns)
        .onConflictDoUpdate({
          target: [sessionApprovals.sessionId, sessionApprovals.toolCallId],
          set: {
            state: columns.state,
            reason: row.reason,
            result: row.result,
            decidedByUserId: row.decidedByUserId,
            decidedAt,
            updatedAt: decidedAt,
          },
        })
    },

    // ── watchdog: stalled cloud sessions + leaked sandboxes ──────────────────
    async markStalledCloudSessions(threshold: string, timestamp: string): Promise<void> {
      await db
        .update(sessions)
        .set({
          state: 'error',
          stateReason: 'Cloud session stalled: no completion within the wall-clock budget',
          updatedAt: timestamp,
        })
        .where(
          and(
            or(
              and(eq(sessions.state, 'running'), isNotNull(sessions.sandboxId)),
              and(eq(sessions.state, 'pending'), isNull(sessions.stateReason)),
            ),
            notLike(sessions.metadata, '%"sandboxBackend":"runner-sandbox"%'),
            lt(sessions.updatedAt, threshold),
          ),
        )
    },

    async markIdleTimedOutSessions(timestamp: string): Promise<void> {
      const timeoutSeconds = sql<number>`cast(json_extract(${sessions.metadata}, ${`$.annotations."${AMA_ANNOTATION_KEY_SESSION_IDLE_TIMEOUT_SECONDS}"`}) as integer)`
      await db
        .update(sessions)
        .set({
          state: persistedSessionState('closed'),
          stateReason: 'idle-timeout',
          closedAt: timestamp,
          updatedAt: timestamp,
        })
        .where(
          and(
            isNull(sessions.archivedAt),
            eq(sessions.state, 'idle'),
            sql`${timeoutSeconds} > 0`,
            sql`strftime('%s', ${timestamp}) - strftime('%s', ${sessions.updatedAt}) >= ${timeoutSeconds}`,
          ),
        )
    },

    async leakedSandboxSessions(
      terminalStates: string[],
      limit: number,
    ): Promise<{ id: string; sandboxId: string | null; metadata: string | null }[]> {
      return db
        .select({ id: sessions.id, sandboxId: sessions.sandboxId, metadata: sessions.metadata })
        .from(sessions)
        .where(
          and(
            or(
              inArray(sessions.state, persistedSessionStates(terminalStates) as SessionStateColumn[]),
              isNotNull(sessions.archivedAt),
            ),
            isNotNull(sessions.sandboxId),
            notLike(sessions.metadata, '%"sandboxBackend":"runner-sandbox"%'),
            notLike(sessions.metadata, '%"sandboxDestroyedAt"%'),
          ),
        )
        .limit(limit)
    },

    async stampSandboxDestroyed(sessionId: string, metadataJson: string): Promise<void> {
      await db
        .update(sessions)
        .set({ metadata: metadataJson, updatedAt: sql`updated_at` })
        .where(eq(sessions.id, sessionId))
    },

    // ── runner session channel (durable object) ──────────────────────────────
    async channelSession(
      projectId: string,
      sessionId: string,
    ): Promise<{ id: string; agentSnapshot: string | null; environmentSnapshot: string | null } | null> {
      return (
        (await db
          .select({
            id: sessions.id,
            agentSnapshot: sessions.agentSnapshot,
            environmentSnapshot: sessions.environmentSnapshot,
          })
          .from(sessions)
          .where(and(eq(sessions.id, sessionId), eq(sessions.projectId, projectId)))
          .get()) ?? null
      )
    },

    async channelSessionState(
      projectId: string,
      sessionId: string,
    ): Promise<{ state: string; stateReason: string | null } | null> {
      const row =
        (await db
          .select({ state: sessions.state, stateReason: sessions.stateReason })
          .from(sessions)
          .where(and(eq(sessions.id, sessionId), eq(sessions.projectId, projectId)))
          .get()) ?? null
      return row ? { state: domainSessionState(row.state), stateReason: row.stateReason } : null
    },

    async channelWorkItem(projectId: string, workItemId: string): Promise<WorkItemRow | null> {
      return (
        (await db
          .select()
          .from(workItems)
          .where(and(eq(workItems.id, workItemId), eq(workItems.projectId, projectId)))
          .get()) ?? null
      )
    },

    async channelActiveLease(state: {
      leaseId: string
      workItemId: string
      runnerId: string
      projectId: string
    }): Promise<{ expiresAt: string } | null> {
      return (
        (await db
          .select({ expiresAt: leases.expiresAt })
          .from(leases)
          .where(
            and(
              eq(leases.id, state.leaseId),
              eq(leases.workItemId, state.workItemId),
              eq(leases.runnerId, state.runnerId),
              eq(leases.projectId, state.projectId),
              eq(leases.state, 'active'),
            ),
          )
          .get()) ?? null
      )
    },

    async channelActiveChannel(state: {
      channelId: string
      sessionId: string
      workItemId: string
      leaseId: string
      runnerId: string
      projectId: string
    }): Promise<{ id: string } | null> {
      return (
        (await db
          .select({ id: sessionChannels.id })
          .from(sessionChannels)
          .where(
            and(
              eq(sessionChannels.id, state.channelId),
              eq(sessionChannels.sessionId, state.sessionId),
              eq(sessionChannels.workItemId, state.workItemId),
              eq(sessionChannels.leaseId, state.leaseId),
              eq(sessionChannels.runnerId, state.runnerId),
              eq(sessionChannels.projectId, state.projectId),
              eq(sessionChannels.state, 'active'),
            ),
          )
          .get()) ?? null
      )
    },

    async touchChannel(channelId: string, timestamp: string): Promise<void> {
      await db
        .update(sessionChannels)
        .set({ lastSeenAt: timestamp, updatedAt: timestamp })
        .where(and(eq(sessionChannels.id, channelId), eq(sessionChannels.state, 'active')))
    },

    async closeChannel(
      channelId: string,
      channelState: 'closed' | 'stale',
      reason: string,
      timestamp: string,
    ): Promise<void> {
      await db
        .update(sessionChannels)
        .set({ state: channelState, closedAt: timestamp, closeReason: reason, updatedAt: timestamp })
        .where(and(eq(sessionChannels.id, channelId), eq(sessionChannels.state, 'active')))
    },

    async requeueSessionForRunnerRecovery(projectId: string, sessionId: string, timestamp: string): Promise<void> {
      await db
        .update(sessions)
        .set({ state: 'pending', stateReason: 'waiting-for-runner-recovery', updatedAt: timestamp })
        .where(and(eq(sessions.id, sessionId), eq(sessions.projectId, projectId)))
    },
  }
}

export type RuntimeOrchestrationRepo = ReturnType<typeof createRuntimeOrchestrationRepo>

// The runtime queue consumer, scheduled watchdog, and the runner-session DO bind
// their own D1 handle (they run outside the per-request composition root). The
// drizzle construction stays here in adapters so those runtime entrypoints take
// the raw `D1Database` binding and never import drizzle themselves.
export function createRuntimeOrchestrationRepoFromBinding(binding: D1Database): RuntimeOrchestrationRepo {
  return createRuntimeOrchestrationRepo(drizzle(binding))
}
