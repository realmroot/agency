import { createRoute, type OpenAPIHono, z } from '@hono/zod-openapi'
import {
  ResourceCreateMetadataSchema,
  ResourceMetadataSchema,
  ResourcePhaseSchema,
  ResourceUpdateMetadataSchema,
  serializeResource,
} from '@server/contracts/resource-contracts'
import {
  CREDENTIAL_STATES,
  CREDENTIAL_TYPES,
  type Credential,
  type CredentialVersion,
  credentialDataKeys,
  SECRET_PROVIDERS,
  stripStoredSecretMetadata,
  VAULT_SCOPES,
  type Vault,
  VERSION_STATES,
} from '@server/domain/vault'
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
import { VaultSecretError } from '../usecases/ports'
import { createCredential, rotateCredential } from '../usecases/vaults'
import { requestId } from './request-context'

type VaultRoutes = OpenAPIHono<DepsEnv>

const JsonObjectSchema = z.record(z.string(), z.unknown())
const VaultJsonObjectSchema = JsonObjectSchema.openapi('VaultJsonObject')
const SecretProviderSchema = z.enum(SECRET_PROVIDERS)
const CredentialTypeSchema = z.enum(CREDENTIAL_TYPES)

const VaultSchema = z
  .object({
    metadata: ResourceMetadataSchema,
    spec: z
      .object({
        organizationId: z.string().openapi({ example: 'org_abc123' }),
        scope: z.enum(VAULT_SCOPES).openapi({ example: 'project' }),
      })
      .openapi('VaultSpec'),
    status: z.object({ phase: ResourcePhaseSchema }).openapi('VaultStatus'),
  })
  .openapi('Vault')

const CredentialVersionSchema = z
  .object({
    metadata: ResourceMetadataSchema,
    spec: z
      .object({
        credentialId: z.string().openapi({ example: 'vaultcred_abc123' }),
        vaultId: z.string().openapi({ example: 'vault_abc123' }),
        organizationId: z.string().openapi({ example: 'org_abc123' }),
        version: z.number().int().openapi({ example: 2 }),
        provider: SecretProviderSchema.openapi({ example: 'ama' }),
        secretRef: z
          .string()
          .openapi({ example: 'ama://vaults/vault_abc123/credentials/vaultcred_abc123/versions/vaultver_abc123' }),
        referenceName: z.string().openapi({ example: 'AMA_PROJECT_ABC123_TOKEN_V2' }),
        hasSecret: z.boolean().openapi({ example: true }),
        dataKeys: z.array(z.string()).openapi({ example: ['token'] }),
        metadata: VaultJsonObjectSchema.openapi({ example: { rotatedBy: 'operator' } }),
      })
      .openapi('VaultCredentialVersionSpec'),
    status: z
      .object({
        phase: z.enum(VERSION_STATES).openapi({ example: 'active' }),
        supersededAt: z.string().datetime().nullable().openapi({ example: '2026-05-24T01:00:00.000Z' }),
        revokedAt: z.string().datetime().nullable().openapi({ example: null }),
      })
      .openapi('VaultCredentialVersionStatus'),
  })
  .openapi('VaultCredentialVersion')

const CredentialSchema = z
  .object({
    metadata: ResourceMetadataSchema,
    spec: z
      .object({
        vaultId: z.string().openapi({ example: 'vault_abc123' }),
        organizationId: z.string().openapi({ example: 'org_abc123' }),
        type: CredentialTypeSchema.openapi({ example: 'opaque' }),
        metadata: JsonObjectSchema.openapi({ example: { owner: 'platform' } }),
      })
      .openapi('VaultCredentialSpec'),
    status: z
      .object({
        phase: z.enum(CREDENTIAL_STATES).openapi({ example: 'active' }),
        activeVersionId: z.string().nullable().openapi({ example: 'vaultver_abc123' }),
        activeVersion: CredentialVersionSchema.nullable(),
        revokedAt: z.string().datetime().nullable().openapi({ example: null }),
        revokedByUserId: z.string().nullable().openapi({ example: null }),
        revokeReason: z.string().nullable().openapi({ example: null }),
      })
      .openapi('VaultCredentialStatus'),
  })
  .openapi('VaultCredential')

