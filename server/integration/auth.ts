import { env } from 'cloudflare:workers'
import { expect, vi } from 'vitest'
import type { Env } from '../env'

// Providers are a global vendor catalog (no org/project). Tests that pin an
// agent to a provider/model need the row to exist so the agent.providerId FK
// and the provider/model availability checks resolve. Provider rows use the
// vendor slug as their id (id === slug; discovery upserts id: slug). The cloud
// runtime ('ama') dispatches every model through the Workers AI binding, which
// only recognizes the 'workers-ai' provider, so this seeds that vendor plus the
// default model the test agents pin. Call from a beforeEach: isolated storage
// resets writes between tests.
export const PLATFORM_PROVIDER_ID = 'workers-ai'
export const PLATFORM_MODEL_ID = '@cf/moonshotai/kimi-k2.6'

export async function seedPlatformProvider(
  options: { providerId?: string; slug?: string; displayName?: string; modelId?: string; enabled?: boolean } = {},
) {
  const db = (env as unknown as Env).DB
  const providerId = options.providerId ?? PLATFORM_PROVIDER_ID
  const slug = options.slug ?? PLATFORM_PROVIDER_ID
  const displayName = options.displayName ?? 'Workers AI'
  const modelId = options.modelId ?? PLATFORM_MODEL_ID
  const enabled = options.enabled ?? true
  const timestamp = new Date().toISOString()
  await db
    .prepare(
      `INSERT INTO providers (id, slug, display_name, enabled, metadata, model_catalog_state, last_error, created_at, updated_at)
     VALUES (?, ?, ?, ?, '{}', 'ready', NULL, ?, ?)
     ON CONFLICT(id) DO UPDATE SET enabled = excluded.enabled, updated_at = excluded.updated_at`,
    )
    .bind(providerId, slug, displayName, enabled ? 1 : 0, timestamp, timestamp)
    .run()
  await db
    .prepare(
      `INSERT INTO provider_models (id, provider_id, model_id, display_name, capabilities, context_window, pricing, availability, metadata, created_at, updated_at)
     VALUES (?, ?, ?, ?, '["text"]', NULL, '{}', 'available', '{}', ?, ?)
     ON CONFLICT(provider_id, model_id) DO NOTHING`,
    )
    .bind(
      `${providerId}_${modelId}`.replaceAll(/[^A-Za-z0-9_-]/g, '_'),
      providerId,
      modelId,
      modelId,
      timestamp,
      timestamp,
    )
    .run()
  return { providerId, modelId }
}

interface TestClaims {
  sub: string
  email: string
  name: string
  organizationId: string
  roles: string[]
  permissions: string[]
}

let counter = 0

export function defaultClaims(): TestClaims {
  return {
    sub: 'user_123',
    email: 'user@example.com',
    name: 'Ada Lovelace',
    organizationId: 'org_flare_123',
    roles: ['owner'],
    permissions: ['agents:write', 'agents:read'],
  }
}

export async function setupOidcProvider() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      return new Response('not found', { status: 404 })
    }),
  )
}

export async function signIn(claims = defaultClaims()) {
  counter += 1
  const runId = `${claims.sub}_${counter}`.replaceAll(/[^A-Za-z0-9_-]/g, '_')
  return `Bearer e2e:${runId}`
}

export async function signInRunner(claims = defaultClaims()) {
  counter += 1
  const runId = `${claims.sub}_${counter}`.replaceAll(/[^A-Za-z0-9_-]/g, '_')
  return `Bearer e2e-runner:${runId}`
}

export function asRunnerAuthorization(authorization: string) {
  return authorization.replace(/^Bearer e2e:/, 'Bearer e2e-runner:')
}

export function dpopHeaders(authorization: string, method: string, path: string) {
  if (authorization.startsWith('Bearer ')) {
    return { authorization }
  }
  const target = new URL(path, 'https://example.com')
  target.hash = ''
  target.search = ''
  return {
    authorization,
    dpop: `e2e-proof:${method.toUpperCase()}:${target.toString()}`,
  }
}

export async function signInUser(suffix: string) {
  return signIn({
    ...defaultClaims(),
    sub: `user_${suffix}`,
    email: `${suffix}@example.com`,
    organizationId: `org_${suffix}`,
  })
}

export function expectAuthRequired(body: unknown) {
  expect(body).toEqual({
    error: {
      type: 'authentication_required',
      message: 'Authentication required',
      details: { reason: 'missing_or_invalid_realmroot_credential' },
    },
  })
}
