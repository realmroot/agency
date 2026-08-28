// E2E test fixture (gated by AMA_E2E_TEST_AUTH). It reads the raw persisted
// vault credential rows — including ciphertext — so encryption-at-rest scenarios
// can assert real storage behaviour. That storage-level inspection is the
// fixture's whole reason to exist, so it holds drizzle directly and carries a
// narrow named exemption in .dependency-cruiser.cjs rather than polluting the
// production VaultRepo port with a test-only raw-row method.
import { and, eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { Hono } from 'hono'
import { getAccessTokenClaims, oidcAudience, upsertProjectForClaims } from '../auth/oidc'
import { requireAuth } from '../auth/session'
import { createE2eWebSession } from '../auth/web-session'
import { providerModels, providers, vaultCredentialVersions } from '../db/schema'
import type { Env } from '../env'
import { errorResponse } from '../errors'
import { dispatchDueScheduledTriggers } from '../scheduled-dispatch'
import { decryptSecretValue } from '../vault-crypto'

const app = new Hono<{ Bindings: Env }>()

function newId(prefix: string) {
  return `${prefix}_${crypto.randomUUID().replaceAll('-', '')}`
}

function vaultEncryptionKeyConfigured(env: Env) {
  return typeof env.AMA_VAULT_ENCRYPTION_KEY === 'string' && env.AMA_VAULT_ENCRYPTION_KEY.length >= 32
}

function flipFirstCharacter(value: string) {
  const replacement = value.startsWith('A') ? 'B' : 'A'
  return `${replacement}${value.slice(1)}`
}

const routes = app
  .post('/auth/token', async (c) => {
    if (c.env.AMA_E2E_TEST_AUTH !== 'true') {
      return errorResponse(c, 404, 'not_found', 'Not found')
    }

    const body: { runId?: string } = await c.req.json<{ runId?: string }>().catch(() => ({}))
    const runId = body.runId?.replaceAll(/[^A-Za-z0-9_-]/g, '_') || newId('run')
    const accessToken = `e2e:${runId}`
    const claims = await getAccessTokenClaims(c.env, accessToken, oidcAudience(c.env, c.req.url))
    const project = await upsertProjectForClaims(drizzle(c.env.DB), claims, new Date().toISOString())
    return c.json({ accessToken, userId: claims.sub, organizationId: claims.org_id, projectId: project.id }, 201)
  })
  .post('/auth/session', async (c) => {
    if (c.env.AMA_E2E_TEST_AUTH !== 'true' || c.env.AMA_RUNTIME_MODE !== 'test') {
      return errorResponse(c, 404, 'not_found', 'Not found')
    }
    const body = await c.req.json<{ accessToken?: string }>().catch(() => ({}) as { accessToken?: string })
    if (!body.accessToken?.startsWith('e2e:')) {
      return errorResponse(c, 400, 'validation_error', 'An E2E access token is required')
    }
    await createE2eWebSession(c, body.accessToken)
    c.header('Cache-Control', 'no-store')
    return c.body(null, 204)
  })
  .get('/ready', (c) => {
    if (c.env.AMA_E2E_TEST_AUTH !== 'true') {
      return errorResponse(c, 404, 'not_found', 'Not found')
    }
    return c.json({ ok: true, runtimeMode: c.env.AMA_RUNTIME_MODE ?? null })
  })
  // Seeds the global vendor catalog (a provider + one model) so browser journeys
  // can pin a provider/model on an agent and create a session. Discovery hits
  // external feeds, so e2e seeds the catalog directly instead. Idempotent.
  .post('/catalog/seed', async (c) => {
    if (c.env.AMA_E2E_TEST_AUTH !== 'true' || c.env.AMA_RUNTIME_MODE !== 'test') {
      return errorResponse(c, 404, 'not_found', 'Not found')
    }
    const auth = await requireAuth(c)
    if (auth instanceof Response) {
      return auth
    }
    const db = drizzle(c.env.DB)
    const now = new Date().toISOString()
    const slug = 'workers-ai'
    const modelId = '@cf/moonshotai/kimi-k2.6'
    await db
      .insert(providers)
      .values({ id: slug, slug, displayName: 'Workers AI', enabled: true, createdAt: now, updatedAt: now })
      .onConflictDoNothing()
    await db
      .insert(providerModels)
      .values({
        id: `model_${slug}_${modelId}`.replaceAll(/[^a-z0-9]+/gi, '_'),
        providerId: slug,
        modelId,
        displayName: 'Kimi K2.6',
        availability: 'available',
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing()
    return c.json({ providerId: slug, modelId }, 201)
  })
  // Local-product-spec inspection of vault credential storage. Returns the raw
  // persisted D1 row (including ciphertext) so encryption-at-rest scenarios can
  // assert real storage behavior without direct database access. Never enabled
  // outside the local e2e harness.
  .get('/vault-credential-versions/:versionId/storage', async (c) => {
    if (c.env.AMA_E2E_TEST_AUTH !== 'true' || c.env.AMA_RUNTIME_MODE !== 'test') {
      return errorResponse(c, 404, 'not_found', 'Not found')
    }
    const db = drizzle(c.env.DB)
    const auth = await requireAuth(c)
    if (auth instanceof Response) {
      return auth
    }
    const row = await db
      .select()
      .from(vaultCredentialVersions)
      .where(
        and(
          eq(vaultCredentialVersions.id, c.req.param('versionId')),
          eq(vaultCredentialVersions.organizationId, auth.organization.id),
        ),
      )
      .get()
    if (!row) {
      return errorResponse(c, 404, 'not_found', 'Credential version not found')
    }
    return c.json({ encryptionKeyConfigured: vaultEncryptionKeyConfigured(c.env), row }, 200)
  })
  // Performs a real AES-GCM round trip against the persisted ciphertext and a
  // tampered copy of it inside the Worker, reporting only booleans back.
  .post('/vault-credential-versions/:versionId/encryption-check', async (c) => {
    if (c.env.AMA_E2E_TEST_AUTH !== 'true' || c.env.AMA_RUNTIME_MODE !== 'test') {
      return errorResponse(c, 404, 'not_found', 'Not found')
    }
    const db = drizzle(c.env.DB)
    const auth = await requireAuth(c)
    if (auth instanceof Response) {
      return auth
    }
    const row = await db
      .select()
      .from(vaultCredentialVersions)
      .where(
        and(
          eq(vaultCredentialVersions.id, c.req.param('versionId')),
          eq(vaultCredentialVersions.organizationId, auth.organization.id),
        ),
      )
      .get()
    if (!row) {
      return errorResponse(c, 404, 'not_found', 'Credential version not found')
    }
    const body = await c.req.json<{ expectedValue?: string }>().catch(() => ({}) as { expectedValue?: string })
    const metadata = JSON.parse(row.metadata) as { encryptedSecretData?: Record<string, { ciphertext?: string }> }
    const encryptedData = metadata.encryptedSecretData ?? {}
    const encrypted = encryptedData[Object.keys(encryptedData)[0] ?? '']
    if (!encrypted || typeof encrypted.ciphertext !== 'string') {
      return errorResponse(c, 409, 'conflict', 'Credential version has no managed ciphertext')
    }
    const value = await decryptSecretValue(c.env, encrypted)
    const tampered = { ...encrypted, ciphertext: flipFirstCharacter(encrypted.ciphertext) }
    let tamperRejected = false
    try {
      await decryptSecretValue(c.env, tampered)
    } catch {
      tamperRejected = true
    }
    return c.json(
      {
        encryptionKeyConfigured: vaultEncryptionKeyConfigured(c.env),
        decrypts: typeof value === 'string',
        matchesExpected: body.expectedValue === undefined ? null : value === body.expectedValue,
        tamperRejected,
      },
      200,
    )
  })
  .post('/scheduled-agent-triggers/dispatch', async (c) => {
    if (c.env.AMA_E2E_TEST_AUTH !== 'true' || c.env.AMA_RUNTIME_MODE !== 'test') {
      return errorResponse(c, 404, 'not_found', 'Not found')
    }
    const auth = await requireAuth(c)
    if (auth instanceof Response) {
      return auth
    }
    const body: { heartbeatAt?: string } = await c.req.json<{ heartbeatAt?: string }>().catch(() => ({}))
    const result = await dispatchDueScheduledTriggers(c.env, c.executionCtx, {
      ...(body.heartbeatAt !== undefined ? { heartbeatAt: body.heartbeatAt } : {}),
      projectId: auth.project.id,
    })
    return c.json(result, 200)
  })

export default routes