const CreateVaultSchema = z
  .object({
    metadata: ResourceCreateMetadataSchema.openapi({
      example: { name: 'Provider credentials', description: 'Credentials used by runtime sessions.' },
    }),
    spec: z
      .object({
        scope: z.enum(VAULT_SCOPES).optional().openapi({ example: 'project' }),
      })
      .strict(),
  })
  .strict()
  .openapi('CreateVaultRequest')

const UpdateVaultSchema = z
  .object({
    metadata: ResourceUpdateMetadataSchema.optional(),
    spec: z
      .object({
        scope: z.enum(VAULT_SCOPES).optional().openapi({ example: 'project' }),
      })
      .strict()
      .optional(),
    archived: z.boolean().optional().openapi({ example: true }),
  })
  .strict()
  .refine((body) => body.metadata !== undefined || body.spec !== undefined || body.archived !== undefined, {
    message: 'Provide metadata, spec, or archived.',
  })
  .openapi('UpdateVaultRequest')

const SecretMaterialSchema = z
  .object({
    stringData: z
      .record(z.string(), z.string().min(1).max(16000))
      .refine((value) => Object.keys(value).length > 0, 'At least one data key is required.')
      .openapi({ example: { token: 'redacted-input-only' } }),
    referenceName: z.string().min(1).max(160).optional().openapi({ example: 'AMA_PROJECT_TOKEN' }),
    metadata: JsonObjectSchema.optional().openapi({ example: { source: 'console' } }),
  })
  .strict()

const CreateCredentialSchema = z
  .object({
    name: z.string().min(1).max(120).openapi({ example: 'Workers AI token' }),
    type: CredentialTypeSchema.openapi({ example: 'opaque' }),
    metadata: JsonObjectSchema.optional().openapi({ example: { owner: 'platform' } }),
    secret: SecretMaterialSchema.openapi({ example: { stringData: { token: 'input-only' } } }),
  })
  .openapi('CreateVaultCredentialRequest')

const UpdateCredentialSecretSchema = SecretMaterialSchema.openapi('UpdateVaultCredentialSecretRequest')

const UpdateCredentialSchema = z
  .object({
    state: z.enum(['revoked']).optional().openapi({ example: 'revoked' }),
    revokeReason: z.string().max(500).optional().openapi({ example: 'Replaced by scoped credential.' }),
    metadata: JsonObjectSchema.optional().openapi({ example: { owner: 'platform' } }),
  })
  .strict()
  .openapi('UpdateVaultCredentialRequest')

const VaultParamsSchema = z.object({
  vaultId: z.string().openapi({ param: { name: 'vaultId', in: 'path' }, example: 'vault_abc123' }),
})

const CredentialParamsSchema = VaultParamsSchema.extend({
  credentialId: z.string().openapi({ param: { name: 'credentialId', in: 'path' }, example: 'vaultcred_abc123' }),
})

const VersionParamsSchema = CredentialParamsSchema.extend({
  versionId: z.string().openapi({ param: { name: 'versionId', in: 'path' }, example: 'vaultver_abc123' }),
})

const credentialStateQuery = z
  .enum(CREDENTIAL_STATES)
  .optional()
  .openapi({ param: { name: 'state', in: 'query' }, example: 'active' })

const versionStateQuery = z
  .enum(VERSION_STATES)
  .optional()
  .openapi({ param: { name: 'state', in: 'query' }, example: 'active' })

const VaultListQuerySchema = listQuerySchema()
const CredentialListQuerySchema = listQuerySchema().omit({ archived: true }).extend({ state: credentialStateQuery })
const CredentialVersionListQuerySchema = listQuerySchema()
  .omit({ archived: true, search: true })
  .extend({ state: versionStateQuery })
