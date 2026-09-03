import { createRoute, type OpenAPIHono, z } from '@hono/zod-openapi'
import {
  ResourceCreateMetadataSchema,
  ResourceMetadataSchema,
  ResourcePhaseSchema,
  ResourceUpdateMetadataSchema,
  serializeResource,
} from '@server/contracts/resource-contracts'
import { requireAuth } from '../auth/session'
import {
  EnvironmentNetworkingSchema,
  EnvironmentPackagesSchema,
  EnvironmentScopeSchema,
  EnvironmentTypeSchema,
} from '../contracts/environment-contracts'
import {
  AuthenticatedOperation,
  type DepsEnv,
  ErrorResponseSchema,
  formatListCursor,
  listQuerySchema,
  listResponseSchema,
  parseListCursor,
} from '../openapi'
import { createEnvironment, type UpdateEnvironmentPatch, updateEnvironment } from '../usecases/environments'
import {
  CreationIdempotencyConflictError,
  EnvironmentValidationError,
  ResourceDeletedDuringMutationError,
} from '../usecases/ports'
import { requestId } from './request-context'

type EnvironmentRoutes = OpenAPIHono<DepsEnv>

const VariableSchema = z
  .object({
    description: z.string().max(500).optional(),
    required: z.boolean().optional(),
  })
  .strict()

const EnvironmentSpecSchema = z
  .object({
    scope: EnvironmentScopeSchema.openapi({ example: 'organization' }),
    type: EnvironmentTypeSchema.openapi({ example: 'cloud' }),
    networking: EnvironmentNetworkingSchema.openapi({
      example: {
        type: 'limited',
        allowMcpServers: false,
        allowPackageManagers: true,
        allowedHosts: ['api.example.com'],
      },
    }),
    packages: EnvironmentPackagesSchema,
    variables: z.record(z.string(), VariableSchema).openapi({ example: { NODE_ENV: { description: 'Runtime mode' } } }),
  })
  .openapi('EnvironmentSpec')

const EnvironmentStatusSchema = z
  .object({
    phase: ResourcePhaseSchema,
    currentVersionId: z.string().nullable().openapi({ example: '0195f5d6-7c20-7000-8000-000000000006' }),
    version: z.number().int().openapi({ example: 1 }),
  })
  .openapi('EnvironmentStatus')

const EnvironmentSchema = z
  .object({
    metadata: ResourceMetadataSchema,
    spec: EnvironmentSpecSchema,
    status: EnvironmentStatusSchema,
  })
  .openapi('Environment')

const EnvironmentVersionSchema = z
  .object({
    metadata: ResourceMetadataSchema,
    spec: EnvironmentSpecSchema,
    status: z
      .object({
        environmentId: z.string().openapi({ example: '0195f5d6-7c20-7000-8000-000000000005' }),
        version: z.number().int().openapi({ example: 1 }),
      })
      .openapi('EnvironmentVersionStatus'),
  })
  .openapi('EnvironmentVersion')

const EnvironmentPayloadSchema = z
  .object({
    metadata: ResourceCreateMetadataSchema.openapi({ example: { name: 'Node workspace' } }),
    spec: z
      .object({
        scope: EnvironmentScopeSchema.optional(),
        type: EnvironmentTypeSchema.optional(),
        networking: EnvironmentNetworkingSchema.optional(),
        packages: EnvironmentPackagesSchema.optional(),
        variables: z
          .record(z.string().min(1).max(120), VariableSchema)
          .optional()
          .openapi({ example: { NODE_ENV: { required: true } } }),
      })
      .strict(),
  })
  .strict()
const CreateEnvironmentSchema = EnvironmentPayloadSchema.openapi('CreateEnvironmentRequest')
const UpdateEnvironmentSchema = z
  .object({
    metadata: ResourceUpdateMetadataSchema.optional(),
    spec: EnvironmentPayloadSchema.shape.spec.partial().optional(),
  })
  .strict()
  .refine((body) => body.metadata !== undefined || body.spec !== undefined, {
    message: 'Provide metadata or spec.',
  })
  .openapi('UpdateEnvironmentRequest')

