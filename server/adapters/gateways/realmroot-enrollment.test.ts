import { parseRealmrootAgentState } from '@server/domain/vault'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createRealmrootEnrollmentGateway } from './realmroot-enrollment'

const origin = 'https://realmroot.example'
const configuration = {
  version: '1.0-draft',
  issuer: `${origin}/api/auth`,
  algorithms: ['Ed25519'],
  agent_identity_issuer: `${origin}/api/auth`,
  agent_enrollment_endpoint: `${origin}/api/agent/enrollments`,
  agent_endpoint: `${origin}/api/agent`,
  agent_token_endpoint: `${origin}/api/agent/token`,
  agent_bootstrap_scopes_supported: ['agent:read'],
  endpoints: { register: `${origin}/api/agent/register`, status: `${origin}/api/agent/status` },
}

afterEach(() => vi.unstubAllGlobals())

describe('Realmroot managed Agent creation', () => {
  it('replays POST /api/agents with the same public installation after a failed checkpoint', async () => {
    const creations: Array<{ headers: Headers; body: Record<string, unknown> }> = []
    const identity = {
      id: 'identity-1',
      issuer: configuration.issuer,
      subject: 'agt_backend_worker',
      username: 'backend-worker',
      name: 'Backend Worker',
      runtime: 'ama',
      homeSpace: { type: 'organization', organizationId: 'organization-1' },
      status: 'active',
      createdAt: '2026-08-23T00:00:00.000Z',
      updatedAt: '2026-08-23T00:00:00.000Z',
    }
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const request = new Request(input, init)
        if (request.url.endsWith('/.well-known/agent-configuration')) return Response.json(configuration)
        if (request.url.endsWith('/api/agents')) {
          creations.push({ headers: new Headers(request.headers), body: await request.json() })
          return Response.json(identity, { status: 201 })
        }
        if (request.url.endsWith('/api/agent/token')) {
          return Response.json({ access_token: 'access-token', token_type: 'DPoP', expires_in: 300 })
        }
        if (request.url.endsWith('/api/agent')) {
          return Response.json({
            enrollment: { state: 'enrolled', pending: null },
            agent: identity,
            installation: { id: 'installation-1', status: 'active' },
          })
        }
        return new Response('unexpected request', { status: 500 })
      }),
    )

    const gateway = createRealmrootEnrollmentGateway()
    const initialized = await gateway.initialize({
      origin,
      nickname: 'Backend Worker',
      idempotencyKey: 'ama:project-1:agent-1',
    })
    const common = {
      origin,
      username: 'backend-worker',
      nickname: 'Backend Worker',
      organizationId: 'organization-1',
      idempotencyKey: 'ama:project-1:agent-1',
      checkpoint: initialized,
      managementCredential: {
        async headers() {
          return { authorization: 'Bearer management' }
        },
      },
    }
    await expect(
      gateway.prepare({
        ...common,
        async onCheckpoint() {
          throw new Error('D1 checkpoint unavailable')
        },
      }),
    ).rejects.toThrow('D1 checkpoint unavailable')

    const enrolled = await gateway.prepare({
      ...common,
      async onCheckpoint() {},
    })

    expect(enrolled).toMatchObject({
      stage: 'enrolled',
      identity: { id: 'identity-1', issuer: configuration.issuer, subject: 'agt_backend_worker' },
    })
    expect(creations).toHaveLength(2)
    expect(creations.map((request) => request.headers.get('idempotency-key'))).toEqual([
      'ama:project-1:agent-1',
      'ama:project-1:agent-1',
    ])
    expect(creations[0]!.body).toEqual(creations[1]!.body)
    expect(creations[0]!.body).toMatchObject({
      username: 'backend-worker',
      name: 'Backend Worker',
      runtime: 'ama',
      installation: {
        agentId: expect.any(String),
        hostId: expect.any(String),
        kid: expect.any(String),
        publicKey: { kty: 'OKP', crv: 'Ed25519', x: expect.any(String) },
      },
    })
    expect(creations[0]!.body).not.toHaveProperty('organizationId')
  })

  it('creates the stable identity without registration, decision, or self-enrollment calls', async () => {
    const paths: string[] = []
    const identity = {
      id: 'identity-1',
      issuer: configuration.issuer,
      subject: 'agt_build_agent',
      username: 'build-agent',
      name: 'Build Agent',
      runtime: 'ama',
      homeSpace: { type: 'organization', organizationId: 'organization-1' },
      status: 'active',
      createdAt: '2026-08-23T00:00:00.000Z',
      updatedAt: '2026-08-23T00:00:00.000Z',
    }
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const request = new Request(input, init)
        paths.push(new URL(request.url).pathname)
        if (request.url.endsWith('/.well-known/agent-configuration')) return Response.json(configuration)
        if (request.url.endsWith('/api/agents')) return Response.json(identity, { status: 201 })
        if (request.url.endsWith('/api/agent/token')) {
          return Response.json({ access_token: 'access-token', token_type: 'DPoP', expires_in: 300 })
        }
        if (request.url.endsWith('/api/agent')) {
          return Response.json({
            enrollment: { state: 'enrolled', pending: null },
            agent: identity,
            installation: { id: 'installation-1', status: 'active' },
          })
        }
        return new Response('unexpected request', { status: 500 })
      }),
    )

    const gateway = createRealmrootEnrollmentGateway()
    const initialized = await gateway.initialize({
      origin,
      nickname: 'Build Agent',
      idempotencyKey: 'ama:project-1:agent-1',
    })
    const enrolled = await gateway.prepare({
      origin,
      username: 'build-agent',
      nickname: 'Build Agent',
      organizationId: 'organization-1',
      idempotencyKey: 'ama:project-1:agent-1',
      checkpoint: initialized,
      managementCredential: {
        async headers() {
          return { authorization: 'Bearer management' }
        },
      },
      async onCheckpoint() {},
    })
    const completed = await gateway.complete({
      origin,
      username: 'build-agent',
      nickname: 'Build Agent',
      organizationId: 'organization-1',
      idempotencyKey: 'ama:project-1:agent-1',
      checkpoint: enrolled,
      async onCheckpoint() {},
    })
    expect(completed).toMatchObject({
      identity: { id: 'identity-1', subject: 'agt_build_agent' },
    })
    expect(completed.state.identity).toEqual({
      id: 'identity-1',
      issuer: configuration.issuer,
      subject: 'agt_build_agent',
      username: 'build-agent',
      name: 'Build Agent',
      runtime: 'ama',
    })
    const protocolCredential = completed.state.protocol_credential as { private_key: string }
    expect(protocolCredential.private_key).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(protocolCredential.private_key).not.toContain('{')
    expect(() => parseRealmrootAgentState(JSON.stringify(completed.state))).not.toThrow()

    expect(paths).toContain('/api/agents')
    expect(paths).not.toContain('/api/agent/register')
    expect(paths).not.toContain('/api/agent/enrollments')
    expect(paths.some((path) => path.includes('decision'))).toBe(false)
  })
})