const VaultListResponseSchema = listResponseSchema('VaultListResponse', VaultSchema)
const CredentialListResponseSchema = listResponseSchema('VaultCredentialListResponse', CredentialSchema)
const CredentialVersionListResponseSchema = listResponseSchema(
  'VaultCredentialVersionListResponse',
  CredentialVersionSchema,
)

function domainValidation(message: string, fields: Record<string, string>) {
  return { error: { type: 'validation_error', message, details: { fields } } } as const
}

// Stored secret material (ciphertext, legacy local values) lives only in the
// version record metadata. It must never leave through API responses or audit
// snapshots.
function serializeVersion(record: CredentialVersion) {
  const resource = serializeResource(record)
  return {
    ...resource,
    spec: {
      ...record.spec,
      dataKeys: credentialDataKeys(record.spec.metadata),
      metadata: stripStoredSecretMetadata(record.spec.metadata),
    },
  }
}

function serializeCredential(record: Credential, activeVersion: CredentialVersion | null) {
  const resource = serializeResource(record)
  return {
    ...resource,
    status: { ...record.status, activeVersion: activeVersion ? serializeVersion(activeVersion) : null },
  }
}

const listRoute = createRoute({
  method: 'get',
  path: '/',
  operationId: 'listVaults',
  tags: ['Vaults'],
  summary: 'List vaults',
  ...AuthenticatedOperation,
  request: { query: VaultListQuerySchema },
  responses: {
    200: { description: 'Vault list', content: { 'application/json': { schema: VaultListResponseSchema } } },
    400: { description: 'Validation error', content: { 'application/json': { schema: ErrorResponseSchema } } },
    401: { description: 'Authentication required', content: { 'application/json': { schema: ErrorResponseSchema } } },
  },
})

const createVaultRoute = createRoute({
  method: 'post',
  path: '/',
  operationId: 'createVault',
  tags: ['Vaults'],
  summary: 'Create a vault',
  ...AuthenticatedOperation,
  request: { body: { required: true, content: { 'application/json': { schema: CreateVaultSchema } } } },
  responses: {
    201: { description: 'Created vault', content: { 'application/json': { schema: VaultSchema } } },
    400: { description: 'Validation error', content: { 'application/json': { schema: ErrorResponseSchema } } },
    401: { description: 'Authentication required', content: { 'application/json': { schema: ErrorResponseSchema } } },
  },
})

const readVaultRoute = createRoute({
  method: 'get',
  path: '/{vaultId}',
  operationId: 'readVault',
  tags: ['Vaults'],
  summary: 'Read a vault',
  ...AuthenticatedOperation,
  request: { params: VaultParamsSchema },
  responses: {
    200: { description: 'Vault', content: { 'application/json': { schema: VaultSchema } } },
    401: { description: 'Authentication required', content: { 'application/json': { schema: ErrorResponseSchema } } },
    404: { description: 'Vault not found', content: { 'application/json': { schema: ErrorResponseSchema } } },
  },
})

const updateVaultRoute = createRoute({
  method: 'patch',
  path: '/{vaultId}',
  operationId: 'updateVault',
  tags: ['Vaults'],
  summary: 'Update or archive a vault',
  description: 'Partial update. Archive with `archived: true`; restore with `archived: false`.',
  ...AuthenticatedOperation,
  request: {
    params: VaultParamsSchema,
    body: { required: true, content: { 'application/json': { schema: UpdateVaultSchema } } },
  },
  responses: {
    200: { description: 'Updated vault', content: { 'application/json': { schema: VaultSchema } } },
    400: { description: 'Validation error', content: { 'application/json': { schema: ErrorResponseSchema } } },
    401: { description: 'Authentication required', content: { 'application/json': { schema: ErrorResponseSchema } } },
    404: { description: 'Vault not found', content: { 'application/json': { schema: ErrorResponseSchema } } },
    409: { description: 'Vault scope conflict', content: { 'application/json': { schema: ErrorResponseSchema } } },
  },
})

