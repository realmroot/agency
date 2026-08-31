import { createRoute, type OpenAPIHono, z } from '@hono/zod-openapi'
import {
  ResourceCreateMetadataSchema,
  ResourceMetadataSchema,
  ResourcePhaseSchema,
  ResourceUpdateMetadataSchema,
  serializeResource,
} from '@server/contracts/resource-contracts'
import { type Agent, type AgentSpec, type AgentVersion, defaultAllowedTools } from '@server/domain/agent'
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
import { createAgent, type UpdateAgentPatch, updateAgent } from '../usecases/agents'
import { AgentArchivedError, AgentValidationError, IdentityAlreadyBoundError } from '../usecases/ports'
import { requestId } from './request-context'

type AgentRoutes = OpenAPIHono<DepsEnv>

const SubagentSchema = z
  .object({
    name: z.string().min(1).max(80).openapi({ example: 'reviewer' }),
    description: z.string().openapi({ example: 'Reviews proposed changes for correctness and risk.' }),
    systemPrompt: z.string().openapi({ example: 'Review the proposed changes and report risks.' }),
    model: z.string().nullable().openapi({ example: '@cf/moonshotai/kimi-k2.6' }),
    allowedTools: z.array(z.string()).openapi({ example: ['read', 'grep'] }),
    skills: z.array(z.string()).openapi({ example: ['ama@code-review'] }),
    mcpConnectors: z.array(z.string()).openapi({ example: ['github'] }),
  })
  .strict()
  .openapi('AgentSubagent')

const SubagentInputSchema = z
  .object({
    name: z.string().min(1).max(80).openapi({ example: 'reviewer' }),
    description: z.string().trim().min(1).max(1000).openapi({
      example: 'Reviews proposed changes for correctness and risk.',
    }),
    systemPrompt: z.string().trim().min(1).max(8000).openapi({
      example: 'Review the proposed changes and report risks.',
    }),
    model: z.string().min(1).nullable().optional().openapi({ example: '@cf/moonshotai/kimi-k2.6' }),
    allowedTools: z
      .array(z.string().min(1).max(120))
      .max(100)
      .optional()
      .openapi({ example: ['read', 'grep'] }),
    skills: z
      .array(z.string().min(1).max(256))
      .max(100)
      .optional()
      .openapi({ example: ['ama@code-review'] }),
    mcpConnectors: z
      .array(z.string().min(1).max(120))
      .max(50)
      .optional()
      .openapi({ example: ['github'] }),
  })
  .strict()
  .openapi('AgentSubagentInput')

const AllowedToolsSchema = z.array(z.string().min(1).max(120)).openapi({
  example: ['read', 'bash', 'edit'],
})

const RealmrootAgentIdSchema = z.string().min(1).max(160).regex(/^\S+$/)

const IdentityDescriptorSchema = z
  .object({
    identityId: z.string().openapi({ example: '0195f5d6-7c20-7000-8000-000000000004' }),
    agentId: RealmrootAgentIdSchema.openapi({
      description:
        'Realmroot internal Identity resource id. It is not the stable OIDC subject and must not be used for Inbox addressing.',
      example: '019ff41a-7da6-708f-8b05-44d4d0373685',
    }),
    issuer: z.string().url().openapi({ example: 'https://id.realmroot.dev/api/auth' }),
    subject: z.string().openapi({
      description:
        'Stable OIDC subject used for Inbox addressing. New Realmroot subjects are bare UUIDv7 values; legacy opaque snapshot values remain readable.',
      example: '019ff41a-7da6-708f-8b05-44d4d0373685',
    }),
    username: z.string().openapi({ example: 'researcher' }),
    runtime: z.enum(['ama', 'codex', 'claude-code', 'copilot']),
  })
  .strict()
  .openapi('IdentityDescriptor')

const AgentSpecSchema = z
  .object({
    systemPrompt: z.string().openapi({ example: 'Answer with citations.' }),
    provider: z.string().nullable().openapi({ example: 'workers-ai' }),
    model: z.string().nullable().openapi({ example: '@cf/moonshotai/kimi-k2.6' }),
    skills: z.array(z.string()).openapi({ example: ['ama@code-review'] }),
    subagents: z.array(SubagentSchema).openapi({
      example: [
        {
          name: 'reviewer',
          description: 'Reviews proposed changes for correctness and risk.',
          systemPrompt: 'Review the proposed changes and report risks.',
          model: null,
          allowedTools: ['read', 'grep'],
          skills: ['ama@code-review'],
          mcpConnectors: ['github'],
        },
      ],
    }),
    allowedTools: AllowedToolsSchema,
    mcpConnectors: z.array(z.string()).openapi({ example: ['github'] }),
    identity: IdentityDescriptorSchema.nullable(),
  })
  .openapi('AgentSpec')

