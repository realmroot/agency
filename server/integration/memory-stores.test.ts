import { SELF } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'
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

describe('[CF] /api/v1/memory-stores', () => {
  beforeEach(async () => {
    await setupOidcProvider()
  })

  it('creates stores and manages memory entries [spec: memory-stores/crud]', async () => {
    const authorization = await signIn()
    const createRes = await jsonFetch('/api/v1/memory-stores', authorization, {
      method: 'POST',
      body: JSON.stringify({
        metadata: { name: 'Team memory', description: 'Review conventions' },
        spec: {},
      }),
    })
    expect(createRes.status).toBe(201)
    const store = (await createRes.json()) as {
      metadata: { uid: string; name: string; description: string | null; archivedAt: string | null }
      spec: Record<string, never>
      status: { phase: string }
    }
    expect(store).toMatchObject({
      metadata: { name: 'Team memory', description: 'Review conventions', archivedAt: null },
      spec: {},
      status: { phase: 'active' },
    })

    const memoryRes = await jsonFetch(`/api/v1/memory-stores/${store.metadata.uid}/memories`, authorization, {
      method: 'POST',
      body: JSON.stringify({ path: 'guides/review.md', content: 'Review for correctness first.' }),
    })
    expect(memoryRes.status).toBe(201)
    const memory = (await memoryRes.json()) as {
      metadata: { uid: string }
      spec: { path: string; content: string }
      status: { phase: string }
    }
    expect(memory).toMatchObject({
      spec: { path: 'guides/review.md', content: 'Review for correctness first.' },
      status: { phase: 'active' },
    })

    const duplicateRes = await jsonFetch(`/api/v1/memory-stores/${store.metadata.uid}/memories`, authorization, {
      method: 'POST',
      body: JSON.stringify({ path: 'guides/review.md', content: 'Duplicate' }),
    })
    expect(duplicateRes.status).toBe(409)

    const unsafeRes = await jsonFetch(`/api/v1/memory-stores/${store.metadata.uid}/memories`, authorization, {
      method: 'POST',
      body: JSON.stringify({ path: '../escape.md', content: 'Invalid' }),
    })
    expect(unsafeRes.status).toBe(400)

    const updateRes = await jsonFetch(
      `/api/v1/memory-stores/${store.metadata.uid}/memories/${memory.metadata.uid}`,
      authorization,
      {
        method: 'PATCH',
        body: JSON.stringify({ path: 'guides/updated.md', content: 'Updated content.' }),
      },
    )
    expect(updateRes.status).toBe(200)
    await expect(updateRes.json()).resolves.toMatchObject({
      spec: { path: 'guides/updated.md', content: 'Updated content.' },
    })

    const listRes = await jsonFetch(`/api/v1/memory-stores/${store.metadata.uid}/memories`, authorization)
    expect(listRes.status).toBe(200)
    await expect(listRes.json()).resolves.toMatchObject({
      data: [expect.objectContaining({ spec: expect.objectContaining({ path: 'guides/updated.md' }) })],
    })

    const archiveRes = await jsonFetch(`/api/v1/memory-stores/${store.metadata.uid}`, authorization, {
      method: 'PATCH',
      body: JSON.stringify({ archived: true }),
    })
    expect(archiveRes.status).toBe(200)
    await expect(archiveRes.json()).resolves.toMatchObject({ metadata: { archivedAt: expect.any(String) } })
  })
})