const listCredentialsRoute = createRoute({
  method: 'get',
  path: '/{vaultId}/credentials',
  operationId: 'listVaultCredentials',
  tags: ['Vaults'],
  summary: 'List vault credential metadata',
  ...AuthenticatedOperation,
  request: { params: VaultParamsSchema, query: CredentialListQuerySchema },
  responses: {
    200: { description: 'Credential list', content: { 'application/json': { schema: CredentialListResponseSchema } } },
    400: { description: 'Validation error', content: { 'application/json': { schema: ErrorResponseSchema } } },
    401: { description: 'Authentication required', content: { 'application/json': { schema: ErrorResponseSchema } } },
    404: { description: 'Vault not found', content: { 'application/json': { schema: ErrorResponseSchema } } },
  },
})

const createCredentialRoute = createRoute({
  method: 'post',
  path: '/{vaultId}/credentials',
  operationId: 'createVaultCredential',
  tags: ['Vaults'],
  summary: 'Create vault credential metadata',
  ...AuthenticatedOperation,
  request: {
    params: VaultParamsSchema,
    body: { required: true, content: { 'application/json': { schema: CreateCredentialSchema } } },
  },
  responses: {
    201: { description: 'Created credential', content: { 'application/json': { schema: CredentialSchema } } },
    400: { description: 'Validation error', content: { 'application/json': { schema: ErrorResponseSchema } } },
    401: { description: 'Authentication required', content: { 'application/json': { schema: ErrorResponseSchema } } },
    404: { description: 'Vault not found', content: { 'application/json': { schema: ErrorResponseSchema } } },
    409: { description: 'Vault archived', content: { 'application/json': { schema: ErrorResponseSchema } } },
  },
})

const readCredentialRoute = createRoute({
  method: 'get',
  path: '/{vaultId}/credentials/{credentialId}',
  operationId: 'readVaultCredential',
  tags: ['Vaults'],
  summary: 'Read vault credential metadata',
  ...AuthenticatedOperation,
  request: { params: CredentialParamsSchema },
  responses: {
    200: { description: 'Credential', content: { 'application/json': { schema: CredentialSchema } } },
    401: { description: 'Authentication required', content: { 'application/json': { schema: ErrorResponseSchema } } },
    404: { description: 'Credential not found', content: { 'application/json': { schema: ErrorResponseSchema } } },
  },
})

const updateCredentialRoute = createRoute({
  method: 'patch',
  path: '/{vaultId}/credentials/{credentialId}',
  operationId: 'updateVaultCredential',
  tags: ['Vaults'],
  summary: 'Update or revoke vault credential metadata',
  description: "Revoke with `state: 'revoked'` and an optional `revokeReason`.",
  ...AuthenticatedOperation,
  request: {
    params: CredentialParamsSchema,
    body: { required: true, content: { 'application/json': { schema: UpdateCredentialSchema } } },
  },
  responses: {
    200: { description: 'Updated credential', content: { 'application/json': { schema: CredentialSchema } } },
    400: { description: 'Validation error', content: { 'application/json': { schema: ErrorResponseSchema } } },
    401: { description: 'Authentication required', content: { 'application/json': { schema: ErrorResponseSchema } } },
    404: { description: 'Credential not found', content: { 'application/json': { schema: ErrorResponseSchema } } },
  },
})

const updateCredentialSecretRoute = createRoute({
  method: 'put',
  path: '/{vaultId}/credentials/{credentialId}',
  operationId: 'updateVaultCredentialSecret',
  tags: ['Vaults'],
  summary: 'Update a vault credential secret',
  description: 'Updates credential secret material. AMA records version snapshots internally for auditability.',
  ...AuthenticatedOperation,
  request: {
    params: CredentialParamsSchema,
    body: { required: true, content: { 'application/json': { schema: UpdateCredentialSecretSchema } } },
  },
  responses: {
    200: { description: 'Updated credential', content: { 'application/json': { schema: CredentialSchema } } },
    400: { description: 'Validation error', content: { 'application/json': { schema: ErrorResponseSchema } } },
    401: { description: 'Authentication required', content: { 'application/json': { schema: ErrorResponseSchema } } },
    404: { description: 'Credential not found', content: { 'application/json': { schema: ErrorResponseSchema } } },
    409: { description: 'Credential unavailable', content: { 'application/json': { schema: ErrorResponseSchema } } },
  },
})