const AgentStatusSchema = z
  .object({
    phase: ResourcePhaseSchema,
    currentVersionId: z.string().nullable().openapi({ example: '0195f5d6-7c20-7000-8000-000000000003' }),
    version: z.number().int().openapi({ example: 1 }),
  })
  .openapi('AgentStatus')

const AgentSchema = z
  .object({
    metadata: ResourceMetadataSchema,
    spec: AgentSpecSchema,
    status: AgentStatusSchema,
  })
  .openapi('Agent')

const AgentVersionSchema = z
  .object({
    metadata: ResourceMetadataSchema,
    spec: AgentSpecSchema,
    status: z
      .object({
        agentId: z.string().openapi({ example: '0195f5d6-7c20-7000-8000-000000000002' }),
        version: z.number().int().openapi({ example: 1 }),
      })
      .openapi('AgentVersionStatus'),
  })
  .openapi('AgentVersion')

const AgentPayloadSchema = z
  .object({
    metadata: ResourceCreateMetadataSchema.openapi({ example: { name: 'Research assistant' } }),
    spec: z
      .object({
        systemPrompt: z.string().trim().min(1).max(8000).openapi({ example: 'Answer with citations.' }),
        provider: z.string().min(1).nullable().optional().openapi({ example: 'workers-ai' }),
        model: z.string().min(1).nullable().optional().openapi({ example: '@cf/moonshotai/kimi-k2.6' }),
        skills: z
          .array(z.string().min(1).max(256))
          .max(100)
          .optional()
          .openapi({ example: ['ama@code-review'] }),
        subagents: z
          .array(SubagentInputSchema)
          .max(50)
          .optional()
          .openapi({
            example: [
              {
                name: 'reviewer',
                description: 'Reviews proposed changes for correctness and risk.',
                systemPrompt: 'Review the proposed changes and report risks.',
                allowedTools: ['read', 'grep'],
              },
            ],
          }),
        allowedTools: AllowedToolsSchema.max(100).optional(),
        mcpConnectors: z
          .array(z.string().min(1).max(120))
          .max(50)
          .optional()
          .openapi({ example: ['github'] }),
        identityRef: z
          .string()
          .min(1)
          .nullable()
          .optional()
          .openapi({ example: '0195f5d6-7c20-7000-8000-000000000004' }),
      })
      .strict(),
  })
  .strict()

const CreateAgentSchema = AgentPayloadSchema.openapi('CreateAgentRequest')
const UpdateAgentSchema = z
  .object({
    metadata: ResourceUpdateMetadataSchema.optional(),
    spec: AgentPayloadSchema.shape.spec.partial().optional(),
    archived: z.boolean().optional().openapi({
      description: 'Lifecycle transition: true archives the agent, false unarchives it.',
      example: false,
    }),
  })
  .strict()
  .refine((body) => body.metadata !== undefined || body.spec !== undefined || body.archived !== undefined, {
    message: 'Provide metadata, spec, or archived.',
  })
  .openapi('UpdateAgentRequest')

const AgentParamsSchema = z.object({
  agentId: z.string().openapi({
    param: { name: 'agentId', in: 'path' },
    example: '0195f5d6-7c20-7000-8000-000000000002',
  }),
})

const AgentVersionParamsSchema = AgentParamsSchema.extend({
  version: z.coerce
    .number()
    .int()
    .min(1)
    .openapi({
      param: { name: 'version', in: 'path' },
      example: 1,
    }),
})

const ListQuerySchema = listQuerySchema().extend({
  identityAgentId: RealmrootAgentIdSchema.optional().openapi({
    param: { name: 'identityAgentId', in: 'query' },
    description: 'Exact Realmroot Agent actor id bound through the Agent Identity.',
    example: '019ff41a-7da6-708f-8b05-44d4d0373685',
  }),
})
const AgentListResponseSchema = listResponseSchema('AgentListResponse', AgentSchema)
const AgentVersionListResponseSchema = listResponseSchema('AgentVersionListResponse', AgentVersionSchema)

