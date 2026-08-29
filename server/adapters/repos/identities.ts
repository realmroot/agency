import type { Identity, IdentityDescriptor } from '@server/domain/identity'
import { resourceMetadata, resourcePhase } from '@server/domain/resource'
import type { IdentityRepo } from '@server/usecases/ports'
import { and, desc, eq, isNotNull, isNull, like, lt, lte, ne, notExists, or } from 'drizzle-orm'
import type { drizzle } from 'drizzle-orm/d1'
import { agents, identities } from '../../db/schema'

type Db = ReturnType<typeof drizzle>
type Row = typeof identities.$inferSelect

function descriptor(row: Row): IdentityDescriptor | null {
  if (!row.remoteAgentId || !row.issuer || !row.subject || !row.credentialId) return null
  return {
    identityId: row.id,
    agentId: row.remoteAgentId,
    issuer: row.issuer,
    subject: row.subject,
    username: row.username,
    runtime: row.runtime,
    credentialRef: `ama://vaults/${encodeURIComponent(row.vaultId)}/credentials/${encodeURIComponent(row.credentialId)}`,
  }
}

function record(row: Row): Identity {
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
    spec: { username: row.username, runtime: row.runtime },
    status: {
      phase: resourcePhase(row.archivedAt),
      state: row.state,
      failureCode: row.failureCode,
      boundAgentId: row.boundAgentId,
      descriptor: descriptor(row),
    },
  }
}

export function createIdentityRepo(db: Db): IdentityRepo {
  return {
    async list(query) {
      const filters = [
        eq(identities.projectId, query.projectId),
        query.archived ? isNotNull(identities.archivedAt) : isNull(identities.archivedAt),
        query.search
          ? or(like(identities.name, `%${query.search}%`), like(identities.username, `%${query.search}%`))
          : undefined,
        query.cursor
          ? or(
              lt(identities.createdAt, query.cursor.createdAt),
              and(eq(identities.createdAt, query.cursor.createdAt), lt(identities.id, query.cursor.id)),
            )
          : undefined,
      ].filter((value) => value !== undefined)
      const rows = await db
        .select()
        .from(identities)
        .where(and(...filters))
        .orderBy(desc(identities.createdAt), desc(identities.id))
        .limit(query.limit + 1)
      return { rows: rows.slice(0, query.limit).map(record), hasMore: rows.length > query.limit }
    },
    async find(projectId, identityId) {
      const row = await db
        .select()
        .from(identities)
        .where(and(eq(identities.id, identityId), eq(identities.projectId, projectId)))
        .get()
      return row ? record(row) : null
    },
    async provisioning(identityId) {
      const row = await db
        .select({
          vaultId: identities.vaultId,
          credentialId: identities.credentialId,
          requestFingerprint: identities.requestFingerprint,
        })
        .from(identities)
        .where(eq(identities.id, identityId))
        .get()
      return row ?? null
    },
    async claim(input, owner, timestamp, leaseExpiresAt) {
      const row = {
        ...input,
        credentialId: null,
        remoteAgentId: null,
        issuer: null,
        subject: null,
        boundAgentId: null,
        state: 'provisioning' as const,
        failureCode: null,
        provisioningOwner: owner,
        provisioningLeaseExpiresAt: leaseExpiresAt,
        archivedAt: null,
        createdAt: timestamp,
        updatedAt: timestamp,
      }
      const inserted = await db
        .insert(identities)
        .values(row)
        .onConflictDoNothing({ target: [identities.projectId, identities.idempotencyKeyHash] })
        .run()
      let acquired = (inserted.meta.changes ?? 0) > 0
      if (!acquired) {
        const claimed = await db
          .update(identities)
          .set({
            provisioningOwner: owner,
            provisioningLeaseExpiresAt: leaseExpiresAt,
            state: 'provisioning',
            failureCode: null,
            updatedAt: timestamp,
          })
          .where(
            and(
              eq(identities.projectId, input.projectId),
              eq(identities.idempotencyKeyHash, input.idempotencyKeyHash),
              eq(identities.requestFingerprint, input.requestFingerprint),
              ne(identities.state, 'active'),
              or(
                isNull(identities.provisioningOwner),
                isNull(identities.provisioningLeaseExpiresAt),
                lte(identities.provisioningLeaseExpiresAt, timestamp),
              ),
            ),
          )
          .run()
        acquired = (claimed.meta.changes ?? 0) > 0
      }
      const stored = await db
        .select()
        .from(identities)
        .where(
          and(eq(identities.projectId, input.projectId), eq(identities.idempotencyKeyHash, input.idempotencyKeyHash)),
        )
        .get()
      if (!stored) throw new Error('Identity provisioning claim disappeared')
      return { identity: record(stored), acquired, requestFingerprint: stored.requestFingerprint }
    },
    async setCredential(identityId, owner, credentialId, timestamp) {
      const result = await db
        .update(identities)
        .set({ credentialId, updatedAt: timestamp })
        .where(
          and(
            eq(identities.id, identityId),
            eq(identities.provisioningOwner, owner),
            eq(identities.state, 'provisioning'),
          ),
        )
        .run()
      if ((result.meta.changes ?? 0) === 0) throw new Error('Identity provisioning ownership was lost')
    },
    async activate(identityId, owner, credentialId, value, timestamp) {
      const result = await db
        .update(identities)
        .set({
          credentialId,
          remoteAgentId: value.agentId,
          issuer: value.issuer,
          subject: value.subject,
          username: value.username,
          state: 'active',
          failureCode: null,
          provisioningOwner: null,
          provisioningLeaseExpiresAt: null,
          updatedAt: timestamp,
        })
        .where(
          and(
            eq(identities.id, identityId),
            eq(identities.provisioningOwner, owner),
            eq(identities.state, 'provisioning'),
          ),
        )
        .run()
      const row = await db.select().from(identities).where(eq(identities.id, identityId)).get()
      if (!row) throw new Error('Identity disappeared while provisioning')
      if ((result.meta.changes ?? 0) === 0 && row.state !== 'active') {
        throw new Error('Identity provisioning ownership was lost')
      }
      return record(row)
    },
    async fail(identityId, owner, failureCode, timestamp) {
      await db
        .update(identities)
        .set({
          state: 'error',
          failureCode,
          provisioningOwner: null,
          provisioningLeaseExpiresAt: null,
          updatedAt: timestamp,
        })
        .where(
          and(eq(identities.id, identityId), eq(identities.provisioningOwner, owner), ne(identities.state, 'active')),
        )
    },
    async archive(projectId, identityId, timestamp) {
      const result = await db
        .update(identities)
        .set({ archivedAt: timestamp, updatedAt: timestamp })
        .where(
          and(
            eq(identities.projectId, projectId),
            eq(identities.id, identityId),
            isNull(identities.archivedAt),
            notExists(
              db
                .select({ id: agents.id })
                .from(agents)
                .where(and(eq(agents.projectId, projectId), eq(agents.identityId, identities.id))),
            ),
          ),
        )
        .run()
      if ((result.meta.changes ?? 0) > 0) return true
      const row = await db
        .select({ archivedAt: identities.archivedAt })
        .from(identities)
        .where(and(eq(identities.projectId, projectId), eq(identities.id, identityId)))
        .get()
      return row?.archivedAt !== null && row?.archivedAt !== undefined
    },
  }
}
