import { Hono } from 'hono'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Env } from '../env'

const { getDpopClaimsMock, upsertProjectForClaimsMock } = vi.hoisted(() => ({
  getDpopClaimsMock: vi.fn(),
  upsertProjectForClaimsMock: vi.fn(),
}))

vi.mock('./oidc', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./oidc')>()),
  getDpopClaims: getDpopClaimsMock,
  upsertProjectForClaims: upsertProjectForClaimsMock,
}))

import { DpopError } from './dpop'
import { OidcError } from './oidc'
import { requireAuth, requireAuthIdentity, requireSessionEventsAuth } from './session'

const app = new Hono<{ Bindings: Env }>()

app.get('/api/v1/agents/:id', async (c) => {
  const auth = await requireAuth(c)
  return auth instanceof Response ? auth : c.json({ authorized: true })
})
app.post('/api/v1/agents/:id', async (c) => {
  const auth = await requireAuth(c)
  return auth instanceof Response ? auth : c.json({ authorized: true })
})
app.get('/api/v1/projects/:id', async (c) => {
  const auth = await requireAuthIdentity(c)
  return auth instanceof Response ? auth : c.json({ authorized: true })
})
app.post('/api/v1/sessions/:id/events', async (c) => {
  const auth = await requireSessionEventsAuth(c)
  return auth instanceof Response ? auth : c.json({ authorized: true })
})
app.get('/api/v1/work-items/:id', async (c) => {
  const auth = await requireAuth(c)
  return auth instanceof Response ? auth : c.json({ authorized: true })
})

const baseClaims = {
  sub: 'user_1',
  email: 'user@example.com',
  org_id: 'org_1',
  org_name: 'Org',
  roles: [],
  teams: [],
}

async function request(path: string, values: { method?: string; permissions?: string[]; runner?: boolean } = {}) {
  getDpopClaimsMock.mockResolvedValue({
    ...baseClaims,
    permissions: values.permissions ?? [],
    ...(values.runner ? { client_id: 'runner-client' } : {}),
  })
  return await app.request(
    `https://ama.example.com${path}`,
    { method: values.method ?? 'GET', headers: { authorization: 'DPoP token', dpop: 'proof' } },
    {
      DB: {} as D1Database,
      OIDC_RESOURCE: 'https://ama.example.com',
      OIDC_RUNNER_CLIENT_ID: 'runner-client',
    } as Env,
  )
}

describe('[spec: auth/oidc-claims] resource permission auth wall', () => {
  beforeEach(() => {
    getDpopClaimsMock.mockReset()
    upsertProjectForClaimsMock.mockReset()
    upsertProjectForClaimsMock.mockResolvedValue({ id: 'project_1', name: 'Project', organizationId: 'org_1' })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it.each([
    ['invalid access token', new OidcError('OIDC access token is invalid'), 'invalid_token'],
    ['invalid DPoP proof', new DpopError('invalid_dpop_proof', 'The DPoP proof is invalid'), 'invalid_dpop_proof'],
  ])('logs a redacted structured rejection for %s', async (_case, error, rejectionKind) => {
    const accessToken = 'access-token-must-not-be-logged'
    const proof = 'proof-must-not-be-logged'
    getDpopClaimsMock.mockRejectedValue(error)
    const logSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const response = await app.request(
      'https://ama.example.com/api/v1/agents/agent_1?authorization=query-secret',
      {
        headers: {
          authorization: `DPoP ${accessToken}`,
          dpop: proof,
          'cf-ray': 'ray_123',
        },
      },
      {
        DB: {} as D1Database,
        OIDC_RESOURCE: 'https://ama.example.com',
        OIDC_RUNNER_CLIENT_ID: 'runner-client',
      } as Env,
    )

    expect(response.status).toBe(401)
    expect(logSpy).toHaveBeenCalledOnce()
    const serialized = String(logSpy.mock.calls[0]?.[0])
    const payload = JSON.parse(serialized) as Record<string, unknown>
    expect(payload).toMatchObject({
      level: 'error',
      event: 'auth.dpop.rejected',
      method: 'GET',
      path: '/api/v1/agents/agent_1',
      cfRay: 'ray_123',
      rejectionKind,
      error: {
        name: error.name,
        message: error.message,
      },
    })
    expect(payload).not.toHaveProperty('authorization')
    expect(payload).not.toHaveProperty('token')
    expect(payload).not.toHaveProperty('proof')
    expect(serialized).not.toContain(accessToken)
    expect(serialized).not.toContain(proof)
    expect(serialized).not.toContain('query-secret')
  })

  it.each([
    [[], 'agents:read'],
    [['projects:read'], 'agents:read'],
    [['agents:write'], 'agents:read'],
  ])('rejects GET with permissions %j', async (permissions, requiredPermission) => {
    const response = await request('/api/v1/agents/agent_1', { permissions })
    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toMatchObject({
      error: { type: 'forbidden', details: { requiredPermission } },
    })
  })

  it.each([['agents:read']])('allows GET with exact scope %s', async (...permissions) => {
    expect((await request('/api/v1/agents/agent_1', { permissions })).status).toBe(200)
  })

  it.each([['*'], ['agents:*']])('rejects wildcard scope %s', async (...permissions) => {
    expect((await request('/api/v1/agents/agent_1', { permissions })).status).toBe(403)
  })

  it('rejects before creating or resolving a Default project', async () => {
    const response = await request('/api/v1/agents/agent_1', { permissions: [] })

    expect(response.status).toBe(403)
    expect(upsertProjectForClaimsMock).not.toHaveBeenCalled()
  })

  it('maps non-read methods to write and rejects read-only authority', async () => {
    const denied = await request('/api/v1/agents/agent_1', { method: 'POST', permissions: ['agents:read'] })
    expect(denied.status).toBe(403)
    await expect(denied.json()).resolves.toMatchObject({
      error: { details: { requiredPermission: 'agents:write' } },
    })
    expect((await request('/api/v1/agents/agent_1', { method: 'POST', permissions: ['agents:write'] })).status).toBe(
      200,
    )
  })

  it('enforces the same resource wall for requireAuthIdentity', async () => {
    expect((await request('/api/v1/projects/project_1')).status).toBe(403)
    expect((await request('/api/v1/projects/project_1', { permissions: ['projects:read'] })).status).toBe(200)
  })

  it('requires sessions:write for console session event ingestion', async () => {
    expect((await request('/api/v1/sessions/session_1/events', { method: 'POST' })).status).toBe(403)
    expect(
      (
        await request('/api/v1/sessions/session_1/events', {
          method: 'POST',
          permissions: ['sessions:write'],
        })
      ).status,
    ).toBe(200)
  })

  it('requires exact scopes before applying runner-path binding authorization', async () => {
    expect((await request('/api/v1/work-items/work_1', { runner: true })).status).toBe(403)
    expect(
      (await request('/api/v1/work-items/work_1', { runner: true, permissions: ['work-items:read'] })).status,
    ).toBe(200)
    expect((await request('/api/v1/sessions/session_1/events', { method: 'POST', runner: true })).status).toBe(403)
    expect(
      (
        await request('/api/v1/sessions/session_1/events', {
          method: 'POST',
          runner: true,
          permissions: ['sessions:write'],
        })
      ).status,
    ).toBe(200)
    expect((await request('/api/v1/agents/agent_1', { runner: true })).status).toBe(403)
  })
})