function domainValidation(message: string, fields: Record<string, string>) {
  return { error: { type: 'validation_error', message, details: { fields } } } as const
}

const listAgentsRoute = createRoute({
  method: 'get',
  path: '/',
  operationId: 'listAgents',
  tags: ['Agents'],
  summary: 'List agents',
  ...AuthenticatedOperation,
  request: { query: ListQuerySchema },
  responses: {
    200: { description: 'Agent list', content: { 'application/json': { schema: AgentListResponseSchema } } },
    400: { description: 'Validation error', content: { 'application/json': { schema: ErrorResponseSchema } } },
    401: { description: 'Authentication required', content: { 'application/json': { schema: ErrorResponseSchema } } },
  },
})

const createAgentRoute = createRoute({
  method: 'post',
  path: '/',
  operationId: 'createAgent',
  tags: ['Agents'],
  summary: 'Create an agent',
  ...AuthenticatedOperation,
  request: { body: { required: true, content: { 'application/json': { schema: CreateAgentSchema } } } },
  responses: {
    201: { description: 'Created agent', content: { 'application/json': { schema: AgentSchema } } },
    400: { description: 'Validation error', content: { 'application/json': { schema: ErrorResponseSchema } } },
    401: { description: 'Authentication required', content: { 'application/json': { schema: ErrorResponseSchema } } },
    409: { description: 'Identity already bound', content: { 'application/json': { schema: ErrorResponseSchema } } },
  },
})

const readAgentRoute = createRoute({
  method: 'get',
  path: '/{agentId}',
  operationId: 'readAgent',
  tags: ['Agents'],
  summary: 'Read an agent',
  ...AuthenticatedOperation,
  request: { params: AgentParamsSchema },
  responses: {
    200: { description: 'Agent', content: { 'application/json': { schema: AgentSchema } } },
    401: { description: 'Authentication required', content: { 'application/json': { schema: ErrorResponseSchema } } },
    404: { description: 'Agent not found', content: { 'application/json': { schema: ErrorResponseSchema } } },
  },
})

const updateAgentRoute = createRoute({
  method: 'patch',
  path: '/{agentId}',
  operationId: 'updateAgent',
  tags: ['Agents'],
  summary: 'Update an agent',
  description:
    'Partial update. Lifecycle transitions use the archived flag: {archived: true} archives, {archived: false} unarchives. Field updates on an archived agent are rejected with 409.',
  ...AuthenticatedOperation,
  request: {
    params: AgentParamsSchema,
    body: { required: true, content: { 'application/json': { schema: UpdateAgentSchema } } },
  },
  responses: {
    200: { description: 'Updated agent', content: { 'application/json': { schema: AgentSchema } } },
    400: { description: 'Validation error', content: { 'application/json': { schema: ErrorResponseSchema } } },
    401: { description: 'Authentication required', content: { 'application/json': { schema: ErrorResponseSchema } } },
    404: { description: 'Agent not found', content: { 'application/json': { schema: ErrorResponseSchema } } },
    409: { description: 'Archived agent', content: { 'application/json': { schema: ErrorResponseSchema } } },
  },
})

const listAgentVersionsRoute = createRoute({
  method: 'get',
  path: '/{agentId}/versions',
  operationId: 'listAgentVersions',
  tags: ['Agents'],
  summary: 'List agent versions',
  ...AuthenticatedOperation,
  request: { params: AgentParamsSchema },
  responses: {
    200: { description: 'Agent versions', content: { 'application/json': { schema: AgentVersionListResponseSchema } } },
    401: { description: 'Authentication required', content: { 'application/json': { schema: ErrorResponseSchema } } },
    404: { description: 'Agent not found', content: { 'application/json': { schema: ErrorResponseSchema } } },
  },
})

const readAgentVersionRoute = createRoute({
  method: 'get',
  path: '/{agentId}/versions/{version}',
  operationId: 'readAgentVersion',
  tags: ['Agents'],
  summary: 'Read an agent version',
  ...AuthenticatedOperation,
  request: { params: AgentVersionParamsSchema },
  responses: {
    200: { description: 'Agent version', content: { 'application/json': { schema: AgentVersionSchema } } },
    400: { description: 'Validation error', content: { 'application/json': { schema: ErrorResponseSchema } } },
    401: { description: 'Authentication required', content: { 'application/json': { schema: ErrorResponseSchema } } },
    404: {
      description: 'Agent or version not found',
      content: { 'application/json': { schema: ErrorResponseSchema } },
    },
  },
})

