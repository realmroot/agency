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

async function createAuditedBudget(authorization: string, metadata?: Record<string, unknown>) {
  const res = await jsonFetch('/api/v1/budgets', authorization, {
    method: 'POST',
    body: JSON.stringify({
      scope: 'project',
      limitType: 'tokens',
      limitValue: 1000,
      window: 'month',
      ...(metadata ? { metadata } : {}),
    }),
  })
  expect(res.status).toBe(201)
  return (await res.json()) as { id: string }
}

describe('[CF] v1 audit records', () => {
  beforeEach(async () => {
    await setupOidcProvider()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('lists and filters audit records scoped to the organization [spec: audit/records-api] [spec: audit/auto-record]', async () => {
    const authorization = await signIn()
    const budget = await createAuditedBudget(authorization)

    const listRes = await jsonFetch('/api/v1/audit-records?action=budget.create', authorization)
    expect(listRes.status).toBe(200)
    const list = (await listRes.json()) as { data: Array<Record<string, unknown>> }
    expect(list.data).toContainEqual(
      expect.objectContaining({
        actorType: 'user',
        actorUserId: expect.stringMatching(/^user_e2e_/),
        controllerUserId: null,
        action: 'budget.create',
        resourceType: 'budget',
        resourceId: budget.id,
        outcome: 'success',
      }),
    )
    expect(JSON.stringify(list)).not.toContain('organizationId')

    const outcomeRes = await jsonFetch('/api/v1/audit-records?outcome=denied', authorization)
    expect(outcomeRes.status).toBe(200)
    const denied = (await outcomeRes.json()) as { data: Array<{ resourceId: string | null }> }
    expect(denied.data).not.toContainEqual(expect.objectContaining({ resourceId: budget.id }))
  })

  it('reads a single audit record and 404s unknown ids [spec: audit/records-api]', async () => {
    const authorization = await signIn()
    await createAuditedBudget(authorization, { apiKey: 'top-secret-credential' })

    const listRes = await jsonFetch('/api/v1/audit-records?action=budget.create', authorization)
    expect(listRes.status).toBe(200)
    const list = (await listRes.json()) as { data: Array<{ id: string }> }
    const recordId = list.data[0]?.id
    expect(recordId).toBeTruthy()

    const readRes = await jsonFetch(`/api/v1/audit-records/${recordId}`, authorization)
    expect(readRes.status).toBe(200)
    const record = (await readRes.json()) as { id: string; action: string }
    expect(record).toMatchObject({ id: recordId, action: 'budget.create' })
    expect(JSON.stringify(record)).toContain('top-secret-credential')

    const missingRes = await jsonFetch('/api/v1/audit-records/audit_does_not_exist', authorization)
    expect(missingRes.status).toBe(404)
  })

  it('exports audit records as CSV [spec: audit/export-api]', async () => {
    const authorization = await signIn()
    await createAuditedBudget(authorization, { apiKey: 'top-secret-credential' })

    const res = await jsonFetch('/api/v1/audit-records?action=budget.create', authorization, {
      headers: { accept: 'text/csv' },
    })
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/csv')
    expect(res.headers.get('content-disposition')).toContain('audit-records.csv')
    const body = await res.text()
    const lines = body.trimEnd().split('\n')
    expect(lines[0]).toBe(
      'id,createdAt,projectId,actorType,actorUserId,controllerUserId,action,resourceType,resourceId,outcome,requestId,correlationId,sessionId,policyCategory,metadata,before,after',
    )
    expect(lines.length).toBeGreaterThan(1)
    expect(body).toContain('top-secret-credential')
  })
})
