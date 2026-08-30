import { createRoute, type OpenAPIHono, z } from '@hono/zod-openapi'
import { MODEL_AVAILABILITY, MODEL_CATALOG_STATES } from '@server/domain/provider'
import { PROVIDER_ERROR_CATEGORIES } from '@server/domain/provider-adapter'
import { requireAuth } from '../auth/session'
import { AuthenticatedOperation, type DepsEnv, ErrorResponseSchema } from '../openapi'
import type { ProviderModelRecord, ProviderRecord } from '../usecases/ports'
import { refreshPlatformCatalog } from '../usecases/providers'
import { requestId } from './request-context'

type ProviderRoutes = OpenAPIHono<DepsEnv>

const JsonObjectSchema = z.record(z.string(), z.unknown())

// The normalized provider error envelope (domain NormalizedProviderError, plus
// the occurredAt stamped at persist time). Raw provider payloads never reach it.
const ProviderErrorSchema = z
  .object({
    type: z.string().openapi({ example: 'provider_error' }),
    category: z.enum(PROVIDER_ERROR_CATEGORIES).optional().openapi({ example: 'network' }),
    message: z.string().openapi({ example: 'The provider rejected the request.' }),
    retryable: z.boolean().optional().openapi({ example: true }),
    retryAfterSeconds: z.number().int().nonnegative().optional().openapi({ example: 30 }),
    occurredAt: z.string().datetime().optional(),
  })
  .openapi('ProviderError')
type ProviderErrorDto = z.infer<typeof ProviderErrorSchema>

// Per-token pricing the cost calculator reads (computeModelCostMicros);
// catchall keeps room for provider-specific pricing dimensions.
const PricingSchema = z
  .object({
    inputMicrosPerToken: z.number().nonnegative().optional(),
    outputMicrosPerToken: z.number().nonnegative().optional(),
  })
  .catchall(z.unknown())
  .openapi('ProviderModelPricing')
type PricingDto = z.infer<typeof PricingSchema>