const listVersionsRoute = createRoute({
  method: 'get',
  path: '/{vaultId}/credentials/{credentialId}/versions',
  operationId: 'listVaultCredentialVersions',
  tags: ['Vaults'],
  summary: 'List vault credential versions',
  ...AuthenticatedOperation,
  request: { params: CredentialParamsSchema, query: CredentialVersionListQuerySchema },
  responses: {
    200: {
      description: 'Credential versions',
      content: { 'application/json': { schema: CredentialVersionListResponseSchema } },
    },
    400: { description: 'Validation error', content: { 'application/json': { schema: ErrorResponseSchema } } },
    401: { description: 'Authentication required', content: { 'application/json': { schema: ErrorResponseSchema } } },
    404: { description: 'Credential not found', content: { 'application/json': { schema: ErrorResponseSchema } } },
  },
})

const readVersionRoute = createRoute({
  method: 'get',
  path: '/{vaultId}/credentials/{credentialId}/versions/{versionId}',
  operationId: 'readVaultCredentialVersion',
  tags: ['Vaults'],
  summary: 'Read a vault credential version',
  ...AuthenticatedOperation,
  request: { params: VersionParamsSchema },
  responses: {
    200: { description: 'Credential version', content: { 'application/json': { schema: CredentialVersionSchema } } },
    401: { description: 'Authentication required', content: { 'application/json': { schema: ErrorResponseSchema } } },
    404: {
      description: 'Credential version not found',
      content: { 'application/json': { schema: ErrorResponseSchema } },
    },
  },
})

