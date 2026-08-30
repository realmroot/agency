import { createRoute, type OpenAPIHono, z } from '@hono/zod-openapi'
import {
  ResourceCreateMetadataSchema,
  ResourceMetadataSchema,
  ResourcePhaseSchema,
  ResourceUpdateMetadataSchema,
  serializeResource,
} from '@server/contracts/resource-contracts'
import { normalizeMemoryPath } from '@server/domain/memory-store'
import { requireAuth } from '../auth/session'
import {
  AuthenticatedOperation,
  type DepsEnv,
  ErrorResponseSchema,
  formatListCursor,
  listQuerySchema,
  listResponseSchema,
  parseListCursor,
} from '../openapi'
import type { MemoryStoreRepo } from '../usecases/ports'
import { requestId } from './request-context'

type MemoryStoreRoutes = OpenAPIHono<DepsEnv>

const JsonObjectSchema = z.record(z.string(), z.unknown())
const EmptySpecSchema = z.object({}).strict()

const MemoryStoreSchema = z
  .object({
    metadata: ResourceMetadataSchema,
    spec: EmptySpecSchema.openapi('MemoryStoreSpec'),
    status: z.object({ phase: ResourcePhaseSchema }).openapi('MemoryStoreStatus'),
  })
  .openapi('MemoryStore')

const MemoryStoreMemorySchema = z
  .object({
    metadata: ResourceMetadataSchema,
    spec: z
      .object({
        storeId: z.string().openapi({ example: '0195f5d6-7c20-7000-8000-00000000000a' }),
        path: z.string().openapi({ example: 'guides/review.md' }),
        content: z.string().openapi({ example: 'Review for correctness first.' }),
        metadata: JsonObjectSchema.openapi({ example: {} }),
      })
      .openapi('MemoryStoreMemorySpec'),
    status: z.object({ phase: ResourcePhaseSchema }).openapi('MemoryStoreMemoryStatus'),
  })
  .openapi('MemoryStoreMemory')

const CreateMemoryStoreSchema = z
  .object({
    metadata: ResourceCreateMetadataSchema.openapi({
      example: { name: 'Team conventions', description: 'Shared repository and review preferences.' },
    }),
    spec: EmptySpecSchema.optional(),
  })
  .strict()
  .openapi('CreateMemoryStoreRequest')

const UpdateMemoryStoreSchema = z
  .object({
    metadata: ResourceUpdateMetadataSchema.optional(),
    spec: EmptySpecSchema.optional(),
    archived: z.boolean().optional().openapi({ example: true }),
  })
  .strict()
  .refine((body) => body.metadata !== undefined || body.spec !== undefined || body.archived !== undefined, {
    message: 'Provide metadata, spec, or archived.',
  })
  .openapi('UpdateMemoryStoreRequest')

const CreateMemorySchema = z
  .object({
    path: z.string().min(1).max(300).openapi({ example: 'guides/review.md' }),
    content: z.string().min(1).max(128000).openapi({ example: 'Review for correctness first.' }),
    metadata: JsonObjectSchema.optional().openapi({ example: {} }),
  })
  .openapi('CreateMemoryStoreMemoryRequest')

const UpdateMemorySchema = CreateMemorySchema.partial()
  .extend({
    path: z.string().min(1).max(300).optional(),
    content: z.string().min(1).max(128000).optional(),
  })
  .openapi('UpdateMemoryStoreMemoryRequest')

const StoreParamsSchema = z.object({
  storeId: z
    .string()
    .openapi({ param: { name: 'storeId', in: 'path' }, example: '0195f5d6-7c20-7000-8000-00000000000a' }),
})

const MemoryParamsSchema = StoreParamsSchema.extend({
  memoryId: z
    .string()
    .openapi({ param: { name: 'memoryId', in: 'path' }, example: '0195f5d6-7c20-7000-8000-00000000000b' }),
})

