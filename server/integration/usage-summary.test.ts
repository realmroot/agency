import { SELF } from 'cloudflare:test'
import { env } from 'cloudflare:workers'
import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { projects, usageRecords } from '../db/schema'
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

async function projectContext(authorization: string) {
  const res = await jsonFetch('/api/v1/projects', authorization)
  expect(res.status).toBe(200)
  const body = (await res.json()) as { data: Array<{ id: string }> }
  const projectId = body.data[0]?.id
  if (!projectId) throw new Error('expected a default project')
  const row = await drizzle(env.DB).select().from(projects).where(eq(projects.id, projectId)).get()
  if (!row) throw new Error('expected the project row')
  return { id: row.id, organizationId: row.organizationId }
}

function newId(prefix: string) {
  return `${prefix}_${crypto.randomUUID().replaceAll('-', '')}`
}

function usageRow(project: { id: string; organizationId: string }, values: Partial<typeof usageRecords.$inferInsert>) {
  return {
    id: newId('usage'),
    organizationId: project.organizationId,
    projectId: project.id,
    agentId: 'agent_alpha',
    agentVersionId: 'agentver_alpha',
    sessionId: 'session_alpha',
    sessionEventId: newId('event'),
    correlationId: newId('corr'),
    providerId: 'workers-ai',
    providerType: 'workers-ai',
    modelId: '@cf/model-a',
    state: 'success',
    promptTokens: 10,
    completionTokens: 5,
    totalTokens: 15,
    durationMs: 100,
    costMicros: 25,
    currency: 'USD',
    usageType: 'model',
    metadata: '{}',
    createdAt: '2026-05-01T00:00:00.000Z',
    ...values,
  }
}

describe('[CF] v1 usage summary', () => {
  beforeEach(async () => {
    await setupOidcProvider()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('aggregates usage deterministically with named totals [spec: usage/summary-api]', async () => {
    const authorization = await signIn()
    const project = await projectContext(authorization)
    const db = drizzle(env.DB)
    await db.insert(usageRecords).values([
      usageRow(project, {}),
      usageRow(project, {
        sessionId: 'session_beta',
        promptTokens: 2,
        completionTokens: 0,
        totalTokens: 2,
        durationMs: 50,
        costMicros: 0,
        createdAt: '2026-05-02T00:00:00.000Z',
      }),
      usageRow(project, {
        providerId: null,
        providerType: 'sandbox',
        modelId: 'bash',
        agentId: 'agent_beta',
        usageType: 'tool',
        totalTokens: 0,
        promptTokens: 0,
        completionTokens: 0,
        durationMs: 10,
        costMicros: 0,
        createdAt: '2026-05-03T00:00:00.000Z',
      }),
    ])

    const summaryRes = await jsonFetch('/api/v1/usage-summary?groupBy=provider', authorization)
    expect(summaryRes.status).toBe(200)
    const summary = (await summaryRes.json()) as {
      groupBy: string
      totals: Record<string, unknown>
      groups: Array<{ key: Record<string, string | null> }>
    }
    expect(summary.groupBy).toBe('provider')
    expect(summary.totals).toEqual({
      records: 3,
      promptTokens: 12,
      completionTokens: 5,
      totalTokens: 17,
      durationMs: 160,
      costMicros: 25,
      currency: 'USD',
    })
    expect(summary.groups).toEqual([
      expect.objectContaining({ key: { provider: 'sandbox' }, records: 1 }),
      expect.objectContaining({ key: { provider: 'workers-ai' }, records: 2, totalTokens: 17 }),
    ])
  })

  it('groups by model and agent and honors from/to filters [spec: usage/summary-api]', async () => {
    const authorization = await signIn()
    const project = await projectContext(authorization)
    const db = drizzle(env.DB)
    await db
      .insert(usageRecords)
      .values([
        usageRow(project, {}),
        usageRow(project, { modelId: '@cf/model-b', agentId: 'agent_beta', createdAt: '2026-05-02T00:00:00.000Z' }),
      ])

    const modelRes = await jsonFetch('/api/v1/usage-summary?groupBy=model', authorization)
    expect(modelRes.status).toBe(200)
    const modelSummary = (await modelRes.json()) as { groups: Array<{ key: Record<string, string | null> }> }
    expect(modelSummary.groups).toEqual([
      expect.objectContaining({ key: { model: '@cf/model-a' } }),
      expect.objectContaining({ key: { model: '@cf/model-b' } }),
    ])

    const agentRes = await jsonFetch(
      '/api/v1/usage-summary?groupBy=agent&from=2026-05-02T00%3A00%3A00.000Z&to=2026-05-31T23%3A59%3A59.999Z',
      authorization,
    )
    expect(agentRes.status).toBe(200)
    const agentSummary = (await agentRes.json()) as {
      totals: { records: number }
      groups: Array<{ key: Record<string, string | null> }>
    }
    expect(agentSummary.totals.records).toBe(1)
    expect(agentSummary.groups).toEqual([expect.objectContaining({ key: { agent: 'agent_beta' } })])
  })

  it('defaults to grouping by provider and rejects unknown groupBy values [spec: usage/summary-api]', async () => {
    const authorization = await signIn()

    const defaultRes = await jsonFetch('/api/v1/usage-summary', authorization)
    expect(defaultRes.status).toBe(200)
    await expect(defaultRes.json()).resolves.toMatchObject({ groupBy: 'provider', totals: { records: 0 } })

    const invalidRes = await jsonFetch('/api/v1/usage-summary?groupBy=session', authorization)
    expect(invalidRes.status).toBe(400)
    await expect(invalidRes.json()).resolves.toMatchObject({ error: { type: 'validation_error' } })
  })
})