// Registration order is load-bearing: requireAuth is the per-route auth wall and
// static segments register before parameter segments. The assembler in app.ts
// calls this at the vaults resource's original mount position.
export function registerVaultRoutes(routes: VaultRoutes) {
  return routes
    .openapi(listRoute, async (c) => {
      const deps = c.get('deps')
      const auth = await requireAuth(c)
      if (auth instanceof Response) {
        return auth
      }
      const { archived, search, createdFrom, createdTo, limit = 50, cursor } = c.req.valid('query')
      let parsedCursor: { createdAt: string; id: string } | null = null
      try {
        parsedCursor = cursor ? parseListCursor(cursor) : null
      } catch {
        return c.json(domainValidation('Invalid list cursor', { cursor: 'Cursor is invalid.' }), 400)
      }
      const page = await deps.vaults.list({
        organizationId: auth.organization.id,
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
    .openapi(createVaultRoute, async (c) => {
      const body = c.req.valid('json')
      const deps = c.get('deps')
      const auth = await requireAuth(c)
      if (auth instanceof Response) {
        return auth
      }
      const scope = body.spec.scope ?? 'project'
      const vault = await deps.vaults.insert(
        {
          organizationId: auth.organization.id,
          projectId: scope === 'project' ? auth.project.id : null,
          name: body.metadata.name,
          description: body.metadata.description ?? null,
          scope,
        },
        new Date().toISOString(),
      )
      await deps.audit.record(auth, {
        action: 'vault.create',
        resourceType: 'vault',
        resourceId: vault.metadata.uid,
        outcome: 'success',
        requestId: requestId(c),
        after: vault,
      })
      return c.json(serializeResource(vault), 201)
    })
    .openapi(readVaultRoute, async (c) => {
      const { vaultId } = c.req.valid('param')
      const deps = c.get('deps')
      const auth = await requireAuth(c)
      if (auth instanceof Response) {
        return auth
      }
      const vault = await deps.vaults.find(vaultId, visibility(auth))
      if (!vault) {
        return vaultNotFound(c)
      }
      return c.json(serializeResource(vault), 200)
    })
    .openapi(updateVaultRoute, async (c) => {
      const { vaultId } = c.req.valid('param')
      const body = c.req.valid('json')
      const deps = c.get('deps')
      const auth = await requireAuth(c)
      if (auth instanceof Response) {
        return auth
      }
      const vault = await deps.vaults.find(vaultId, visibility(auth))
      if (!vault) {
        return vaultNotFound(c)
      }
      const scope = body.spec?.scope ?? vault.spec.scope
      if (scope !== vault.spec.scope && (await deps.vaults.hasCredentials(vault.metadata.uid))) {
        return c.json(
          { error: { type: 'conflict', message: 'Vault scope cannot change after credentials exist' } },
          409,
        )
      }
      const timestamp = new Date().toISOString()
      const archivedAt =
        body.archived === true
          ? (vault.metadata.archivedAt ?? timestamp)
          : body.archived === false
            ? null
            : vault.metadata.archivedAt
      const fields = {
        name: body.metadata?.name ?? vault.metadata.name,
        description: body.metadata?.description !== undefined ? body.metadata.description : vault.metadata.description,
        scope,
        projectId: scope === 'project' ? auth.project.id : null,
        archivedAt,
      }
      await deps.vaults.update(vault.metadata.uid, fields, timestamp)
      const updated: Vault = {
        ...vault,
        metadata: {
          ...vault.metadata,
          pid: fields.projectId,
          name: fields.name,
          description: fields.description,
          archivedAt: fields.archivedAt,
          updatedAt: timestamp,
        },
        spec: { ...vault.spec, scope: fields.scope },
        status: { phase: fields.archivedAt ? 'archived' : 'active' },
      }
      await deps.audit.record(auth, {
        action: body.archived === true && vault.metadata.archivedAt === null ? 'vault.archive' : 'vault.update',
        resourceType: 'vault',
        resourceId: vault.metadata.uid,
        outcome: 'success',
        requestId: requestId(c),
        before: vault,
        after: updated,
      })
      return c.json(serializeResource(updated), 200)
    })
    .openapi(listCredentialsRoute, async (c) => {
      const { vaultId } = c.req.valid('param')
      const deps = c.get('deps')
      const auth = await requireAuth(c)
      if (auth instanceof Response) {
        return auth
      }
      const vault = await deps.vaults.find(vaultId, visibility(auth))
      if (!vault) {
        return vaultNotFound(c)
      }
      const { state, search, createdFrom, createdTo, limit = 50, cursor } = c.req.valid('query')
      let parsedCursor: { createdAt: string; id: string } | null = null
      try {
        parsedCursor = cursor ? parseListCursor(cursor) : null
      } catch {
        return c.json(domainValidation('Invalid list cursor', { cursor: 'Cursor is invalid.' }), 400)
      }
      const page = await deps.vaults.listCredentials({
        vaultId: vault.metadata.uid,
        ...(state ? { state } : {}),
        ...(search ? { search } : {}),
        ...(createdFrom ? { createdFrom } : {}),
        ...(createdTo ? { createdTo } : {}),
        limit,
        cursor: parsedCursor,
      })
      const data = await Promise.all(
        page.rows.map(async (row) => serializeCredential(row, await deps.vaults.activeVersion(row))),
      )
      const last = page.rows.at(-1)
      const nextCursor =
        page.hasMore && last ? formatListCursor({ createdAt: last.metadata.createdAt, id: last.metadata.uid }) : null
      return c.json({ data, pagination: { limit, nextCursor, hasMore: page.hasMore } }, 200)
    })
    .openapi(createCredentialRoute, async (c) => {
      const { vaultId } = c.req.valid('param')
      const body = c.req.valid('json')
      const deps = c.get('deps')
      const auth = await requireAuth(c)
      if (auth instanceof Response) {
        return auth
      }
      const vault = await deps.vaults.find(vaultId, visibility(auth))
      if (!vault) {
        return vaultNotFound(c)
      }
      if (vault.metadata.archivedAt !== null) {
        return c.json({ error: { type: 'conflict', message: 'Vault is archived' } }, 409)
      }
      let result: Awaited<ReturnType<typeof createCredential>>
      try {
        result = await createCredential(deps, vault, {
          name: body.name,
          type: body.type,
          metadata: body.metadata ?? {},
          secret: body.secret,
        })
      } catch (error) {
        return secretErrorOr(c, error)
      }
      const serialized = serializeCredential(result.credential, result.version)
      await deps.audit.record(auth, {
        action: 'vault_credential.create',
        resourceType: 'vault_credential',
        resourceId: result.credential.metadata.uid,
        outcome: 'success',
        requestId: requestId(c),
        metadata: { vaultId: vault.metadata.uid },
        after: serialized,
      })
      return c.json(serialized, 201)
    })
    .openapi(readCredentialRoute, async (c) => {
      const { vaultId, credentialId } = c.req.valid('param')
      const deps = c.get('deps')
      const auth = await requireAuth(c)
      if (auth instanceof Response) {
        return auth
      }
      const vault = await deps.vaults.find(vaultId, visibility(auth))
      const credential = vault ? await deps.vaults.findCredential(vault.metadata.uid, credentialId) : null
      if (!vault || !credential) {
        return credentialNotFound(c)
      }
      return c.json(serializeCredential(credential, await deps.vaults.activeVersion(credential)), 200)
    })
    .openapi(updateCredentialRoute, async (c) => {
      const { vaultId, credentialId } = c.req.valid('param')
      const body = c.req.valid('json')
      const deps = c.get('deps')
      const auth = await requireAuth(c)
      if (auth instanceof Response) {
        return auth
      }
      const vault = await deps.vaults.find(vaultId, visibility(auth))
      const credential = vault ? await deps.vaults.findCredential(vault.metadata.uid, credentialId) : null
      if (!vault || !credential) {
        return credentialNotFound(c)
      }
      const timestamp = new Date().toISOString()
      const revoking = body.state === 'revoked'
      const fields = {
        metadata: body.metadata ?? credential.spec.metadata,
        state: body.state ?? credential.status.phase,
        activeVersionId: revoking ? null : credential.status.activeVersionId,
        revokedAt: revoking ? timestamp : credential.status.revokedAt,
        revokedByUserId: revoking ? auth.user.id : credential.status.revokedByUserId,
        revokeReason: revoking ? (body.revokeReason ?? null) : credential.status.revokeReason,
      }
      const before = serializeCredential(credential, await deps.vaults.activeVersion(credential))
      await deps.vaults.updateCredential(credential.metadata.uid, fields, timestamp, revoking, timestamp)
      const updated: Credential = {
        ...credential,
        metadata: { ...credential.metadata, updatedAt: timestamp },
        spec: { ...credential.spec, metadata: fields.metadata },
        status: {
          phase: fields.state,
          activeVersionId: fields.activeVersionId,
          revokedAt: fields.revokedAt,
          revokedByUserId: fields.revokedByUserId,
          revokeReason: fields.revokeReason,
        },
      }
      const serializedActiveVersion = revoking ? null : await deps.vaults.activeVersion(updated)
      const serialized = serializeCredential(updated, serializedActiveVersion)
      await deps.audit.record(auth, {
        action: revoking ? 'vault_credential.revoke' : 'vault_credential.update',
        resourceType: 'vault_credential',
        resourceId: credential.metadata.uid,
        outcome: 'success',
        requestId: requestId(c),
        metadata: { vaultId: vault.metadata.uid },
        before,
        after: serialized,
      })
      return c.json(serialized, 200)
    })
    .openapi(updateCredentialSecretRoute, async (c) => {
      const { vaultId, credentialId } = c.req.valid('param')
      const body = c.req.valid('json')
      const deps = c.get('deps')
      const auth = await requireAuth(c)
      if (auth instanceof Response) {
        return auth
      }
      const vault = await deps.vaults.find(vaultId, visibility(auth))
      const credential = vault ? await deps.vaults.findCredential(vault.metadata.uid, credentialId) : null
      if (!vault || !credential) {
        return credentialNotFound(c)
      }
      if (vault.metadata.archivedAt !== null || credential.status.phase !== 'active') {
        return c.json({ error: { type: 'conflict', message: 'Credential is not active' } }, 409)
      }
      const before = serializeCredential(credential, await deps.vaults.activeVersion(credential))
      let result: Awaited<ReturnType<typeof rotateCredential>>
      try {
        result = await rotateCredential(deps, credential, body)
      } catch (error) {
        return secretErrorOr(c, error)
      }
      const serialized = serializeCredential(result.credential, result.version)
      await deps.audit.record(auth, {
        action: 'vault_credential.secret.update',
        resourceType: 'vault_credential',
        resourceId: credential.metadata.uid,
        outcome: 'success',
        requestId: requestId(c),
        metadata: { vaultId: vault.metadata.uid, activeVersionId: result.version.metadata.uid },
        before,
        after: serialized,
      })
      return c.json(serialized, 200)
    })
    .openapi(listVersionsRoute, async (c) => {
      const { vaultId, credentialId } = c.req.valid('param')
      const { state, createdFrom, createdTo, limit = 50, cursor } = c.req.valid('query')
      const deps = c.get('deps')
      const auth = await requireAuth(c)
      if (auth instanceof Response) {
        return auth
      }
      const vault = await deps.vaults.find(vaultId, visibility(auth))
      const credential = vault ? await deps.vaults.findCredential(vault.metadata.uid, credentialId) : null
      if (!vault || !credential) {
        return credentialNotFound(c)
      }
      let parsedCursor: { createdAt: string; id: string } | null = null
      try {
        parsedCursor = cursor ? parseListCursor(cursor) : null
      } catch {
        return c.json(domainValidation('Invalid list cursor', { cursor: 'Cursor is invalid.' }), 400)
      }
      const page = await deps.vaults.listVersions({
        credentialId: credential.metadata.uid,
        ...(state ? { state } : {}),
        ...(createdFrom ? { createdFrom } : {}),
        ...(createdTo ? { createdTo } : {}),
        limit,
        cursor: parsedCursor,
      })
      const last = page.rows.at(-1)
      const nextCursor =
        page.hasMore && last ? formatListCursor({ createdAt: last.metadata.createdAt, id: last.metadata.uid }) : null
      return c.json(
        { data: page.rows.map(serializeVersion), pagination: { limit, nextCursor, hasMore: page.hasMore } },
        200,
      )
    })
    .openapi(readVersionRoute, async (c) => {
      const { vaultId, credentialId, versionId } = c.req.valid('param')
      const deps = c.get('deps')
      const auth = await requireAuth(c)
      if (auth instanceof Response) {
        return auth
      }
      const vault = await deps.vaults.find(vaultId, visibility(auth))
      const credential = vault ? await deps.vaults.findCredential(vault.metadata.uid, credentialId) : null
      const version = credential ? await deps.vaults.findVersion(credential.metadata.uid, versionId) : null
      if (!vault || !credential || !version) {
        return versionNotFound(c)
      }
      return c.json(serializeVersion(version), 200)
    })
}

// --- helpers ---

function visibility(auth: { organization: { id: string }; project: { id: string } }) {
  return { organizationId: auth.organization.id, projectId: auth.project.id }
}

function vaultNotFound(c: Parameters<Parameters<VaultRoutes['openapi']>[1]>[0]) {
  return c.json({ error: { type: 'not_found', message: 'Vault not found' } }, 404)
}

function credentialNotFound(c: Parameters<Parameters<VaultRoutes['openapi']>[1]>[0]) {
  return c.json({ error: { type: 'not_found', message: 'Credential not found' } }, 404)
}

function versionNotFound(c: Parameters<Parameters<VaultRoutes['openapi']>[1]>[0]) {
  return c.json({ error: { type: 'not_found', message: 'Credential version not found' } }, 404)
}

function secretErrorOr(c: Parameters<Parameters<VaultRoutes['openapi']>[1]>[0], error: unknown) {
  if (error instanceof VaultSecretError) {
    return c.json(domainValidation(error.message, { secret: error.message }), 400)
  }
  throw error
}