// Registration order is load-bearing: requireAuth is the per-route auth wall and
// static segments register before parameter segments. The assembler in app.ts
// calls this at the agents resource's original mount position.
export function registerAgentRoutes(routes: AgentRoutes) {
  // Returns the chained router so the accumulated OpenAPI route types flow into
  // AppType (the frontend's hc<AppType> client depends on them).
  return routes
    .openapi(listAgentsRoute, async (c) => {
      const deps = c.get('deps')
      const auth = await requireAuth(c)
      if (auth instanceof Response) {
        return auth
      }
      const { archived, search, createdFrom, createdTo, identityAgentId, limit = 50, cursor } = c.req.valid('query')
      let parsedCursor: { createdAt: string; id: string } | null = null
      try {
        parsedCursor = cursor ? parseListCursor(cursor) : null
      } catch {
        return c.json(domainValidation('Invalid list cursor', { cursor: 'Cursor is invalid.' }), 400)
      }
      const page = await deps.agents.list({
        projectId: auth.project.id,
        archived: archived === 'true',
        ...(identityAgentId ? { identityAgentId } : {}),
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
          data: page.rows.map(serializeAgent),
          pagination: { limit, nextCursor, hasMore: page.hasMore },
        },
        200,
      )
    })
    .openapi(createAgentRoute, async (c) => {
      const body = c.req.valid('json')
      const deps = c.get('deps')
      const auth = await requireAuth(c)
      if (auth instanceof Response) {
        return auth
      }
      try {
        const agent = await createAgent(deps, auth, {
          name: body.metadata.name,
          description: body.metadata.description ?? null,
          spec: specFromPayload(body),
          identityRef: body.spec.identityRef ?? null,
        })
        return c.json(serializeAgent(agent), 201)
      } catch (error) {
        return validationOr(c, error)
      }
    })
    .openapi(readAgentRoute, async (c) => {
      const { agentId } = c.req.valid('param')
      const deps = c.get('deps')
      const auth = await requireAuth(c)
      if (auth instanceof Response) {
        return auth
      }
      const agent = await deps.agents.find(auth.project.id, agentId)
      if (!agent) {
        return notFound(c)
      }
      return c.json(serializeAgent(agent), 200)
    })
    .openapi(updateAgentRoute, async (c) => {
      const { agentId } = c.req.valid('param')
      const body = c.req.valid('json')
      const deps = c.get('deps')
      const auth = await requireAuth(c)
      if (auth instanceof Response) {
        return auth
      }
      const agent = await deps.agents.find(auth.project.id, agentId)
      if (!agent) {
        return notFound(c)
      }
      const scope = auth
      const before = agent
      try {
        const result = await updateAgent(deps, scope, agent, patchFromBody(body))
        if (result.archived) {
          await deps.audit.record(scope, {
            action: 'agent.archive',
            resourceType: 'agent',
            resourceId: agentId,
            outcome: 'success',
            requestId: requestId(c),
            before,
            after: { archivedAt: result.agent.metadata.archivedAt },
          })
        } else if (before.metadata.archivedAt && result.agent.metadata.archivedAt === null) {
          await deps.audit.record(scope, {
            action: 'agent.unarchive',
            resourceType: 'agent',
            resourceId: agentId,
            outcome: 'success',
            requestId: requestId(c),
            before: { archivedAt: before.metadata.archivedAt },
            after: { archivedAt: null },
          })
        }
        return c.json(serializeAgent(result.agent), 200)
      } catch (error) {
        if (error instanceof AgentArchivedError) {
          return c.json({ error: { type: 'conflict', message: error.message } }, 409)
        }
        return validationOr(c, error)
      }
    })
    .openapi(listAgentVersionsRoute, async (c) => {
      const { agentId } = c.req.valid('param')
      const deps = c.get('deps')
      const auth = await requireAuth(c)
      if (auth instanceof Response) {
        return auth
      }
      const agent = await deps.agents.find(auth.project.id, agentId)
      if (!agent) {
        return notFound(c)
      }
      const versions = await deps.agents.listVersions(auth.project.id, agentId)
      return c.json(
        {
          data: versions.map(serializeAgentVersion),
          pagination: { limit: versions.length, nextCursor: null, hasMore: false },
        },
        200,
      )
    })
    .openapi(readAgentVersionRoute, async (c) => {
      const { agentId, version } = c.req.valid('param')
      const deps = c.get('deps')
      const auth = await requireAuth(c)
      if (auth instanceof Response) {
        return auth
      }
      const agent = await deps.agents.find(auth.project.id, agentId)
      if (!agent) {
        return notFound(c)
      }
      const row = await deps.agents.findVersion(auth.project.id, agentId, version)
      if (!row) {
        return c.json({ error: { type: 'not_found', message: 'Agent version not found' } }, 404)
      }
      return c.json(serializeAgentVersion(row), 200)
    })
}

