import { SELF } from 'cloudflare:test'
import { env } from 'cloudflare:workers'
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
      metadata: { name: 'Team memory', description: 'Review conventions' },
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

    const deleteMemoryRes = await jsonFetch(
      `/api/v1/memory-stores/${store.metadata.uid}/memories/${memory.metadata.uid}`,
      authorization,
      { method: 'DELETE' },
    )
    expect(deleteMemoryRes.status).toBe(204)
    expect(
      (await jsonFetch(`/api/v1/memory-stores/${store.metadata.uid}/memories/${memory.metadata.uid}`, authorization))
        .status,
    ).toBe(404)
    expect(
      (
        await jsonFetch(`/api/v1/memory-stores/${store.metadata.uid}/memories/${memory.metadata.uid}`, authorization, {
          method: 'PATCH',
          body: JSON.stringify({ content: 'Cannot revive a deleted memory.' }),
        })
      ).status,
    ).toBe(404)

    const retainedMemoryRes = await jsonFetch(`/api/v1/memory-stores/${store.metadata.uid}/memories`, authorization, {
      method: 'POST',
      body: JSON.stringify({ path: 'guides/retained.md', content: 'Retain this tombstone.' }),
    })
    expect(retainedMemoryRes.status).toBe(201)
    const retainedMemory = (await retainedMemoryRes.json()) as { metadata: { uid: string } }

    const deleteStoreRes = await jsonFetch(`/api/v1/memory-stores/${store.metadata.uid}`, authorization, {
      method: 'DELETE',
    })
    expect(deleteStoreRes.status).toBe(204)
    expect((await jsonFetch(`/api/v1/memory-stores/${store.metadata.uid}`, authorization)).status).toBe(404)
    expect(
      (
        await jsonFetch(`/api/v1/memory-stores/${store.metadata.uid}`, authorization, {
          method: 'PATCH',
          body: JSON.stringify({ metadata: { name: 'Cannot revive a deleted store' } }),
        })
      ).status,
    ).toBe(404)
    await expect(
      env.DB.prepare('SELECT deleted_at FROM memory_stores WHERE id = ?').bind(store.metadata.uid).first(),
    ).resolves.toEqual({ deleted_at: expect.any(String) })
    await expect(
      env.DB.prepare('SELECT id, deleted_at FROM memory_store_memories WHERE id = ?')
        .bind(retainedMemory.metadata.uid)
        .first(),
    ).resolves.toEqual({ id: retainedMemory.metadata.uid, deleted_at: expect.any(String) })
    expect(
      (
        await jsonFetch(`/api/v1/memory-stores/${store.metadata.uid}/memories`, authorization, {
          method: 'POST',
          body: JSON.stringify({ path: 'cannot-revive.md', content: 'Rejected.' }),
        })
      ).status,
    ).toBe(404)

    const project = await env.DB.prepare('SELECT project_id FROM memory_stores WHERE id = ?')
      .bind(store.metadata.uid)
      .first<{ project_id: string }>()
    await env.DB.prepare('UPDATE projects SET deleted_at = ? WHERE id = ?')
      .bind(new Date().toISOString(), project!.project_id)
      .run()
    const deletedProjectStoreRes = await jsonFetch('/api/v1/memory-stores', authorization, {
      method: 'POST',
      body: JSON.stringify({ metadata: { name: 'Cannot attach to deleted project' }, spec: {} }),
    })
    expect(deletedProjectStoreRes.status).toBe(409)
  })
})
