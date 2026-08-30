import type { ModelAvailability, ModelCatalogState } from '@server/domain/provider'
import { newPrimaryKey } from '@server/id'
import type {
  ProviderCatalogStatus,
  ProviderModelRecord,
  ProviderRecord,
  ProviderRepo,
  UpsertProviderInput,
  UpsertProviderModelInput,
} from '@server/usecases/ports'
import { and, eq } from 'drizzle-orm'
import type { drizzle } from 'drizzle-orm/d1'
import { agents, providerModels, providers } from '../../db/schema'

type Db = ReturnType<typeof drizzle>
type ProviderRow = typeof providers.$inferSelect
type ProviderModelRow = typeof providerModels.$inferSelect

function parseJson<T>(value: string | null, fallback: T) {
  return value ? (JSON.parse(value) as T) : fallback
}

function stringify(value: unknown) {
  return JSON.stringify(value)
}

function providerRecordFrom(row: ProviderRow): ProviderRecord {
  return {
    id: row.id,
    slug: row.slug,
    displayName: row.displayName,
    enabled: row.enabled,
    metadata: parseJson<Record<string, unknown>>(row.metadata, {}),
    modelCatalogState: row.modelCatalogState as ModelCatalogState,
    lastError: parseJson<Record<string, unknown> | null>(row.lastError, null),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

function modelRecordFrom(row: ProviderModelRow): ProviderModelRecord {
  return {
    id: row.id,
    providerId: row.providerId,
    modelId: row.modelId,
    displayName: row.displayName,
    capabilities: parseJson<string[]>(row.capabilities, []),
    contextWindow: row.contextWindow,
    pricing: parseJson<Record<string, unknown>>(row.pricing, {}),
    availability: row.availability as ModelAvailability,
    metadata: parseJson<Record<string, unknown>>(row.metadata, {}),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

// Global vendor catalog: providers are model vendors (anthropic, openai, …) and
// provider_models is the shared model list, both populated by the scheduled
// discovery refresh. No per-tenant scope.
export function createProviderRepo(db: Db): ProviderRepo {
  return {
    async list() {
      const rows = await db.select().from(providers).orderBy(providers.slug)
      return rows.map(providerRecordFrom)
    },

    async find(providerId) {
      const row = await db.select().from(providers).where(eq(providers.id, providerId)).get()
      return row ? providerRecordFrom(row) : null
    },

    async findBySlug(slug) {
      const row = await db.select().from(providers).where(eq(providers.slug, slug)).get()
      return row ? providerRecordFrom(row) : null
    },

    async upsert(input: UpsertProviderInput, timestamp): Promise<ProviderRecord> {
      const existing = await db.select().from(providers).where(eq(providers.slug, input.slug)).get()
      if (existing) {
        const row = await db
          .update(providers)
          .set({ displayName: input.displayName, updatedAt: timestamp })
          .where(eq(providers.id, existing.id))
          .returning()
          .get()
        return providerRecordFrom(row)
      }
      const row = {
        // The vendor slug is the natural key: agents pin providerId, the catalog
        // keys models by providerId, and runtime requirements/policy all reference
        // the vendor — using the slug as the id keeps every layer consistent with
        // zero runtime resolution.
        id: input.slug,
        slug: input.slug,
        displayName: input.displayName,
        enabled: true,
        metadata: stringify({}),
        modelCatalogState: 'ready',
        lastError: null,
        createdAt: timestamp,
        updatedAt: timestamp,
      } satisfies typeof providers.$inferInsert
      await db.insert(providers).values(row)
      return providerRecordFrom(row)
    },

    async setCatalogStatus(providerId, status: ProviderCatalogStatus, updatedAt) {
      await db
        .update(providers)
        .set({
          modelCatalogState: status.modelCatalogState,
          lastError: status.lastError ? stringify(status.lastError) : null,
          updatedAt,
        })
        .where(eq(providers.id, providerId))
    },

    async agentReferences(providerId) {
      const row = await db.select({ id: agents.id }).from(agents).where(eq(agents.providerId, providerId)).get()
      return Boolean(row)
    },

    async listModels(providerId) {
      const rows = await db
        .select()
        .from(providerModels)
        .where(providerId ? eq(providerModels.providerId, providerId) : undefined)
        .orderBy(providerModels.modelId)
      return rows.map(modelRecordFrom)
    },

    async findModel(providerId, modelId) {
      const row = await db
        .select()
        .from(providerModels)
        .where(and(eq(providerModels.providerId, providerId), eq(providerModels.modelId, modelId)))
        .get()
      return row ? modelRecordFrom(row) : null
    },

    async upsertModel(input: UpsertProviderModelInput, timestamp) {
      const existing = await db
        .select()
        .from(providerModels)
        .where(and(eq(providerModels.providerId, input.providerId), eq(providerModels.modelId, input.modelId)))
        .get()
      const values = {
        providerId: input.providerId,
        modelId: input.modelId,
        displayName: input.displayName,
        capabilities: stringify(input.capabilities),
        contextWindow: input.contextWindow,
        pricing: stringify(input.pricing),
        availability: input.availability,
        metadata: stringify(input.metadata),
        updatedAt: timestamp,
      }
      if (existing) {
        await db.update(providerModels).set(values).where(eq(providerModels.id, existing.id))
        return { record: modelRecordFrom({ ...existing, ...values }), created: false }
      }
      const row = { id: newPrimaryKey(), ...values, createdAt: timestamp }
      await db.insert(providerModels).values(row)
      return { record: modelRecordFrom(row), created: true }
    },

    async deleteModel(modelRecordId) {
      await db.delete(providerModels).where(eq(providerModels.id, modelRecordId))
    },
  }
}