const StoreListQuerySchema = listQuerySchema()
const MemoryListQuerySchema = listQuerySchema().omit({
  archived: true,
  search: true,
  createdFrom: true,
  createdTo: true,
})
const StoreListResponseSchema = listResponseSchema('MemoryStoreListResponse', MemoryStoreSchema)
const MemoryListResponseSchema = listResponseSchema('MemoryStoreMemoryListResponse', MemoryStoreMemorySchema)

function validation(message: string, fields: Record<string, string>) {
  return { error: { type: 'validation_error', message, details: { fields } } } as const
}

function conflict(message: string) {
  return { error: { type: 'conflict', message } } as const
}

function notFound(message: string) {
  return { error: { type: 'not_found', message } } as const
}

function memoryStoresRepo(deps: { memoryStores?: MemoryStoreRepo }) {
  if (!deps.memoryStores) {
    throw new Error('Memory store repo is required')
  }
  return deps.memoryStores
}

function normalizePathInput(path: string) {
  try {
    return { path: normalizeMemoryPath(path) }
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) }
  }
}

function isUniqueError(error: unknown) {
  if (error instanceof Error && /unique|constraint/i.test(error.message)) {
    return true
  }
  const cause = error && typeof error === 'object' && 'cause' in error ? (error as { cause?: unknown }).cause : null
  return cause instanceof Error && /unique|constraint/i.test(cause.message)
}

const listStoresRoute = createRoute({
  method: 'get',
  path: '/',
  operationId: 'listMemoryStores',
  tags: ['Memory Stores'],
  summary: 'List memory stores',
  ...AuthenticatedOperation,
  request: { query: StoreListQuerySchema },
  responses: {
    200: { description: 'Memory store list', content: { 'application/json': { schema: StoreListResponseSchema } } },
    400: { description: 'Validation error', content: { 'application/json': { schema: ErrorResponseSchema } } },
    401: { description: 'Authentication required', content: { 'application/json': { schema: ErrorResponseSchema } } },
  },
})

const createStoreRoute = createRoute({
  method: 'post',
  path: '/',
  operationId: 'createMemoryStore',
  tags: ['Memory Stores'],
  summary: 'Create a memory store',
  ...AuthenticatedOperation,
  request: { body: { required: true, content: { 'application/json': { schema: CreateMemoryStoreSchema } } } },
  responses: {
    201: { description: 'Created memory store', content: { 'application/json': { schema: MemoryStoreSchema } } },
    400: { description: 'Validation error', content: { 'application/json': { schema: ErrorResponseSchema } } },
    401: { description: 'Authentication required', content: { 'application/json': { schema: ErrorResponseSchema } } },
  },
})

const readStoreRoute = createRoute({
  method: 'get',
  path: '/{storeId}',
  operationId: 'readMemoryStore',
  tags: ['Memory Stores'],
  summary: 'Read a memory store',
  ...AuthenticatedOperation,
  request: { params: StoreParamsSchema },
  responses: {
    200: { description: 'Memory store', content: { 'application/json': { schema: MemoryStoreSchema } } },
    401: { description: 'Authentication required', content: { 'application/json': { schema: ErrorResponseSchema } } },
    404: { description: 'Memory store not found', content: { 'application/json': { schema: ErrorResponseSchema } } },
  },
})

const updateStoreRoute = createRoute({
  method: 'patch',
  path: '/{storeId}',
  operationId: 'updateMemoryStore',
  tags: ['Memory Stores'],
  summary: 'Update or archive a memory store',
  ...AuthenticatedOperation,
  request: {
    params: StoreParamsSchema,
    body: { required: true, content: { 'application/json': { schema: UpdateMemoryStoreSchema } } },
  },
  responses: {
    200: { description: 'Updated memory store', content: { 'application/json': { schema: MemoryStoreSchema } } },
    400: { description: 'Validation error', content: { 'application/json': { schema: ErrorResponseSchema } } },
    401: { description: 'Authentication required', content: { 'application/json': { schema: ErrorResponseSchema } } },
    404: { description: 'Memory store not found', content: { 'application/json': { schema: ErrorResponseSchema } } },
  },
})

