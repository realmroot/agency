import { createRoute, type OpenAPIHono, z } from '@hono/zod-openapi'
import { requireAuth } from '@server/auth/session'
import { webSessionAccessToken } from '@server/auth/web-session'
import {
  ResourceCreateMetadataSchema,
  ResourceMetadataSchema,
  ResourcePhaseSchema,
  serializeResource,
} from '@server/contracts/resource-contracts'
import type { Identity } from '@server/domain/identity'
import {
  archiveIdentity,
  createIdentity,
  IdentityConflictError,
  IdentityProvisioningError,
} from '@server/usecases/identities'
import {
  AuthenticatedOperation,
  type DepsEnv,
  ErrorResponseSchema,
  formatListCursor,
  listQuerySchema,
  listResponseSchema,
  parseListCursor,
} from '../openapi'
import { requestId } from './request-context'

type Routes = OpenAPIHono<DepsEnv>

const RuntimeSchema = z.enum(['ama', 'codex', 'claude-code', 'copilot'])
const DescriptorSchema = z
  .object({
    identityId: z.string(),
    agentId: z.string().openapi({
      description:
        'Realmroot internal Identity resource id. It is not the stable OIDC subject and must not be used for Inbox addressing.',
    }),
    issuer: z.string().url(),
    subject: z.string().openapi({
      description:
        'Stable OIDC subject used for Inbox addressing. New Realmroot subjects are bare UUIDv7 values; legacy opaque snapshot values remain readable.',
    }),
    username: z.string(),
    runtime: RuntimeSchema,
  })
  .openapi('IdentityDescriptor')
const IdentitySchema = z
  .object({
    metadata: ResourceMetadataSchema,
    spec: z.object({ username: z.string(), runtime: RuntimeSchema }),
    status: z.object({
      phase: ResourcePhaseSchema,
      state: z.enum(['provisioning', 'active', 'error']),
      failureCode: z.string().nullable(),
      boundAgentId: z.string().nullable(),
      descriptor: DescriptorSchema.nullable(),
    }),
  })
  .openapi('Identity')
const CreateSchema = z
  .object({
    metadata: ResourceCreateMetadataSchema,
    spec: z
      .object({
        username: z
          .string()
          .trim()
          .min(1)
          .max(80)
          .regex(/^[a-z0-9][a-z0-9-]*$/),
        runtime: RuntimeSchema,
      })
      .strict(),
  })
  .strict()
  .openapi('CreateIdentityRequest')
const UpdateSchema = z
  .object({ archived: z.literal(true) })
  .strict()
  .openapi('UpdateIdentityRequest')
const Params = z.object({ identityId: z.string().openapi({ param: { name: 'identityId', in: 'path' } }) })
const ListResponse = listResponseSchema('IdentityListResponse', IdentitySchema)

function serializeIdentity(identity: Identity) {
  const resource = serializeResource(identity)
  if (!resource.status.descriptor) return resource
  const { credentialRef: _credentialRef, ...descriptor } = resource.status.descriptor
  return { ...resource, status: { ...resource.status, descriptor } }
}

const listRoute = createRoute({
  method: 'get',
  path: '/',
  operationId: 'listIdentities',
  tags: ['Identities'],
  summary: 'List identities',
  ...AuthenticatedOperation,
  request: { query: listQuerySchema() },
  responses: {
    200: { description: 'Identity list', content: { 'application/json': { schema: ListResponse } } },
    400: { description: 'Invalid cursor', content: { 'application/json': { schema: ErrorResponseSchema } } },
    401: { description: 'Authentication required', content: { 'application/json': { schema: ErrorResponseSchema } } },
  },
})
const createRouteConfig = createRoute({
  method: 'post',
  path: '/',
  operationId: 'createIdentity',
  tags: ['Identities'],
  summary: 'Create an identity',
  ...AuthenticatedOperation,
  request: {
    headers: z.object({ 'idempotency-key': z.string().min(8).max(200) }),
    body: { required: true, content: { 'application/json': { schema: CreateSchema } } },
  },
  responses: {
    201: { description: 'Identity provisioned', content: { 'application/json': { schema: IdentitySchema } } },
    400: { description: 'Invalid request', content: { 'application/json': { schema: ErrorResponseSchema } } },
    401: { description: 'Authentication required', content: { 'application/json': { schema: ErrorResponseSchema } } },
    403: { description: 'User principal required', content: { 'application/json': { schema: ErrorResponseSchema } } },
    409: { description: 'Conflict', content: { 'application/json': { schema: ErrorResponseSchema } } },
    502: {
      description: 'Realmroot provisioning failed',
      content: { 'application/json': { schema: ErrorResponseSchema } },
    },
  },
})
const readRoute = createRoute({
  method: 'get',
  path: '/{identityId}',
  operationId: 'readIdentity',
  tags: ['Identities'],
  summary: 'Read an identity',
  ...AuthenticatedOperation,
  request: { params: Params },
  responses: {
    200: { description: 'Identity', content: { 'application/json': { schema: IdentitySchema } } },
    401: { description: 'Authentication required', content: { 'application/json': { schema: ErrorResponseSchema } } },
    404: { description: 'Not found', content: { 'application/json': { schema: ErrorResponseSchema } } },
  },
})
const updateRoute = createRoute({
  method: 'patch',
  path: '/{identityId}',
  operationId: 'updateIdentity',
  tags: ['Identities'],
  summary: 'Archive an identity',
  ...AuthenticatedOperation,
  request: {
    params: Params,
    body: {
      required: true,
      content: {
        'application/merge-patch+json': { schema: UpdateSchema },
        'application/json': { schema: UpdateSchema },
      },
    },
  },
  responses: {
    200: { description: 'Archived identity', content: { 'application/json': { schema: IdentitySchema } } },
    401: { description: 'Authentication required', content: { 'application/json': { schema: ErrorResponseSchema } } },
    404: { description: 'Not found', content: { 'application/json': { schema: ErrorResponseSchema } } },
    409: { description: 'Identity is in use', content: { 'application/json': { schema: ErrorResponseSchema } } },
  },
})