const EnvironmentParamsSchema = z.object({
  environmentId: z.string().openapi({
    param: { name: 'environmentId', in: 'path' },
    example: '0195f5d6-7c20-7000-8000-000000000005',
  }),
})
const EnvironmentVersionParamsSchema = EnvironmentParamsSchema.extend({
  version: z.coerce
    .number()
    .int()
    .min(1)
    .openapi({
      param: { name: 'version', in: 'path' },
      example: 1,
    }),
})
const ListQuerySchema = listQuerySchema()
const EnvironmentListResponseSchema = listResponseSchema('EnvironmentListResponse', EnvironmentSchema)
const EnvironmentVersionListResponseSchema = listResponseSchema(
  'EnvironmentVersionListResponse',
  EnvironmentVersionSchema,
)

function domainValidation(message: string, fields: Record<string, string>) {
  return { error: { type: 'validation_error', message, details: { fields } } } as const
}

const listRoute = createRoute({
  method: 'get',
  path: '/',
  operationId: 'listEnvironments',
  tags: ['Environments'],
  summary: 'List environments',
  ...AuthenticatedOperation,
  request: { query: ListQuerySchema },
  responses: {
    200: {
      description: 'Environment list',
      content: { 'application/json': { schema: EnvironmentListResponseSchema } },
    },
    400: { description: 'Validation error', content: { 'application/json': { schema: ErrorResponseSchema } } },
    401: { description: 'Authentication required', content: { 'application/json': { schema: ErrorResponseSchema } } },
  },
})

const createEnvironmentRoute = createRoute({
  method: 'post',
  path: '/',
  operationId: 'createEnvironment',
  tags: ['Environments'],
  summary: 'Create an environment',
  ...AuthenticatedOperation,
  request: {
    headers: z.object({ 'idempotency-key': z.string().min(8).max(200).optional() }),
    body: { required: true, content: { 'application/json': { schema: CreateEnvironmentSchema } } },
  },
  responses: {
    201: { description: 'Created environment', content: { 'application/json': { schema: EnvironmentSchema } } },
    400: { description: 'Validation error', content: { 'application/json': { schema: ErrorResponseSchema } } },
    401: { description: 'Authentication required', content: { 'application/json': { schema: ErrorResponseSchema } } },
    409: { description: 'Idempotency conflict', content: { 'application/json': { schema: ErrorResponseSchema } } },
  },
})

const readRoute = createRoute({
  method: 'get',
  path: '/{environmentId}',
  operationId: 'readEnvironment',
  tags: ['Environments'],
  summary: 'Read an environment',
  ...AuthenticatedOperation,
  request: { params: EnvironmentParamsSchema },
  responses: {
    200: { description: 'Environment', content: { 'application/json': { schema: EnvironmentSchema } } },
    401: { description: 'Authentication required', content: { 'application/json': { schema: ErrorResponseSchema } } },
    404: { description: 'Environment not found', content: { 'application/json': { schema: ErrorResponseSchema } } },
  },
})

const updateRoute = createRoute({
  method: 'patch',
  path: '/{environmentId}',
  operationId: 'updateEnvironment',
  tags: ['Environments'],
  summary: 'Update an environment',
  description: 'Partially updates a live environment.',
  ...AuthenticatedOperation,
  request: {
    params: EnvironmentParamsSchema,
    body: { required: true, content: { 'application/json': { schema: UpdateEnvironmentSchema } } },
  },
  responses: {
    200: { description: 'Updated environment', content: { 'application/json': { schema: EnvironmentSchema } } },
    400: { description: 'Validation error', content: { 'application/json': { schema: ErrorResponseSchema } } },
    401: { description: 'Authentication required', content: { 'application/json': { schema: ErrorResponseSchema } } },
    404: { description: 'Environment not found', content: { 'application/json': { schema: ErrorResponseSchema } } },
  },
})

const deleteRoute = createRoute({
  method: 'delete',
  path: '/{environmentId}',
  operationId: 'deleteEnvironment',
  tags: ['Environments'],
  summary: 'Delete an environment',
  description: 'Soft-deletes the environment. The retained tombstone cannot be restored through the API.',
  ...AuthenticatedOperation,
  request: { params: EnvironmentParamsSchema },
  responses: {
    204: { description: 'Environment deleted' },
    401: { description: 'Authentication required', content: { 'application/json': { schema: ErrorResponseSchema } } },
    404: { description: 'Environment not found', content: { 'application/json': { schema: ErrorResponseSchema } } },
  },
})