const listMemoriesRoute = createRoute({
  method: 'get',
  path: '/{storeId}/memories',
  operationId: 'listMemoryStoreMemories',
  tags: ['Memory Stores'],
  summary: 'List memories in a memory store',
  ...AuthenticatedOperation,
  request: { params: StoreParamsSchema, query: MemoryListQuerySchema },
  responses: {
    200: { description: 'Memory list', content: { 'application/json': { schema: MemoryListResponseSchema } } },
    400: { description: 'Validation error', content: { 'application/json': { schema: ErrorResponseSchema } } },
    401: { description: 'Authentication required', content: { 'application/json': { schema: ErrorResponseSchema } } },
    404: { description: 'Memory store not found', content: { 'application/json': { schema: ErrorResponseSchema } } },
  },
})

const createMemoryRoute = createRoute({
  method: 'post',
  path: '/{storeId}/memories',
  operationId: 'createMemoryStoreMemory',
  tags: ['Memory Stores'],
  summary: 'Create a memory in a memory store',
  ...AuthenticatedOperation,
  request: {
    params: StoreParamsSchema,
    body: { required: true, content: { 'application/json': { schema: CreateMemorySchema } } },
  },
  responses: {
    201: { description: 'Created memory', content: { 'application/json': { schema: MemoryStoreMemorySchema } } },
    400: { description: 'Validation error', content: { 'application/json': { schema: ErrorResponseSchema } } },
    401: { description: 'Authentication required', content: { 'application/json': { schema: ErrorResponseSchema } } },
    404: { description: 'Memory store not found', content: { 'application/json': { schema: ErrorResponseSchema } } },
    409: { description: 'Memory path conflict', content: { 'application/json': { schema: ErrorResponseSchema } } },
  },
})

const updateMemoryRoute = createRoute({
  method: 'patch',
  path: '/{storeId}/memories/{memoryId}',
  operationId: 'updateMemoryStoreMemory',
  tags: ['Memory Stores'],
  summary: 'Update a memory',
  ...AuthenticatedOperation,
  request: {
    params: MemoryParamsSchema,
    body: { required: true, content: { 'application/json': { schema: UpdateMemorySchema } } },
  },
  responses: {
    200: { description: 'Updated memory', content: { 'application/json': { schema: MemoryStoreMemorySchema } } },
    400: { description: 'Validation error', content: { 'application/json': { schema: ErrorResponseSchema } } },
    401: { description: 'Authentication required', content: { 'application/json': { schema: ErrorResponseSchema } } },
    404: { description: 'Memory not found', content: { 'application/json': { schema: ErrorResponseSchema } } },
    409: { description: 'Memory path conflict', content: { 'application/json': { schema: ErrorResponseSchema } } },
  },
})

const deleteMemoryRoute = createRoute({
  method: 'delete',
  path: '/{storeId}/memories/{memoryId}',
  operationId: 'deleteMemoryStoreMemory',
  tags: ['Memory Stores'],
  summary: 'Delete a memory',
  ...AuthenticatedOperation,
  request: { params: MemoryParamsSchema },
  responses: {
    204: { description: 'Memory deleted' },
    401: { description: 'Authentication required', content: { 'application/json': { schema: ErrorResponseSchema } } },
    404: { description: 'Memory not found', content: { 'application/json': { schema: ErrorResponseSchema } } },
  },
})