function subjectToken(request: Request, cookieToken: string | null) {
  const authorization = request.headers.get('authorization')
  const direct = authorization?.replace(/^(?:Bearer|DPoP)\s+/i, '')
  return direct || cookieToken
}

export function registerIdentityRoutes(routes: Routes) {
  return routes
    .openapi(listRoute, async (c) => {
      const auth = await requireAuth(c)
      if (auth instanceof Response) return auth
      const { archived, search, limit = 50, cursor } = c.req.valid('query')
      let parsed = null
      try {
        parsed = cursor ? parseListCursor(cursor) : null
      } catch {
        return c.json({ error: { type: 'validation_error', message: 'Invalid list cursor' } }, 400)
      }
      const page = await c.get('deps').identities!.list({
        projectId: auth.project.id,
        archived: archived === 'true',
        ...(search ? { search } : {}),
        limit,
        cursor: parsed,
      })
      const last = page.rows.at(-1)
      return c.json(
        {
          data: page.rows.map(serializeIdentity),
          pagination: {
            limit,
            nextCursor:
              page.hasMore && last
                ? formatListCursor({ createdAt: last.metadata.createdAt, id: last.metadata.uid })
                : null,
            hasMore: page.hasMore,
          },
        },
        200,
      )
    })
    .openapi(createRouteConfig, async (c) => {
      const auth = await requireAuth(c)
      if (auth instanceof Response) return auth
      const body = c.req.valid('json')
      const headers = c.req.valid('header')
      const directToken = subjectToken(c.req.raw, null)
      const token = directToken ?? (await webSessionAccessToken(c))
      if (!token)
        return c.json({ error: { type: 'forbidden', message: 'A current Realmroot User grant is required.' } }, 403)
      try {
        const identity = await createIdentity(c.get('deps'), auth, {
          name: body.metadata.name,
          description: body.metadata.description ?? null,
          username: body.spec.username,
          runtime: body.spec.runtime,
          idempotencyKey: headers['idempotency-key'],
          subjectToken: token,
        })
        await c.get('deps').audit.record(auth, {
          action: 'identity.create',
          resourceType: 'identity',
          resourceId: identity.metadata.uid,
          outcome: 'success',
          requestId: requestId(c),
          after: { runtime: identity.spec.runtime, state: identity.status.state },
        })
        return c.json(serializeIdentity(identity), 201)
      } catch (error) {
        if (error instanceof IdentityConflictError) {
          await c.get('deps').audit.record(auth, {
            action: 'identity.create',
            resourceType: 'identity',
            outcome: 'denied',
            requestId: requestId(c),
            after: { failureCode: error.code },
          })
          return c.json({ error: { type: error.code, message: error.message } }, 409)
        }
        if (error instanceof IdentityProvisioningError) {
          await c.get('deps').audit.record(auth, {
            action: 'identity.create',
            resourceType: 'identity',
            outcome: 'failure',
            requestId: requestId(c),
            after: { failureCode: error.code },
          })
          return c.json(
            { error: { type: error.code, message: error.message } },
            error.code === 'user_principal_required' ? 403 : 502,
          )
        }
        throw error
      }
    })
    .openapi(readRoute, async (c) => {
      const auth = await requireAuth(c)
      if (auth instanceof Response) return auth
      const identity = await c.get('deps').identities!.find(auth.project.id, c.req.valid('param').identityId)
      return identity
        ? c.json(serializeIdentity(identity), 200)
        : c.json({ error: { type: 'not_found', message: 'Identity not found' } }, 404)
    })
    .openapi(updateRoute, async (c) => {
      const auth = await requireAuth(c)
      if (auth instanceof Response) return auth
      const identity = await c.get('deps').identities!.find(auth.project.id, c.req.valid('param').identityId)
      if (!identity) return c.json({ error: { type: 'not_found', message: 'Identity not found' } }, 404)
      try {
        await archiveIdentity(c.get('deps'), auth, identity)
      } catch (error) {
        if (error instanceof IdentityConflictError)
          return c.json({ error: { type: error.code, message: error.message } }, 409)
        throw error
      }
      const archived = await c.get('deps').identities!.find(auth.project.id, identity.metadata.uid)
      await c.get('deps').audit.record(auth, {
        action: 'identity.archive',
        resourceType: 'identity',
        resourceId: identity.metadata.uid,
        outcome: 'success',
        requestId: requestId(c),
        before: { archivedAt: identity.metadata.archivedAt },
        after: { archivedAt: archived?.metadata.archivedAt ?? null },
      })
      return c.json(serializeIdentity(archived!), 200)
    })
}