const versionsRoute = createRoute({
  method: 'get',
  path: '/{environmentId}/versions',
  operationId: 'listEnvironmentVersions',
  tags: ['Environments'],
  summary: 'List environment versions',
  ...AuthenticatedOperation,
  request: { params: EnvironmentParamsSchema },
  responses: {
    200: {
      description: 'Environment versions',
      content: { 'application/json': { schema: EnvironmentVersionListResponseSchema } },
    },
    401: { description: 'Authentication required', content: { 'application/json': { schema: ErrorResponseSchema } } },
    404: { description: 'Environment not found', content: { 'application/json': { schema: ErrorResponseSchema } } },
  },
})

const versionItemRoute = createRoute({
  method: 'get',
  path: '/{environmentId}/versions/{version}',
  operationId: 'readEnvironmentVersion',
  tags: ['Environments'],
  summary: 'Read an environment version',
  ...AuthenticatedOperation,
  request: { params: EnvironmentVersionParamsSchema },
  responses: {
    200: { description: 'Environment version', content: { 'application/json': { schema: EnvironmentVersionSchema } } },
    400: { description: 'Validation error', content: { 'application/json': { schema: ErrorResponseSchema } } },
    401: { description: 'Authentication required', content: { 'application/json': { schema: ErrorResponseSchema } } },
    404: {
      description: 'Environment or version not found',
      content: { 'application/json': { schema: ErrorResponseSchema } },
    },
  },
})

