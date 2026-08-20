import { SELF } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'
import { defaultClaims, dpopHeaders, setupOidcProvider, signIn } from './auth'

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

async function signInUser(suffix: string) {
  return await signIn({
    ...defaultClaims(),
    sub: `user_connectors_${suffix}`,
    email: `connectors-${suffix}@example.com`,
    org_id: `org_flare_connectors_${suffix}`,
    org_name: `Connectors ${suffix} Org`,
  })
}

describe('[CF] Connector catalog [spec: mcp/discovery]', () => {
  beforeEach(async () => {
    await setupOidcProvider()
  })

  it('lists, filters, and reads the static connector catalog [spec: mcp/catalog]', async () => {
    const authorization = await signInUser('catalog')

    const listRes = await jsonFetch(
      '/api/v1/connectors?search=GitHub&category=development&capability=repositories',
      authorization,
    )
    expect(listRes.status).toBe(200)
    const list = (await listRes.json()) as {
      data: Array<Record<string, unknown>>
      pagination: { limit: number; nextCursor: string | null; hasMore: boolean }
    }
    expect(list.data).toContainEqual(
      expect.objectContaining({
        id: 'github',
        name: 'GitHub',
        availability: 'available',
        tools: [expect.objectContaining({ name: 'repo.read' })],
      }),
    )
    expect(list.pagination).toMatchObject({ hasMore: false, nextCursor: null })

    const detailRes = await jsonFetch('/api/v1/connectors/github', authorization)
    expect(detailRes.status).toBe(200)
    const connector = (await detailRes.json()) as Record<string, unknown>
    expect(connector).toMatchObject({
      id: 'github',
      category: 'development',
      trustLevel: 'verified',
      supportedAuthModes: ['vault_credential'],
      tools: [expect.objectContaining({ name: 'repo.read' })],
    })
    // The Connector schema is a pure static directory entry: tenant-coupled
    // policy/connection projections and the redundant slug field are gone.
    expect(connector).not.toHaveProperty('policyStatus')
    expect(connector).not.toHaveProperty('connectionStatus')
    expect(connector).not.toHaveProperty('connectorId')
    expect(connector).not.toHaveProperty('status')

    const missingRes = await jsonFetch('/api/v1/connectors/unknown', authorization)
    expect(missingRes.status).toBe(404)

    const invalidCursorRes = await jsonFetch('/api/v1/connectors?cursor=not-a-valid-cursor', authorization)
    expect(invalidCursorRes.status).toBe(400)
  })

  it('filters by availability and category without leaking other catalogs', async () => {
    const authorization = await signInUser('filters')

    const planningRes = await jsonFetch('/api/v1/connectors?category=planning', authorization)
    expect(planningRes.status).toBe(200)
    const planning = (await planningRes.json()) as { data: Array<{ id: string }> }
    expect(planning.data.map((connector) => connector.id)).toEqual(['linear'])

    const availableRes = await jsonFetch('/api/v1/connectors?availability=available', authorization)
    expect(availableRes.status).toBe(200)
    const available = (await availableRes.json()) as { data: Array<{ id: string; availability: string }> }
    expect(available.data.length).toBeGreaterThanOrEqual(2)
    for (const connector of available.data) {
      expect(connector.availability).toBe('available')
    }

    const unavailableRes = await jsonFetch('/api/v1/connectors?availability=unavailable', authorization)
    expect(unavailableRes.status).toBe(200)
    await expect(unavailableRes.json()).resolves.toMatchObject({ data: [] })
  })

  it('serves the same static catalog to every tenant', async () => {
    const first = await signInUser('tenant_a')
    const second = await signInUser('tenant_b')

    const firstRes = await jsonFetch('/api/v1/connectors/github', first)
    const secondRes = await jsonFetch('/api/v1/connectors/github', second)
    expect(firstRes.status).toBe(200)
    expect(secondRes.status).toBe(200)
    await expect(firstRes.json()).resolves.toEqual(await secondRes.json())
  })

  it('requires authentication', async () => {
    const res = await SELF.fetch('https://example.com/api/v1/connectors')
    expect(res.status).toBe(401)
  })
})