describe('Realmroot identity retirement', () => {
  const retirement = {
    issuer: configuration.issuer,
    identityId: 'identity/one',
    managementCredential: {
      async headers() {
        return { authorization: 'Bearer management' }
      },
    },
  }

  it('accepts the Realmroot 204 no-content retirement contract', async () => {
    const fetch = vi.fn(async () => new Response(null, { status: 204 }))
    vi.stubGlobal('fetch', fetch)

    await expect(createRealmrootEnrollmentGateway().retire(retirement)).resolves.toBeUndefined()
    expect(fetch).toHaveBeenCalledWith(
      `${origin}/api/agents/identity%2Fone`,
      expect.objectContaining({
        method: 'DELETE',
        headers: expect.objectContaining({ authorization: 'Bearer management' }),
      }),
    )
  })

  it('preserves Realmroot error details for unsuccessful retirement', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json({ type: 'forbidden', detail: 'organization authority required' }, { status: 403 }),
      ),
    )

    await expect(createRealmrootEnrollmentGateway().retire(retirement)).rejects.toThrow(
      'Realmroot /api/agents/identity%2Fone returned 403: {"type":"forbidden","detail":"organization authority required"}',
    )
  })

  it('rejects a successful response that is not the 204 no-content contract', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({ retired: true }, { status: 200 })),
    )

    await expect(createRealmrootEnrollmentGateway().retire(retirement)).rejects.toThrow(
      'returned unexpected success status 200; expected 204',
    )
  })

  it('rejects a malformed 204 response carrying a body', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          ({
            ok: true,
            status: 204,
            async text() {
              return '{}'
            },
          }) as Response,
      ),
    )

    await expect(createRealmrootEnrollmentGateway().retire(retirement)).rejects.toThrow(
      'returned a body for a 204 response',
    )
  })
})
