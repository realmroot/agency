import { createRoute, type OpenAPIHono, z } from '@hono/zod-openapi'
import { requireAuth } from '../auth/session'
import { AuthenticatedOperation, type DepsEnv, ErrorResponseSchema, listResponseSchema } from '../openapi'
import { type CreateBudgetInputDto, createBudget, type UpdateBudgetPatch, updateBudget } from '../usecases/budgets'
import { type BudgetRecord, GovernanceValidationError } from '../usecases/ports'
import { requestId } from './request-context'

type BudgetRoutes = OpenAPIHono<DepsEnv>

const JsonObjectSchema = z.record(z.string(), z.unknown())

const BudgetSchema = z
  .object({
    id: z.string(),
    scope: z.enum(['project', 'provider', 'model']),
    providerId: z.string().nullable(),
    modelId: z.string().nullable(),
    limitType: z.enum(['tokens', 'cost_micros', 'sessions']),
    limitValue: z.number().int(),
    window: z.enum(['day', 'month']),
    enabled: z.boolean(),
    metadata: JsonObjectSchema,
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .openapi('Budget')

const CreateBudgetSchema = z
  .object({
    scope: z.enum(['project', 'provider', 'model']).openapi({ example: 'project' }),
    providerId: z.string().min(1).optional().openapi({ example: 'workers-ai' }),
    modelId: z.string().min(1).optional().openapi({ example: '@cf/moonshotai/kimi-k2.6' }),
    limitType: z.enum(['tokens', 'cost_micros', 'sessions']).openapi({ example: 'tokens' }),
    limitValue: z.number().int().positive().openapi({ example: 1000000 }),
    window: z.enum(['day', 'month']).openapi({ example: 'month' }),
    enabled: z.boolean().optional().openapi({ example: true }),
    metadata: JsonObjectSchema.optional(),
  })
  .strict()
  .openapi('CreateBudgetRequest')

const UpdateBudgetSchema = z
  .object({
    limitValue: z.number().int().positive().optional(),
    window: z.enum(['day', 'month']).optional(),
    enabled: z.boolean().optional(),
    metadata: JsonObjectSchema.optional(),
  })
  .strict()
  .openapi('UpdateBudgetRequest')

const BudgetListResponseSchema = listResponseSchema('BudgetListResponse', BudgetSchema)

const BudgetParamsSchema = z.object({
  budgetId: z
    .string()
    .openapi({ param: { name: 'budgetId', in: 'path' }, example: '0195f5d6-7c20-7000-8000-000000000014' }),
})

function errorBody(type: string, message: string, details?: Record<string, unknown>) {
  return { error: { type, message, ...(details ? { details } : {}) } } as const
}

function serializeBudget(record: BudgetRecord) {
  return {
    id: record.id,
    scope: record.scope,
    providerId: record.providerId,
    modelId: record.modelId,
    limitType: record.limitType,
    limitValue: record.limitValue,
    window: record.window,
    enabled: record.enabled,
    metadata: record.metadata,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  }
}

const listRoute = createRoute({
  method: 'get',
  path: '/',
  operationId: 'listBudgets',
  tags: ['Governance'],
  summary: 'List budgets',
  ...AuthenticatedOperation,
  responses: {
    200: { description: 'Budgets', content: { 'application/json': { schema: BudgetListResponseSchema } } },
    401: { description: 'Authentication required', content: { 'application/json': { schema: ErrorResponseSchema } } },
  },
})

const createBudgetRoute = createRoute({
  method: 'post',
  path: '/',
  operationId: 'createBudget',
  tags: ['Governance'],
  summary: 'Create a budget',
  ...AuthenticatedOperation,
  request: { body: { required: true, content: { 'application/json': { schema: CreateBudgetSchema } } } },
  responses: {
    201: { description: 'Created budget', content: { 'application/json': { schema: BudgetSchema } } },
    400: { description: 'Validation error', content: { 'application/json': { schema: ErrorResponseSchema } } },
    401: { description: 'Authentication required', content: { 'application/json': { schema: ErrorResponseSchema } } },
  },
})

const readRoute = createRoute({
  method: 'get',
  path: '/{budgetId}',
  operationId: 'readBudget',
  tags: ['Governance'],
  summary: 'Read a budget',
  ...AuthenticatedOperation,
  request: { params: BudgetParamsSchema },
  responses: {
    200: { description: 'Budget', content: { 'application/json': { schema: BudgetSchema } } },
    401: { description: 'Authentication required', content: { 'application/json': { schema: ErrorResponseSchema } } },
    404: { description: 'Budget not found', content: { 'application/json': { schema: ErrorResponseSchema } } },
  },
})

const updateRoute = createRoute({
  method: 'patch',
  path: '/{budgetId}',
  operationId: 'updateBudget',
  tags: ['Governance'],
  summary: 'Update a budget',
  ...AuthenticatedOperation,
  request: {
    params: BudgetParamsSchema,
    body: { required: true, content: { 'application/json': { schema: UpdateBudgetSchema } } },
  },
  responses: {
    200: { description: 'Updated budget', content: { 'application/json': { schema: BudgetSchema } } },
    400: { description: 'Validation error', content: { 'application/json': { schema: ErrorResponseSchema } } },
    401: { description: 'Authentication required', content: { 'application/json': { schema: ErrorResponseSchema } } },
    404: { description: 'Budget not found', content: { 'application/json': { schema: ErrorResponseSchema } } },
  },
})

const deleteRoute = createRoute({
  method: 'delete',
  path: '/{budgetId}',
  operationId: 'deleteBudget',
  tags: ['Governance'],
  summary: 'Delete a budget',
  ...AuthenticatedOperation,
  request: { params: BudgetParamsSchema },
  responses: {
    204: { description: 'Budget deleted' },
    401: { description: 'Authentication required', content: { 'application/json': { schema: ErrorResponseSchema } } },
    404: { description: 'Budget not found', content: { 'application/json': { schema: ErrorResponseSchema } } },
  },
})

// Registration order is load-bearing: static segments register before parameter
// segments. The assembler in app.ts calls this at the budgets resource's
// original mount position.
export function registerBudgetRoutes(routes: BudgetRoutes) {
  return routes
    .openapi(listRoute, async (c) => {
      const deps = c.get('deps')
      const auth = await requireAuth(c)
      if (auth instanceof Response) {
        return auth
      }
      const records = await deps.budgets.list(auth.project.id)
      return c.json(
        {
          data: records.map(serializeBudget),
          pagination: { limit: records.length, nextCursor: null, hasMore: false },
        },
        200,
      )
    })
    .openapi(createBudgetRoute, async (c) => {
      const body = c.req.valid('json')
      const deps = c.get('deps')
      const auth = await requireAuth(c)
      if (auth instanceof Response) {
        return auth
      }
      const scope = auth
      try {
        const budget = await createBudget(deps, scope, inputFromBody(body))
        await deps.audit.record(scope, {
          action: 'budget.create',
          resourceType: 'budget',
          resourceId: budget.id,
          outcome: 'success',
          requestId: requestId(c),
          after: serializeBudget(budget),
        })
        return c.json(serializeBudget(budget), 201)
      } catch (error) {
        return validationOr(c, error)
      }
    })
    .openapi(readRoute, async (c) => {
      const { budgetId } = c.req.valid('param')
      const deps = c.get('deps')
      const auth = await requireAuth(c)
      if (auth instanceof Response) {
        return auth
      }
      const budget = await deps.budgets.find(auth.project.id, budgetId)
      if (!budget) {
        return c.json(errorBody('not_found', 'Budget not found'), 404)
      }
      return c.json(serializeBudget(budget), 200)
    })
    .openapi(updateRoute, async (c) => {
      const { budgetId } = c.req.valid('param')
      const body = c.req.valid('json')
      const deps = c.get('deps')
      const auth = await requireAuth(c)
      if (auth instanceof Response) {
        return auth
      }
      const existing = await deps.budgets.find(auth.project.id, budgetId)
      if (!existing) {
        return c.json(errorBody('not_found', 'Budget not found'), 404)
      }
      const scope = auth
      const budget = await updateBudget(deps, scope, existing, patchFromBody(body))
      await deps.audit.record(scope, {
        action: 'budget.update',
        resourceType: 'budget',
        resourceId: budget.id,
        outcome: 'success',
        requestId: requestId(c),
        before: serializeBudget(existing),
        after: serializeBudget(budget),
      })
      return c.json(serializeBudget(budget), 200)
    })
    .openapi(deleteRoute, async (c) => {
      const { budgetId } = c.req.valid('param')
      const deps = c.get('deps')
      const auth = await requireAuth(c)
      if (auth instanceof Response) {
        return auth
      }
      const existing = await deps.budgets.find(auth.project.id, budgetId)
      if (!existing) {
        return c.json(errorBody('not_found', 'Budget not found'), 404)
      }
      const scope = auth
      await deps.budgets.delete(auth.project.id, budgetId)
      await deps.audit.record(scope, {
        action: 'budget.delete',
        resourceType: 'budget',
        resourceId: existing.id,
        outcome: 'success',
        requestId: requestId(c),
        before: serializeBudget(existing),
      })
      return c.body(null, 204)
    })
}

// --- helpers ---

function inputFromBody(body: z.infer<typeof CreateBudgetSchema>): CreateBudgetInputDto {
  return {
    scope: body.scope,
    providerId: body.providerId ?? null,
    modelId: body.modelId ?? null,
    limitType: body.limitType,
    limitValue: body.limitValue,
    window: body.window,
    enabled: body.enabled ?? true,
    metadata: body.metadata ?? {},
  }
}

function patchFromBody(body: z.infer<typeof UpdateBudgetSchema>): UpdateBudgetPatch {
  return {
    ...(body.limitValue !== undefined ? { limitValue: body.limitValue } : {}),
    ...(body.window !== undefined ? { window: body.window } : {}),
    ...(body.enabled !== undefined ? { enabled: body.enabled } : {}),
    ...(body.metadata !== undefined ? { metadata: body.metadata } : {}),
  }
}

function validationOr(c: Parameters<Parameters<BudgetRoutes['openapi']>[1]>[0], error: unknown) {
  if (error instanceof GovernanceValidationError) {
    return c.json(errorBody('validation_error', error.message, { fields: error.fields }), 400)
  }
  throw error
}
