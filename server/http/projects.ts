import { createRoute, type OpenAPIHono, z } from '@hono/zod-openapi'
import { requireAuthIdentity } from '../auth/session'
import {
  AuthenticatedOperation,
  type DepsEnv,
  ErrorResponseSchema,
  formatListCursor,
  listResponseSchema,
  parseListCursor,
} from '../openapi'
import type { ProjectRecord } from '../usecases/ports'
import { createProject, listProjects } from '../usecases/projects'

// Mounted at /api/v1/projects (docs/api-v1-design.md §2 Projects).

type ProjectRoutes = OpenAPIHono<DepsEnv>

const ProjectSchema = z
  .object({
    id: z.string().openapi({ example: '0195f5d6-7c20-7000-8000-000000000001' }),
    name: z.string().openapi({ example: 'Control Plane' }),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .openapi('Project')

const CreateProjectSchema = z
  .object({
    name: z.string().min(1).max(120).openapi({ example: 'Control Plane' }),
  })
  .openapi('CreateProjectRequest')

const ProjectListResponseSchema = listResponseSchema('ProjectListResponse', ProjectSchema)

const ProjectListQuerySchema = z.object({
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(100)
    .optional()
    .openapi({
      param: { name: 'limit', in: 'query' },
      example: 50,
    }),
  cursor: z
    .string()
    .min(1)
    .max(512)
    .optional()
    .openapi({
      param: { name: 'cursor', in: 'query' },
      example: 'eyJjcmVhdGVkQXQiOiIyMDI2LTA1LTIyVDAwOjAwOjAwLjAwMFoiLCJpZCI6InByb2plY3RfYWJjMTIzIn0',
    }),
})

const ProjectParamsSchema = z.object({
  projectId: z
    .string()
    .openapi({ param: { name: 'projectId', in: 'path' }, example: '0195f5d6-7c20-7000-8000-000000000001' }),
})

function errorBody(type: string, message: string, details?: Record<string, unknown>) {
  return { error: { type, message, ...(details ? { details } : {}) } } as const
}

// organizationId stays in the DB for tenancy but never leaves the API.
function serializeProject(record: ProjectRecord) {
  return {
    id: record.id,
    name: record.name,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  }
}

const listProjectsRoute = createRoute({
  method: 'get',
  path: '/',
  operationId: 'listProjects',
  tags: ['Projects'],
  summary: 'List projects in the current organization',
  ...AuthenticatedOperation,
  request: { query: ProjectListQuerySchema },
  responses: {
    200: {
      description: 'Projects in the current organization',
      content: { 'application/json': { schema: ProjectListResponseSchema } },
    },
    400: { description: 'Validation error', content: { 'application/json': { schema: ErrorResponseSchema } } },
    401: { description: 'Authentication required', content: { 'application/json': { schema: ErrorResponseSchema } } },
  },
})

const createProjectRoute = createRoute({
  method: 'post',
  path: '/',
  operationId: 'createProject',
  tags: ['Projects'],
  summary: 'Create a project in the current organization',
  ...AuthenticatedOperation,
  request: { body: { required: true, content: { 'application/json': { schema: CreateProjectSchema } } } },
  responses: {
    201: { description: 'Created project', content: { 'application/json': { schema: ProjectSchema } } },
    401: { description: 'Authentication required', content: { 'application/json': { schema: ErrorResponseSchema } } },
  },
})

const readProjectRoute = createRoute({
  method: 'get',
  path: '/{projectId}',
  operationId: 'readProject',
  tags: ['Projects'],
  summary: 'Read a single project',
  ...AuthenticatedOperation,
  request: { params: ProjectParamsSchema },
  responses: {
    200: { description: 'Project', content: { 'application/json': { schema: ProjectSchema } } },
    401: { description: 'Authentication required', content: { 'application/json': { schema: ErrorResponseSchema } } },
    404: { description: 'Project not found', content: { 'application/json': { schema: ErrorResponseSchema } } },
  },
})

// Registration order is load-bearing: requireAuthIdentity is the per-route auth
// wall (org-scoped — projects predate project resolution) and static segments
// register before parameter segments. The assembler in app.ts calls this at the
// projects resource's original mount position.
export function registerProjectRoutes(routes: ProjectRoutes) {
  return routes
    .openapi(listProjectsRoute, async (c) => {
      const auth = await requireAuthIdentity(c)
      if (auth instanceof Response) {
        return auth
      }
      const deps = c.get('deps')
      const query = c.req.valid('query')
      const limit = query.limit ?? 50
      let parsedCursor: { createdAt: string; id: string } | null = null
      try {
        parsedCursor = query.cursor ? parseListCursor(query.cursor) : null
      } catch {
        return c.json(errorBody('validation_error', 'Invalid list cursor', { cursor: 'Cursor is invalid.' }), 400)
      }
      const page = await listProjects(deps, auth, { limit, cursor: parsedCursor })
      const last = page.rows.at(-1)
      const nextCursor = page.hasMore && last ? formatListCursor({ createdAt: last.createdAt, id: last.id }) : null
      return c.json(
        { data: page.rows.map(serializeProject), pagination: { limit, nextCursor, hasMore: page.hasMore } },
        200,
      )
    })
    .openapi(createProjectRoute, async (c) => {
      const auth = await requireAuthIdentity(c)
      if (auth instanceof Response) {
        return auth
      }
      const deps = c.get('deps')
      const project = await createProject(deps, auth, c.req.valid('json').name)
      return c.json(serializeProject(project), 201)
    })
    .openapi(readProjectRoute, async (c) => {
      const auth = await requireAuthIdentity(c)
      if (auth instanceof Response) {
        return auth
      }
      const deps = c.get('deps')
      const { projectId } = c.req.valid('param')
      const project = await deps.projects.find(auth.organization.id, projectId)
      if (!project) {
        return c.json(errorBody('not_found', 'Project not found'), 404)
      }
      return c.json(serializeProject(project), 200)
    })
}

// --- helpers ---
