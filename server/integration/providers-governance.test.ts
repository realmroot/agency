import { SELF } from 'cloudflare:test'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { dpopHeaders, seedPlatformProvider, setupOidcProvider, signIn } from './auth'
import { createReadyAgent } from './v2-resources'

async function jsonFetch(path: string, authorization: string) {
  return SELF.fetch(`https://example.com${path}`, {
    headers: { ...dpopHeaders(authorization, 'GET', path) },
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
    const deferredAgent = await createReadyAgent(authorization, {
      name: 'Deferred provider agent',
      systemPrompt: 'Defer model provider selection until session start.',
      provider: null,
      model: null,
    })
    expect(deferredAgent).toMatchObject({ spec: { provider: null } })

    // Binding to an enabled vendor + available model succeeds.
    const boundAgent = await createReadyAgent(authorization, {
      name: 'Workers AI agent',
      systemPrompt: 'Use the configured Workers AI provider.',
      provider: 'workers-ai',
      model: '@cf/moonshotai/kimi-k2.6',
    })
    expect(boundAgent).toMatchObject({ spec: { provider: 'workers-ai' } })

    // Binding to a disabled vendor is rejected at agent creation.
    await expect(
      createReadyAgent(authorization, {
        name: 'Disabled vendor agent',
        systemPrompt: 'Attempt to bind a disabled provider.',
        provider: disabledProviderId,
        model: disabledModelId,
      }),
    ).rejects.toThrow(/provider|disabled/i)
  })
})
