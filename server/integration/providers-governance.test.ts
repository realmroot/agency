import { SELF } from 'cloudflare:test'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { dpopHeaders, seedPlatformProvider, setupOidcProvider, signIn } from './auth'

function createResourceBody(metadata: { name: string; description?: string }, spec: Record<string, unknown> = {}) {
  return { metadata, spec }
}

async function jsonFetch(path: string, authorization: string, init: RequestInit = {}) {
  return await SELF.fetch(`https://example.com${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...dpopHeaders(authorization, init.method ?? 'GET', path),
      ...init.headers,
    },
  })
}

// Governance, usage, and audit coverage lives in focused tests:
// budgets.test.ts, usage-records.test.ts, usage-summary.test.ts, and audit.test.ts.
describe('[CF] providers', () => {
  beforeEach(async () => {
    await setupOidcProvider()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('lists global model vendors and governs agent provider binding without exposing credentials', async () => {
    const authorization = await signIn()

    // The model catalog is a global vendor list now; seed an enabled and a
    // disabled vendor row directly (discovery owns these in production).
    await seedPlatformProvider()
    const { providerId: disabledProviderId, modelId: disabledModelId } = await seedPlatformProvider({
      providerId: 'gateway-vendor',
      slug: 'gateway-vendor',
      displayName: 'Gateway Vendor',
      modelId: 'gateway-model',
      enabled: false,
    })

    const listRes = await jsonFetch('/api/v1/providers', authorization)
    expect(listRes.status).toBe(200)
    const list = (await listRes.json()) as { data: Array<{ id: string; slug: string }> }
    expect(list.data).toContainEqual(expect.objectContaining({ id: 'workers-ai', slug: 'workers-ai' }))
    // The de-tenanted catalog never carries transport/credential fields.
    const serialized = JSON.stringify(list)
    expect(serialized).not.toContain('credentialSecretRef')
    expect(serialized).not.toContain('secretRef')
    expect(serialized).not.toContain('baseUrl')

    // A null provider defers resolution to session start (docs §Agents).
    const deferredAgentRes = await jsonFetch('/api/v1/agents', authorization, {
      method: 'POST',
      body: JSON.stringify(
        createResourceBody(
          { name: 'Deferred provider agent' },
          { systemPrompt: 'Defer model provider selection until session start.' },
        ),
      ),
    })
    expect(deferredAgentRes.status).toBe(201)
    await expect(deferredAgentRes.json()).resolves.toMatchObject({ spec: { provider: null } })

    // Binding to an enabled vendor + available model succeeds.
    const boundAgentRes = await jsonFetch('/api/v1/agents', authorization, {
      method: 'POST',
      body: JSON.stringify(
        createResourceBody(
          { name: 'Workers AI agent' },
          {
            systemPrompt: 'Use the configured Workers AI provider.',
            provider: 'workers-ai',
            model: '@cf/moonshotai/kimi-k2.6',
          },
        ),
      ),
    })
    expect(boundAgentRes.status).toBe(201)
    await expect(boundAgentRes.json()).resolves.toMatchObject({ spec: { provider: 'workers-ai' } })

    // Binding to a disabled vendor is rejected at agent creation.
    const disabledAgentRes = await jsonFetch('/api/v1/agents', authorization, {
      method: 'POST',
      body: JSON.stringify(
        createResourceBody(
          { name: 'Disabled vendor agent' },
          {
            systemPrompt: 'Attempt to bind a disabled provider.',
            provider: disabledProviderId,
            model: disabledModelId,
          },
        ),
      ),
    })
    expect(disabledAgentRes.status).toBe(400)
    await expect(disabledAgentRes.json()).resolves.toMatchObject({
      error: { type: 'validation_error', details: { fields: { provider: expect.any(String) } } },
    })
  })
})