// --- helpers ---

// Builds the usecase patch from the validated PATCH body: only present fields
// are forwarded, so an absent field is distinct from an explicit null.
function patchFromBody(body: z.infer<typeof UpdateAgentSchema>): UpdateAgentPatch {
  const spec = body.spec
  return {
    ...(body.metadata?.name !== undefined ? { name: body.metadata.name } : {}),
    ...(body.metadata?.description !== undefined ? { description: body.metadata.description } : {}),
    ...(spec?.systemPrompt !== undefined ? { systemPrompt: spec.systemPrompt } : {}),
    ...(spec?.provider !== undefined ? { provider: spec.provider } : {}),
    ...(spec?.model !== undefined ? { model: spec.model } : {}),
    ...(spec?.skills !== undefined ? { skills: spec.skills } : {}),
    ...(spec?.subagents !== undefined ? { subagents: normalizeSubagents(spec.subagents) } : {}),
    ...(spec?.allowedTools !== undefined ? { allowedTools: spec.allowedTools } : {}),
    ...(spec?.mcpConnectors !== undefined ? { mcpConnectors: spec.mcpConnectors } : {}),
    ...(spec?.identityRef !== undefined ? { identityRef: spec.identityRef } : {}),
    ...(body.archived !== undefined ? { archived: body.archived } : {}),
  }
}

function specFromPayload(body: z.infer<typeof AgentPayloadSchema>): Omit<AgentSpec, 'identity'> {
  const spec = body.spec
  return {
    systemPrompt: spec.systemPrompt,
    provider: spec.provider ?? null,
    model: spec.model ?? null,
    skills: spec.skills ?? [],
    subagents: normalizeSubagents(spec.subagents ?? []),
    allowedTools: spec.allowedTools ?? defaultAllowedTools(),
    mcpConnectors: spec.mcpConnectors ?? [],
  }
}

function normalizeSubagents(subagents: z.infer<typeof SubagentInputSchema>[]): AgentSpec['subagents'] {
  return subagents.map((subagent) => ({
    name: subagent.name,
    description: subagent.description,
    systemPrompt: subagent.systemPrompt,
    model: subagent.model ?? null,
    allowedTools: subagent.allowedTools ?? defaultAllowedTools(),
    skills: subagent.skills ?? [],
    mcpConnectors: subagent.mcpConnectors ?? [],
  }))
}

function serializeAgent(agent: Agent) {
  const resource = serializeResource(agent)
  return { ...resource, spec: { ...resource.spec, identity: publicIdentity(resource.spec.identity) } }
}

function serializeAgentVersion(version: AgentVersion) {
  const resource = serializeResource(version)
  return { ...resource, spec: { ...resource.spec, identity: publicIdentity(resource.spec.identity) } }
}

function publicIdentity(identity: Agent['spec']['identity']) {
  if (!identity) return null
  const { credentialRef: _credentialRef, ...safe } = identity
  return safe
}

function notFound(c: Parameters<Parameters<AgentRoutes['openapi']>[1]>[0]) {
  return c.json({ error: { type: 'not_found', message: 'Agent not found' } }, 404)
}

function validationOr(c: Parameters<Parameters<AgentRoutes['openapi']>[1]>[0], error: unknown) {
  if (error instanceof AgentValidationError) {
    return c.json(domainValidation(error.message, error.fields), 400)
  }
  if (error instanceof IdentityAlreadyBoundError) {
    return c.json({ error: { type: error.code, message: error.message } }, 409)
  }
  throw error
}