// Registration order is load-bearing: requireAuth is the per-route auth wall and
// static segments register before parameter segments. The assembler in app.ts
// calls this at the environments resource's original mount position.
export function registerEnvironmentRoutes(routes: EnvironmentRoutes) {
  return routes
    .openapi(listRoute, async (c) => {
      const deps = c.get('deps')
      const auth = await requireAuth(c)
      if (auth instanceof Response) {
        return auth
      }
      const { search, createdFrom, createdTo, limit = 50, cursor } = c.req.valid('query')
      let parsedCursor: { createdAt: string; id: string } | null = null
      try {
        parsedCursor = cursor ? parseListCursor(cursor) : null
      } catch {
        return c.json(domainValidation('Invalid list cursor', { cursor: 'Cursor is invalid.' }), 400)
      }
      const page = await deps.environments.list({
        projectId: auth.project.id,
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
        {
          data: page.rows.map(serializeResource),
          pagination: { limit, nextCursor, hasMore: page.hasMore },
        },
        200,
      )
    })
    .openapi(createEnvironmentRoute, async (c) => {
      const body = c.req.valid('json')
      const headers = c.req.valid('header')
      const deps = c.get('deps')
      const auth = await requireAuth(c)
      if (auth instanceof Response) {
        return auth
      }
      try {
        const environment = await createEnvironment(deps, auth, {
          name: body.metadata.name,
          description: body.metadata.description ?? null,
          config: configFromPayload(body),
          ...(headers['idempotency-key'] ? { idempotencyKey: headers['idempotency-key'] } : {}),
        })
        return c.json(serializeResource(environment), 201)
      } catch (error) {
        return createValidationOr(c, error)
      }
    })
    .openapi(readRoute, async (c) => {
      const { environmentId } = c.req.valid('param')
      const deps = c.get('deps')
      const auth = await requireAuth(c)
      if (auth instanceof Response) {
        return auth
      }
      const environment = await deps.environments.find(auth.project.id, environmentId)
      if (!environment) {
        return notFound(c)
      }
      return c.json(serializeResource(environment), 200)
    })
    .openapi(updateRoute, async (c) => {
      const { environmentId } = c.req.valid('param')
      const body = c.req.valid('json')
      const deps = c.get('deps')
      const auth = await requireAuth(c)
      if (auth instanceof Response) {
        return auth
      }
      const environment = await deps.environments.find(auth.project.id, environmentId)
      if (!environment) {
        return notFound(c)
      }
      const scope = auth
      try {
        const result = await updateEnvironment(deps, scope, environment, patchFromBody(body))
        return c.json(serializeResource(result.environment), 200)
      } catch (error) {
        return validationOr(c, error)
      }
    })
    .openapi(deleteRoute, async (c) => {
      const deps = c.get('deps')
      const auth = await requireAuth(c)
      if (auth instanceof Response) return auth
      const { environmentId } = c.req.valid('param')
      const environment = await deps.environments.find(auth.project.id, environmentId)
      if (!environment) return notFound(c)
      if (!(await deps.environments.delete(auth.project.id, environmentId, new Date().toISOString())))
        return notFound(c)
      await deps.audit.record(auth, {
        action: 'environment.delete',
        resourceType: 'environment',
        resourceId: environmentId,
        outcome: 'success',
        requestId: requestId(c),
        before: environment,
      })
      return c.body(null, 204)
    })
    .openapi(versionsRoute, async (c) => {
      const { environmentId } = c.req.valid('param')
      const deps = c.get('deps')
      const auth = await requireAuth(c)
      if (auth instanceof Response) {
        return auth
      }
      const environment = await deps.environments.find(auth.project.id, environmentId)
      if (!environment) {
        return notFound(c)
      }
      const versions = await deps.environments.listVersions(auth.project.id, environmentId)
      return c.json(
        {
          data: versions.map(serializeResource),
          pagination: { limit: versions.length, nextCursor: null, hasMore: false },
        },
        200,
      )
    })
    .openapi(versionItemRoute, async (c) => {
      const { environmentId, version } = c.req.valid('param')
      const deps = c.get('deps')
      const auth = await requireAuth(c)
      if (auth instanceof Response) {
        return auth
      }
      const environment = await deps.environments.find(auth.project.id, environmentId)
      if (!environment) {
        return notFound(c)
      }
      const row = await deps.environments.findVersion(auth.project.id, environmentId, version)
      if (!row) {
        return c.json({ error: { type: 'not_found', message: 'Environment version not found' } }, 404)
      }
      return c.json(serializeResource(row), 200)
    })
}

// --- helpers ---

function configFromPayload(body: z.infer<typeof EnvironmentPayloadSchema>) {
  const spec = body.spec
  return {
    scope: spec.scope ?? ('project' as const),
    type: spec.type ?? ('cloud' as const),
    networking: spec.networking ?? { type: 'open' as const, allowMcpServers: false, allowPackageManagers: true },
    packages: spec.packages ?? {
      type: 'packages' as const,
      apt: [],
      cargo: [],
      gem: [],
      go: [],
      npm: [],
      pip: [],
      webi: [],
    },
    variables: spec.variables ?? {},
  }
}

// Builds the usecase patch from the validated PATCH body: only present fields
// are forwarded (so an absent field is distinct from an explicit null).
function patchFromBody(body: z.infer<typeof UpdateEnvironmentSchema>): UpdateEnvironmentPatch {
  const spec = body.spec
  return {
    ...(body.metadata?.name !== undefined ? { name: body.metadata.name } : {}),
    ...(body.metadata?.description !== undefined ? { description: body.metadata.description } : {}),
    ...(spec?.scope !== undefined ? { scope: spec.scope } : {}),
    ...(spec?.type !== undefined ? { type: spec.type } : {}),
    ...(spec?.networking !== undefined ? { networking: spec.networking } : {}),
    ...(spec?.packages !== undefined ? { packages: spec.packages } : {}),
    ...(spec?.variables !== undefined ? { variables: spec.variables } : {}),
  }
}

function notFound(c: Parameters<Parameters<EnvironmentRoutes['openapi']>[1]>[0]) {
  return c.json({ error: { type: 'not_found', message: 'Environment not found' } }, 404)
}

function validationOr(c: Parameters<Parameters<EnvironmentRoutes['openapi']>[1]>[0], error: unknown) {
  if (error instanceof ResourceDeletedDuringMutationError) return notFound(c)
  if (error instanceof EnvironmentValidationError) {
    return c.json(domainValidation(error.message, error.fields), 400)
  }
  throw error
}

function createValidationOr(c: Parameters<Parameters<EnvironmentRoutes['openapi']>[1]>[0], error: unknown) {
  if (error instanceof ResourceDeletedDuringMutationError) {
    return c.json(
      { error: { type: 'conflict', message: 'Project was deleted while Environment creation was in progress' } },
      409,
    )
  }
  if (error instanceof EnvironmentValidationError) {
    return c.json(domainValidation(error.message, error.fields), 400)
  }
  if (error instanceof CreationIdempotencyConflictError) {
    return c.json({ error: { type: error.code, message: error.message } }, 409)
  }
  throw error
}