// A provider is a global model vendor (anthropic, openai, …); the catalog is
// shared across all projects and refreshed by the scheduled discovery job.
const ProviderSchema = z
  .object({
    id: z.string().openapi({ example: 'anthropic' }),
    slug: z.string().openapi({ example: 'anthropic' }),
    displayName: z.string().openapi({ example: 'Anthropic' }),
    enabled: z.boolean().openapi({ example: true }),
    metadata: JsonObjectSchema.openapi({ example: {} }),
    modelCatalogState: z.enum(MODEL_CATALOG_STATES).openapi({ example: 'ready' }),
    lastError: ProviderErrorSchema.nullable().openapi({ example: null }),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .openapi('Provider')

const ProviderModelSchema = z
  .object({
    id: z.string(),
    providerId: z.string(),
    modelId: z.string(),
    displayName: z.string(),
    capabilities: z.array(z.string()),
    contextWindow: z.number().int().nullable(),
    pricing: PricingSchema,
    availability: z.enum(MODEL_AVAILABILITY),
    metadata: JsonObjectSchema,
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .openapi('ProviderModel')

const CatalogRefreshSchema = z
  .object({
    outcome: z.enum(['succeeded', 'failed']).openapi({ example: 'succeeded' }),
    discoveredCount: z.number().int().openapi({ example: 41 }),
    vendors: z.number().int().openapi({ example: 3 }),
    category: z.enum(PROVIDER_ERROR_CATEGORIES).optional(),
  })
  .openapi('CatalogRefreshResult')

const ProviderParamsSchema = z.object({
  providerId: z.string().openapi({ param: { name: 'providerId', in: 'path' }, example: 'anthropic' }),
})

function listEnvelope<T>(data: T[]) {
  return { data, pagination: { limit: data.length || 1, nextCursor: null, hasMore: false } }
}

const ProviderListResponseSchema = z
  .object({
    data: z.array(ProviderSchema),
    pagination: z.object({ limit: z.number(), nextCursor: z.string().nullable(), hasMore: z.boolean() }),
  })
  .openapi('ProviderListResponse')
const ProviderModelListResponseSchema = z
  .object({
    data: z.array(ProviderModelSchema),
    pagination: z.object({ limit: z.number(), nextCursor: z.string().nullable(), hasMore: z.boolean() }),
  })
  .openapi('ProviderModelListResponse')

function errorBody(type: string, message: string, details?: Record<string, unknown>) {
  return { error: { type, message, ...(details ? { details } : {}) } } as const
}

function serializeProvider(record: ProviderRecord) {
  return {
    id: record.id,
    slug: record.slug,
    displayName: record.displayName,
    enabled: record.enabled,
    metadata: record.metadata,
    modelCatalogState: record.modelCatalogState,
    // The repo persists the normalized error envelope; the record types it loosely.
    lastError: record.lastError as ProviderErrorDto | null,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  }
}

function serializeModel(record: ProviderModelRecord) {
  return {
    id: record.id,
    providerId: record.providerId,
    modelId: record.modelId,
    displayName: record.displayName,
    capabilities: record.capabilities,
    contextWindow: record.contextWindow,
    pricing: record.pricing as PricingDto,
    availability: record.availability,
    metadata: record.metadata,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  }
}

const listRoute = createRoute({
  method: 'get',
  path: '/',
  operationId: 'listProviders',
  tags: ['Providers'],
  summary: 'List model vendors',
  ...AuthenticatedOperation,
  responses: {
    200: { description: 'Provider list', content: { 'application/json': { schema: ProviderListResponseSchema } } },
    401: { description: 'Authentication required', content: { 'application/json': { schema: ErrorResponseSchema } } },
  },
})

const listAllModelsRoute = createRoute({
  method: 'get',
  path: '/models',
  operationId: 'listModels',
  tags: ['Providers'],
  summary: 'List all catalog models',
  ...AuthenticatedOperation,
  responses: {
    200: {
      description: 'All catalog models',
      content: { 'application/json': { schema: ProviderModelListResponseSchema } },
    },
    401: { description: 'Authentication required', content: { 'application/json': { schema: ErrorResponseSchema } } },
  },
})

const refreshRoute = createRoute({
  method: 'post',
  path: '/refresh',
  operationId: 'refreshCatalog',
  tags: ['Providers'],
  summary: 'Refresh the model catalog',
  description: 'Triggers a discovery refresh of the global model catalog (also runs hourly on a schedule).',
  ...AuthenticatedOperation,
  responses: {
    200: { description: 'Refresh result', content: { 'application/json': { schema: CatalogRefreshSchema } } },
    401: { description: 'Authentication required', content: { 'application/json': { schema: ErrorResponseSchema } } },
  },
})

const readRoute = createRoute({
  method: 'get',
  path: '/{providerId}',
  operationId: 'readProvider',
  tags: ['Providers'],
  summary: 'Read a model vendor',
  ...AuthenticatedOperation,
  request: { params: ProviderParamsSchema },
  responses: {
    200: { description: 'Provider', content: { 'application/json': { schema: ProviderSchema } } },
    401: { description: 'Authentication required', content: { 'application/json': { schema: ErrorResponseSchema } } },
    404: { description: 'Provider not found', content: { 'application/json': { schema: ErrorResponseSchema } } },
  },
})

const listModelsRoute = createRoute({
  method: 'get',
  path: '/{providerId}/models',
  operationId: 'listProviderModels',
  tags: ['Providers'],
  summary: "List a vendor's models",
  ...AuthenticatedOperation,
  request: { params: ProviderParamsSchema },
  responses: {
    200: {
      description: 'Provider models',
      content: { 'application/json': { schema: ProviderModelListResponseSchema } },
    },
    401: { description: 'Authentication required', content: { 'application/json': { schema: ErrorResponseSchema } } },
    404: { description: 'Provider not found', content: { 'application/json': { schema: ErrorResponseSchema } } },
  },
})

// Static segments register before parameter segments so /models and /refresh win
// over /{providerId}. The assembler in app.ts mounts this at the providers
// resource position. The catalog is global, so any authenticated project reads it.
export function registerProviderRoutes(routes: ProviderRoutes) {
  return routes
    .openapi(listRoute, async (c) => {
      const deps = c.get('deps')
      const auth = await requireAuth(c)
      if (auth instanceof Response) {
        return auth
      }
      const rows = await deps.providers.list()
      return c.json(listEnvelope(rows.map(serializeProvider)), 200)
    })
    .openapi(listAllModelsRoute, async (c) => {
      const deps = c.get('deps')
      const auth = await requireAuth(c)
      if (auth instanceof Response) {
        return auth
      }
      const rows = await deps.providers.listModels()
      return c.json(listEnvelope(rows.map(serializeModel)), 200)
    })
    .openapi(refreshRoute, async (c) => {
      const deps = c.get('deps')
      const auth = await requireAuth(c)
      if (auth instanceof Response) {
        return auth
      }
      const result = await refreshPlatformCatalog(deps)
      await deps.audit.record(auth, {
        action: 'provider_catalog.refresh',
        resourceType: 'provider_catalog',
        resourceId: 'global',
        outcome: result.outcome === 'succeeded' ? 'success' : 'failure',
        requestId: requestId(c),
        metadata: { discoveredModels: result.discoveredCount, vendors: result.vendors },
      })
      return c.json(result, 200)
    })
    .openapi(readRoute, async (c) => {
      const { providerId } = c.req.valid('param')
      const deps = c.get('deps')
      const auth = await requireAuth(c)
      if (auth instanceof Response) {
        return auth
      }
      const provider = await deps.providers.find(providerId)
      if (!provider) {
        return c.json(errorBody('not_found', 'Provider not found'), 404)
      }
      return c.json(serializeProvider(provider), 200)
    })
    .openapi(listModelsRoute, async (c) => {
      const { providerId } = c.req.valid('param')
      const deps = c.get('deps')
      const auth = await requireAuth(c)
      if (auth instanceof Response) {
        return auth
      }
      const provider = await deps.providers.find(providerId)
      if (!provider) {
        return c.json(errorBody('not_found', 'Provider not found'), 404)
      }
      const rows = await deps.providers.listModels(providerId)
      return c.json(listEnvelope(rows.map(serializeModel)), 200)
    })
}
