import { SELF } from 'cloudflare:test'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { dpopHeaders, expectAuthRequired, seedPlatformProvider, setupOidcProvider, signInUser } from './auth'

async function jsonFetch(path: string, authorization: string | null, init: RequestInit = {}) {
  return await SELF.fetch(`https://example.com${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...(authorization ? dpopHeaders(authorization, init.method ?? 'GET', path) : {}),
      ...init.headers,
    },
  })
}

// The global model catalog is populated by the discovery refresh, not per-tenant
// CRUD. These tests seed the catalog directly (seedPlatformProvider) for the read
// routes and stub the discovery feeds for the refresh route.
describe('[CF] providers v1 [spec: providers/api-catalog]', () => {
  beforeEach(async () => {
    await setupOidcProvider()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('requires authentication', async () => {
    const res = await jsonFetch('/api/v1/providers', null)
    expect(res.status).toBe(401)
    expectAuthRequired(await res.json())
  })

  it('lists global model vendors with the v1 catalog schema', async () => {
    const authorization = await signInUser('providers_list')
    await seedPlatformProvider()

    const res = await jsonFetch('/api/v1/providers', authorization)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: Array<Record<string, unknown>> }
    expect(body.data).toContainEqual(
      expect.objectContaining({
        id: 'workers-ai',
        slug: 'workers-ai',
        displayName: 'Workers AI',
        enabled: true,
        modelCatalogState: 'ready',
        lastError: null,
      }),
    )
    // The de-tenanted provider carries no transport/credential/default fields.
    const serialized = JSON.stringify(body)
    expect(serialized).not.toContain('"type"')
    expect(serialized).not.toContain('baseUrl')
    expect(serialized).not.toContain('secretRef')
    expect(serialized).not.toContain('credentialStatus')
    expect(serialized).not.toContain('isDefault')
  })

  it('reads a single vendor and 404s for unknown ids', async () => {
    const authorization = await signInUser('providers_read')
    await seedPlatformProvider()

    const readRes = await jsonFetch('/api/v1/providers/workers-ai', authorization)
    expect(readRes.status).toBe(200)
    await expect(readRes.json()).resolves.toMatchObject({ id: 'workers-ai', slug: 'workers-ai' })

    const missingRes = await jsonFetch('/api/v1/providers/provider_missing', authorization)
    expect(missingRes.status).toBe(404)
    await expect(missingRes.json()).resolves.toMatchObject({ error: { type: 'not_found' } })
  })

  it('lists all catalog models and a single vendor models', async () => {
    const authorization = await signInUser('providers_models')
    await seedPlatformProvider()

    const allModelsRes = await jsonFetch('/api/v1/providers/models', authorization)
    expect(allModelsRes.status).toBe(200)
    const allModels = (await allModelsRes.json()) as { data: Array<{ providerId: string; modelId: string }> }
    expect(allModels.data).toContainEqual(
      expect.objectContaining({ providerId: 'workers-ai', modelId: '@cf/moonshotai/kimi-k2.6' }),
    )

    const vendorModelsRes = await jsonFetch('/api/v1/providers/workers-ai/models', authorization)
    expect(vendorModelsRes.status).toBe(200)
    const vendorModels = (await vendorModelsRes.json()) as { data: Array<{ modelId: string }> }
    expect(vendorModels.data).toContainEqual(expect.objectContaining({ modelId: '@cf/moonshotai/kimi-k2.6' }))

    const unknownVendorRes = await jsonFetch('/api/v1/providers/provider_missing/models', authorization)
    expect(unknownVendorRes.status).toBe(404)
  })

  it('refreshes the global catalog from the discovery feeds', async () => {
    const authorization = await signInUser('providers_refresh')

    // Discovery is keyless: the whole catalog comes from models.dev, with native
    // @cf models under the cloudflare-workers-ai provider.
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = new URL(input instanceof Request ? input.url : input.toString())
        if (url.hostname === 'models.dev') {
          return Response.json({
            'cloudflare-workers-ai': {
              models: { '@cf/moonshotai/kimi-k2.6': { tool_call: true, limit: { context: 128000 } } },
            },
            anthropic: {
              models: { 'claude-opus-4': { name: 'Claude Opus 4', tool_call: true, limit: { context: 200000 } } },
            },
            openai: {
              models: { 'gpt-5': { name: 'GPT-5', tool_call: true, limit: { context: 400000 } } },
            },
          })
        }
        return new Response('not found', { status: 404 })
      }),
    )

    const refreshRes = await jsonFetch('/api/v1/providers/refresh', authorization, { method: 'POST' })
    expect(refreshRes.status).toBe(200)
    await expect(refreshRes.json()).resolves.toMatchObject({
      outcome: 'succeeded',
      discoveredCount: 3,
      vendors: 3,
    })

    const listRes = await jsonFetch('/api/v1/providers', authorization)
    const list = (await listRes.json()) as { data: Array<{ slug: string; modelCatalogState: string }> }
    const slugs = list.data.map((row) => row.slug)
    expect(slugs).toEqual(expect.arrayContaining(['moonshotai', 'anthropic', 'openai']))
    for (const row of list.data) {
      expect(row.modelCatalogState).toBe('ready')
    }

    const modelsRes = await jsonFetch('/api/v1/providers/models', authorization)
    const models = (await modelsRes.json()) as { data: Array<{ modelId: string }> }
    expect(models.data.map((row) => row.modelId)).toEqual(
      expect.arrayContaining(['@cf/moonshotai/kimi-k2.6', 'anthropic/claude-opus-4', 'openai/gpt-5']),
    )
  })

  it('records a failed refresh without leaking discovery failures as raw payloads', async () => {
    const authorization = await signInUser('providers_refresh_fail')
    // Seed an existing vendor so the failure path can stamp its catalog status.
    await seedPlatformProvider()

    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = new URL(input instanceof Request ? input.url : input.toString())
        if (url.hostname === 'models.dev') {
          return new Response('upstream unavailable', { status: 503 })
        }
        return new Response('not found', { status: 404 })
      }),
    )

    const refreshRes = await jsonFetch('/api/v1/providers/refresh', authorization, { method: 'POST' })
    expect(refreshRes.status).toBe(200)
    await expect(refreshRes.json()).resolves.toMatchObject({ outcome: 'failed', discoveredCount: 0 })

    const readRes = await jsonFetch('/api/v1/providers/workers-ai', authorization)
    await expect(readRes.json()).resolves.toMatchObject({ modelCatalogState: 'error' })
  })
})
