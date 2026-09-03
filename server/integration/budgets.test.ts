import { SELF } from 'cloudflare:test'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { dpopHeaders, setupOidcProvider, signIn } from './auth'

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

describe('[CF] v1 budgets', () => {
  beforeEach(async () => {
    await setupOidcProvider()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('creates budgets defaulting to enabled and manages the item routes [spec: governance/budget-api]', async () => {
    const authorization = await signIn()

    const createRes = await jsonFetch('/api/v1/budgets', authorization, {
      method: 'POST',
      body: JSON.stringify({ scope: 'project', limitType: 'tokens', limitValue: 1000000, window: 'month' }),
    })
    expect(createRes.status).toBe(201)
    const created = (await createRes.json()) as { id: string; enabled: boolean }
    expect(created).toMatchObject({
      scope: 'project',
      providerId: null,
      modelId: null,
      limitType: 'tokens',
      limitValue: 1000000,
      window: 'month',
      enabled: true,
    })
    expect(JSON.stringify(created)).not.toContain('organizationId')
    expect(JSON.stringify(created)).not.toContain('"status"')

    const listRes = await jsonFetch('/api/v1/budgets', authorization)
    expect(listRes.status).toBe(200)
    const list = (await listRes.json()) as { data: Array<{ id: string }> }
    expect(list.data).toContainEqual(expect.objectContaining({ id: created.id }))

    const readRes = await jsonFetch(`/api/v1/budgets/${created.id}`, authorization)
    expect(readRes.status).toBe(200)

    const patchRes = await jsonFetch(`/api/v1/budgets/${created.id}`, authorization, {
      method: 'PATCH',
      body: JSON.stringify({ limitValue: 500, window: 'day', enabled: false, metadata: { note: 'paused' } }),
    })
    expect(patchRes.status).toBe(200)
    await expect(patchRes.json()).resolves.toMatchObject({
      id: created.id,
      limitValue: 500,
      window: 'day',
      enabled: false,
      metadata: { note: 'paused' },
    })

    const deleteRes = await jsonFetch(`/api/v1/budgets/${created.id}`, authorization, { method: 'DELETE' })
    expect(deleteRes.status).toBe(204)

    const goneRes = await jsonFetch(`/api/v1/budgets/${created.id}`, authorization)
    expect(goneRes.status).toBe(404)
    expect(
      (
        await jsonFetch(`/api/v1/budgets/${created.id}`, authorization, {
          method: 'PATCH',
          body: JSON.stringify({ limitValue: 1 }),
        })
      ).status,
    ).toBe(404)
  })

  it('requires providerId and modelId for provider- and model-scoped budgets', async () => {
    const authorization = await signIn()

    const providerScopedRes = await jsonFetch('/api/v1/budgets', authorization, {
      method: 'POST',
      body: JSON.stringify({ scope: 'provider', limitType: 'tokens', limitValue: 100, window: 'month' }),
    })
    expect(providerScopedRes.status).toBe(400)
    await expect(providerScopedRes.json()).resolves.toMatchObject({
      error: { type: 'validation_error', details: { fields: { providerId: expect.any(String) } } },
    })

    const modelScopedRes = await jsonFetch('/api/v1/budgets', authorization, {
      method: 'POST',
      body: JSON.stringify({ scope: 'model', limitType: 'cost_micros', limitValue: 100, window: 'day' }),
    })
    expect(modelScopedRes.status).toBe(400)
    await expect(modelScopedRes.json()).resolves.toMatchObject({
      error: { type: 'validation_error', details: { fields: { modelId: expect.any(String) } } },
    })

    const validRes = await jsonFetch('/api/v1/budgets', authorization, {
      method: 'POST',
      body: JSON.stringify({
        scope: 'model',
        providerId: 'workers-ai',
        modelId: '@cf/moonshotai/kimi-k2.6',
        limitType: 'cost_micros',
        limitValue: 100,
        window: 'day',
        enabled: false,
      }),
    })
    expect(validRes.status).toBe(201)
    await expect(validRes.json()).resolves.toMatchObject({
      scope: 'model',
      providerId: 'workers-ai',
      modelId: '@cf/moonshotai/kimi-k2.6',
      enabled: false,
    })
  })
})