export function registerMemoryStoreRoutes(routes: MemoryStoreRoutes) {
  return routes
    .openapi(listStoresRoute, async (c) => {
      const deps = c.get('deps')
      const memoryStores = memoryStoresRepo(deps)
      const auth = await requireAuth(c)
      if (auth instanceof Response) return auth
      const { archived, search, createdFrom, createdTo, limit = 50, cursor } = c.req.valid('query')
      let parsedCursor: { createdAt: string; id: string } | null = null
      try {
        parsedCursor = cursor ? parseListCursor(cursor) : null
      } catch {
        return c.json(validation('Invalid list cursor', { cursor: 'Cursor is invalid.' }), 400)
      }
      const page = await memoryStores.list({
        projectId: auth.project.id,
        archived: archived === 'true',
        ...(search ? { search } : {}),
        ...(createdFrom ? { createdFrom } : {}),
        ...(createdTo ? { createdTo } : {}),
        limit,
        cursor: parsedCursor,
      })
      const last = page.rows.at(-1)
      const nextCursor =
        page.hasMore && last ? formatListCursor({ createdAt: last.metadata.createdAt, id: last.metadata.uid }) : null
      return c.json(
        { data: page.rows.map(serializeResource), pagination: { limit, nextCursor, hasMore: page.hasMore } },
        200,
      )
    })
    .openapi(createStoreRoute, async (c) => {
      const deps = c.get('deps')
      const memoryStores = memoryStoresRepo(deps)
      const auth = await requireAuth(c)
      if (auth instanceof Response) return auth
      const body = c.req.valid('json')
      const store = await memoryStores.insert(
        {
          projectId: auth.project.id,
          name: body.metadata.name,
          description: body.metadata.description ?? null,
        },
        new Date().toISOString(),
      )
      await deps.audit.record(auth, {
        action: 'memory_store.create',
        resourceType: 'memory_store',
        resourceId: store.metadata.uid,
        outcome: 'success',
        requestId: requestId(c),
        after: store,
      })
      return c.json(serializeResource(store), 201)
    })
    .openapi(readStoreRoute, async (c) => {
      const deps = c.get('deps')
      const memoryStores = memoryStoresRepo(deps)
      const auth = await requireAuth(c)
      if (auth instanceof Response) return auth
      const { storeId } = c.req.valid('param')
      const store = await memoryStores.find(auth.project.id, storeId)
      if (!store) return c.json(notFound('Memory store not found'), 404)
      return c.json(serializeResource(store), 200)
    })
    .openapi(updateStoreRoute, async (c) => {
      const deps = c.get('deps')
      const memoryStores = memoryStoresRepo(deps)
      const auth = await requireAuth(c)
      if (auth instanceof Response) return auth
      const { storeId } = c.req.valid('param')
      const body = c.req.valid('json')
      const current = await memoryStores.find(auth.project.id, storeId)
      if (!current) return c.json(notFound('Memory store not found'), 404)
      const updatedAt = new Date().toISOString()
      await memoryStores.update(
        auth.project.id,
        storeId,
        {
          name: body.metadata?.name ?? current.metadata.name,
          description:
            body.metadata?.description !== undefined ? body.metadata.description : current.metadata.description,
          archivedAt: body.archived === undefined ? current.metadata.archivedAt : body.archived ? updatedAt : null,
        },
        updatedAt,
      )
      const updated = await memoryStores.find(auth.project.id, storeId)
      if (!updated) throw new Error('Updated memory store row is required')
      await deps.audit.record(auth, {
        action: 'memory_store.update',
        resourceType: 'memory_store',
        resourceId: storeId,
        outcome: 'success',
        requestId: requestId(c),
        before: current,
        after: updated,
      })
      return c.json(serializeResource(updated), 200)
    })
    .openapi(listMemoriesRoute, async (c) => {
      const deps = c.get('deps')
      const memoryStores = memoryStoresRepo(deps)
      const auth = await requireAuth(c)
      if (auth instanceof Response) return auth
      const { storeId } = c.req.valid('param')
      const { limit = 50, cursor } = c.req.valid('query')
      const store = await memoryStores.find(auth.project.id, storeId)
      if (!store) return c.json(notFound('Memory store not found'), 404)
      let parsedCursor: { createdAt: string; id: string } | null = null
      try {
        parsedCursor = cursor ? parseListCursor(cursor) : null
      } catch {
        return c.json(validation('Invalid list cursor', { cursor: 'Cursor is invalid.' }), 400)
      }
      const page = await memoryStores.listMemories({ projectId: auth.project.id, storeId, limit, cursor: parsedCursor })
      const last = page.rows.at(-1)
      const nextCursor =
        page.hasMore && last ? formatListCursor({ createdAt: last.metadata.createdAt, id: last.metadata.uid }) : null
      return c.json(
        { data: page.rows.map(serializeResource), pagination: { limit, nextCursor, hasMore: page.hasMore } },
        200,
      )
    })
    .openapi(createMemoryRoute, async (c) => {
      const deps = c.get('deps')
      const memoryStores = memoryStoresRepo(deps)
      const auth = await requireAuth(c)
      if (auth instanceof Response) return auth
      const { storeId } = c.req.valid('param')
      const body = c.req.valid('json')
      const store = await memoryStores.find(auth.project.id, storeId)
      if (!store || store.metadata.archivedAt) return c.json(notFound('Memory store not found'), 404)
      const normalized = normalizePathInput(body.path)
      if ('error' in normalized) return c.json(validation('Invalid memory path', { path: normalized.error }), 400)
      try {
        const memory = await memoryStores.insertMemory(
          {
            storeId,
            projectId: auth.project.id,
            path: normalized.path,
            content: body.content,
            metadata: body.metadata ?? {},
          },
          new Date().toISOString(),
        )
        await deps.audit.record(auth, {
          action: 'memory_store.memory.create',
          resourceType: 'memory_store',
          resourceId: storeId,
          outcome: 'success',
          requestId: requestId(c),
          after: { id: memory.metadata.uid, path: memory.spec.path },
        })
        return c.json(serializeResource(memory), 201)
      } catch (error) {
        if (isUniqueError(error)) return c.json(conflict('Memory path already exists'), 409)
        throw error
      }
    })
    .openapi(updateMemoryRoute, async (c) => {
      const deps = c.get('deps')
      const memoryStores = memoryStoresRepo(deps)
      const auth = await requireAuth(c)
      if (auth instanceof Response) return auth
      const { storeId, memoryId } = c.req.valid('param')
      const body = c.req.valid('json')
      const current = await memoryStores.findMemory(auth.project.id, storeId, memoryId)
      if (!current) return c.json(notFound('Memory not found'), 404)
      let path = current.spec.path
      if (body.path !== undefined) {
        const normalized = normalizePathInput(body.path)
        if ('error' in normalized) return c.json(validation('Invalid memory path', { path: normalized.error }), 400)
        path = normalized.path
      }
      try {
        await memoryStores.updateMemory(
          auth.project.id,
          storeId,
          memoryId,
          {
            path,
            content: body.content ?? current.spec.content,
            metadata: body.metadata ?? current.spec.metadata,
          },
          new Date().toISOString(),
        )
        const updated = await memoryStores.findMemory(auth.project.id, storeId, memoryId)
        if (!updated) throw new Error('Updated memory row is required')
        await deps.audit.record(auth, {
          action: 'memory_store.memory.update',
          resourceType: 'memory_store',
          resourceId: storeId,
          outcome: 'success',
          requestId: requestId(c),
          before: { id: current.metadata.uid, path: current.spec.path },
          after: { id: updated.metadata.uid, path: updated.spec.path },
        })
        return c.json(serializeResource(updated), 200)
      } catch (error) {
        if (isUniqueError(error)) return c.json(conflict('Memory path already exists'), 409)
        throw error
      }
    })
    .openapi(deleteMemoryRoute, async (c) => {
      const deps = c.get('deps')
      const memoryStores = memoryStoresRepo(deps)
      const auth = await requireAuth(c)
      if (auth instanceof Response) return auth
      const { storeId, memoryId } = c.req.valid('param')
      const current = await memoryStores.findMemory(auth.project.id, storeId, memoryId)
      if (!current) return c.json(notFound('Memory not found'), 404)
      await memoryStores.deleteMemory(auth.project.id, storeId, memoryId)
      await deps.audit.record(auth, {
        action: 'memory_store.memory.delete',
        resourceType: 'memory_store',
        resourceId: storeId,
        outcome: 'success',
        requestId: requestId(c),
        before: { id: current.metadata.uid, path: current.spec.path },
      })
      return c.body(null, 204)
    })
}
