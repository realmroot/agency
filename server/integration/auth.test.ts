import { SELF } from 'cloudflare:test'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { dpopHeaders, expectAuthRequired, setupOidcProvider, signIn, signInRunner, signInUser } from './auth'

async function jsonFetch(path: string, authorization?: string, init?: { method?: string; body?: unknown }) {
  const method = init?.method ?? (init?.body !== undefined ? 'POST' : 'GET')
  return SELF.fetch(`https://example.com${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(authorization ? dpopHeaders(authorization, method, path) : {}),
    },
    ...(init?.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
  })
}

describe('[CF] auth v1', () => {
  beforeEach(async () => {
    await setupOidcProvider()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('exposes the OIDC discovery config publicly [spec: auth/sso-discovery]', async () => {
    const res = await SELF.fetch('https://example.com/api/v1/auth/config')
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({
      methods: [{ type: 'oidc', issuer: 'https://identity.alias.test/api/auth', clientId: 'ama-test' }],
    })
  })

  it('publishes RFC 9728 Realmroot resource metadata with the exact AMA scope catalog [spec: api-contracts/resource-discovery]', async () => {
    const res = await SELF.fetch('https://hostile.example/.well-known/oauth-protected-resource/api')
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({
      resource: 'https://ama.tftt.cc/api',
      authorization_servers: ['https://identity.alias.test/api/auth'],
      scopes_supported: [
        'agents:read',
        'agents:write',
        'audit-records:read',
        'audit-records:write',
        'auth:read',
        'auth:write',
        'budgets:read',
        'budgets:write',
        'connectors:read',
        'connectors:write',
        'environments:read',
        'environments:write',
        'leases:read',
        'leases:write',
        'memory-stores:read',
        'memory-stores:write',
        'projects:read',
        'projects:write',
        'providers:read',
        'providers:write',
        'runners:read',
        'runners:write',
        'sessions:read',
        'sessions:write',
        'triggers:read',
        'triggers:write',
        'usage-records:read',
        'usage-records:write',
        'usage-summary:read',
        'usage-summary:write',
        'vaults:read',
        'vaults:write',
        'work-items:read',
        'work-items:write',
      ],
      bearer_methods_supported: ['header'],
      resource_name: 'Any Managed Agents API',
      dpop_signing_alg_values_supported: ['ES256'],
      dpop_bound_access_tokens_required: false,
      realmroot_client_authentication: {
        console: 'bearer',
        runner: 'bearer',
        agent: 'dpop',
      },
    })
  })

  it('links the AMA resource root to the canonical OpenAPI service description', async () => {
    const res = await SELF.fetch('https://alias.example/api')
    expect(res.status).toBe(200)
    expect(res.headers.get('link')).toBe(
      '<https://ama.tftt.cc/api/v1/openapi.json>; rel="service-desc"; type="application/openapi+json"',
    )
    await expect(res.json()).resolves.toMatchObject({ resource: 'https://ama.tftt.cc/api' })
  })

  it('exposes public browser config through configz', async () => {
    const res = await SELF.fetch('https://example.com/api/v1/configz')
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({
      version: 1,
      service: {
        name: 'Any Managed Agents',
        origin: 'https://example.com',
      },
      auth: {
        oidc: {
          issuer: 'https://identity.alias.test/api/auth',
          resource: 'https://ama.tftt.cc/api',
          browser: {
            clientId: 'ama-test',
            scopes: ['openid', 'profile', 'email', 'offline_access'],
          },
          runner: {
            clientId: 'ama-runner-test',
            scopes: ['openid', 'profile', 'email', 'offline_access'],
          },
        },
      },
    })
  })

  it('accepts an organization hint on the discovery config', async () => {
    const res = await SELF.fetch('https://example.com/api/v1/auth/config?organization=example-org')
    expect(res.status).toBe(200)
    const body = (await res.json()) as { methods: unknown[] }
    expect(body.methods).toHaveLength(1)
  })

  it('reads the current session context from a Console Bearer credential [spec: auth/session-current] [spec: auth/credential-mode]', async () => {
    const authorization = await signIn()
    const res = await jsonFetch('/api/v1/auth/sessions/current', authorization)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { user: { id: string }; project: Record<string, unknown> }
    expect(body).toMatchObject({
      user: { id: expect.stringMatching(/^user_e2e_/) },
      organization: { id: expect.stringMatching(/^org_e2e_/) },
      project: { name: 'Default project' },
    })
    expect(body.project).not.toHaveProperty('organizationId')
  })

  it('requires authentication for the current session context [spec: auth/guard]', async () => {
    const res = await jsonFetch('/api/v1/auth/sessions/current')
    expect(res.status).toBe(401)
    expectAuthRequired(await res.json())
  })

  it('rejects a Console token presented as DPoP [spec: auth/credential-mode]', async () => {
    const authorization = (await signIn()).replace(/^Bearer /, 'DPoP ')
    const res = await SELF.fetch('https://example.com/api/v1/auth/sessions/current', {
      headers: {
        ...dpopHeaders(authorization, 'GET', '/api/v1/auth/sessions/current'),
      },
    })
    expect(res.status).toBe(401)
    expect(res.headers.get('www-authenticate')).toMatch(/^DPoP /)
    expectAuthRequired(await res.json())
  })

  it('accepts a runner token with Bearer on a runner resource [spec: auth/credential-mode]', async () => {
    const authorization = await signInRunner()
    const res = await jsonFetch('/api/v1/runners', authorization)
    expect(res.status).toBe(200)
  })

  it('rejects a runner token presented as DPoP [spec: auth/credential-mode]', async () => {
    const authorization = (await signInRunner()).replace(/^Bearer /, 'DPoP ')
    const res = await SELF.fetch('https://example.com/api/v1/auth/sessions/current', {
      headers: dpopHeaders(authorization, 'GET', '/api/v1/auth/sessions/current'),
    })
    expect(res.status).toBe(401)
    expect(res.headers.get('www-authenticate')).toMatch(/^DPoP /)
    expectAuthRequired(await res.json())
  })

  it('advertises both credential schemes when authentication is missing', async () => {
    const res = await jsonFetch('/api/v1/auth/sessions/current')
    expect(res.headers.get('www-authenticate')).toBe('Bearer, DPoP algs="ES256"')
  })
})

describe('[CF] projects v1', () => {
  beforeEach(async () => {
    await setupOidcProvider()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('requires authentication', async () => {
    const res = await jsonFetch('/api/v1/projects')
    expect(res.status).toBe(401)
    expectAuthRequired(await res.json())
  })

  it('lists the auto-created default project without exposing organizationId [spec: auth/delegated-bootstrap]', async () => {
    const authorization = await signIn()
    const res = await jsonFetch('/api/v1/projects', authorization)
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      data: Array<Record<string, unknown>>
      pagination: Record<string, unknown>
    }
    expect(body.data).toHaveLength(1)
    expect(body.data[0]).toMatchObject({
      id: expect.stringMatching(/^project_/),
      name: 'Default project',
      createdAt: expect.any(String),
      updatedAt: expect.any(String),
    })
    expect(body.data[0]).not.toHaveProperty('organizationId')
    expect(body.pagination).toEqual({ limit: 50, nextCursor: null, hasMore: false })
  })

  it('creates and reads a project', async () => {
    const authorization = await signIn()
    const createRes = await jsonFetch('/api/v1/projects', authorization, {
      body: { name: 'Control Plane' },
    })
    expect(createRes.status).toBe(201)
    const project = (await createRes.json()) as Record<string, unknown> & { id: string }
    expect(project).toMatchObject({ id: expect.stringMatching(/^project_/), name: 'Control Plane' })
    expect(project).not.toHaveProperty('organizationId')

    const readRes = await jsonFetch(`/api/v1/projects/${project.id}`, authorization)
    expect(readRes.status).toBe(200)
    await expect(readRes.json()).resolves.toMatchObject({ id: project.id, name: 'Control Plane' })
  })

  it('returns 404 for unknown projects', async () => {
    const authorization = await signIn()
    const res = await jsonFetch('/api/v1/projects/project_missing', authorization)
    expect(res.status).toBe(404)
    await expect(res.json()).resolves.toMatchObject({
      error: { type: 'not_found', message: 'Project not found' },
    })
  })

  it('does not read projects across organizations [spec: auth/tenancy]', async () => {
    const tenantA = await signInUser('proj_tenant_a')
    const createRes = await jsonFetch('/api/v1/projects', tenantA, { body: { name: 'Tenant A project' } })
    const project = (await createRes.json()) as { id: string }

    const tenantB = await signInUser('proj_tenant_b')
    const res = await jsonFetch(`/api/v1/projects/${project.id}`, tenantB)
    expect(res.status).toBe(404)
  })

  it('paginates the project list with cursors', async () => {
    const authorization = await signInUser('proj_paging')
    for (const name of ['Project One', 'Project Two', 'Project Three']) {
      const res = await jsonFetch('/api/v1/projects', authorization, { body: { name } })
      expect(res.status).toBe(201)
    }

    const firstPageRes = await jsonFetch('/api/v1/projects?limit=2', authorization)
    expect(firstPageRes.status).toBe(200)
    const firstPage = (await firstPageRes.json()) as {
      data: Array<{ id: string }>
      pagination: { limit: number; hasMore: boolean; nextCursor: string | null }
    }
    expect(firstPage.data).toHaveLength(2)
    expect(firstPage.pagination.hasMore).toBe(true)
    expect(firstPage.pagination.nextCursor).toEqual(expect.any(String))

    const secondPageRes = await jsonFetch(
      `/api/v1/projects?limit=2&cursor=${encodeURIComponent(firstPage.pagination.nextCursor as string)}`,
      authorization,
    )
    expect(secondPageRes.status).toBe(200)
    const secondPage = (await secondPageRes.json()) as {
      data: Array<{ id: string }>
      pagination: { hasMore: boolean }
    }
    expect(secondPage.data.length).toBeGreaterThan(0)
    const firstPageIds = new Set(firstPage.data.map((row) => row.id))
    for (const row of secondPage.data) {
      expect(firstPageIds.has(row.id)).toBe(false)
    }
  })

  it('rejects invalid list cursors', async () => {
    const authorization = await signIn()
    const res = await jsonFetch('/api/v1/projects?cursor=not-a-cursor', authorization)
    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toMatchObject({
      error: { type: 'validation_error', message: 'Invalid list cursor' },
    })
  })
})
