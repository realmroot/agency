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
  it('rejects a Realmroot identity whose runtime differs from the initialized Agent runtime', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const request = new Request(input)
        if (request.url.endsWith('/.well-known/agent-configuration')) return Response.json(configuration)
        if (request.url.endsWith('/api/agents')) {
          return Response.json(
            {
              id: 'identity-mismatch',
              issuer: configuration.issuer,
              subject: 'agt_mismatch',
              username: 'mismatch',
              name: 'Mismatch',
              runtime: 'ama',
              homeSpace: { type: 'organization', organizationId: 'organization-1' },
              status: 'active',
              createdAt: '2026-08-23T00:00:00.000Z',
              updatedAt: '2026-08-23T00:00:00.000Z',
            },
            { status: 201 },
          )
        }
        return new Response('unexpected request', { status: 500 })
      }),
    )

    const gateway = createRealmrootEnrollmentGateway()
    const initialized = await gateway.initialize({
      origin,
      nickname: 'Mismatch',
      runtime: 'codex',
      idempotencyKey: 'ama:project-1:mismatch',
    })
    await expect(
      gateway.prepare({
        origin,
        username: 'mismatch',
        nickname: 'Mismatch',
        organizationId: 'organization-1',
        idempotencyKey: 'ama:project-1:mismatch',
        checkpoint: initialized,
        managementCredential: {
          async headers() {
            return { authorization: 'Bearer management' }
          },
        },
        async onCheckpoint() {},
      }),
    ).rejects.toThrow('Realmroot Agent identity response is incomplete')
  })

  it('replays POST /api/agents with the same public installation after a failed checkpoint', async () => {
    const creations: Array<{ headers: Headers; body: Record<string, unknown> }> = []
    const identity = {
      id: 'identity-1',
      issuer: configuration.issuer,
      subject: 'agt_backend_worker',
      username: 'backend-worker',
      name: 'Backend Worker',
      runtime: 'codex',
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
      runtime: 'codex',
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
      runtime: 'codex',
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
      runtime: 'ama',
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
    await expect(
      gateway.complete({
        origin,
        username: 'build-agent',
        nickname: 'Build Agent',
        organizationId: 'organization-1',
        idempotencyKey: 'ama:project-1:agent-1',
        checkpoint: {
          ...enrolled,
          identity: { ...enrolled.identity!, subject: 'agt_tampered_checkpoint' },
        },
        async onCheckpoint() {},
      }),
    ).rejects.toThrow('checkpoint does not match its authenticated identity')
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
    expect(paths.filter((path) => path === '/api/agent/token')).toHaveLength(3)
    expect(paths.filter((path) => path === '/api/agent')).toHaveLength(3)
    expect(paths).not.toContain('/api/agent/register')
    expect(paths).not.toContain('/api/agent/enrollments')
    expect(paths.some((path) => path.includes('decision'))).toBe(false)
  })
})
