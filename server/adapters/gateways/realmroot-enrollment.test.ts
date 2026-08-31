import { decodeJwt, decodeProtectedHeader } from 'jose'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createRealmrootEnrollmentGateway } from './realmroot-enrollment'

const origin = 'https://realmroot.example'
const configuration = {
  version: '1.0-draft',
  issuer: `${origin}/api/auth`,
  algorithms: ['Ed25519'],
  agent_identity_issuer: `${origin}/api/auth`,
  agent_endpoint: `${origin}/api/agent`,
  agent_token_endpoint: `${origin}/api/agent-token`,
}
const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const remoteAgentId = '019ff41a-7da6-708f-8b05-49a4cc6d5300'

afterEach(() => vi.unstubAllGlobals())

describe('[spec: identities/provision] Realmroot enrollment boundary', () => {
  it('[spec: identities/installation-identifiers] initializes persistent installation identifiers as UUIDv7', async () => {
    const checkpoint = await createRealmrootEnrollmentGateway().initialize({
      origin,
      name: 'Reviewer',
      username: 'reviewer',
      runtime: 'codex',
      idempotencyKey: 'idem-uuidv7',
    })

    expect(checkpoint.state).toMatchObject({
      agent_id: expect.stringMatching(UUID_V7),
      host_id: expect.stringMatching(UUID_V7),
      agent_key_id: expect.stringMatching(UUID_V7),
    })
  })

  it('[spec: identities/installation-identifiers] resumes an enrolled checkpoint with legacy opaque identifiers', async () => {
    const gateway = createRealmrootEnrollmentGateway()
    const initialized = await gateway.initialize({
      origin,
      name: 'Reviewer',
      username: 'reviewer',
      runtime: 'codex',
      idempotencyKey: 'idem-legacy',
    })
    const checkpoint = {
      ...initialized,
      stage: 'enrolled',
      state: {
        ...initialized.state,
        agent_id: 'agent-legacy-installation',
        host_id: 'host-legacy-installation',
        agent_key_id: 'agent-legacy-key',
      },
      remote: {
        agentId: 'legacy-agent-id',
        issuer: configuration.issuer,
        subject: 'legacy-agent-subject',
        username: 'reviewer',
        runtime: 'codex',
      },
    } as const

    await expect(
      gateway.provision({
        origin,
        name: 'Reviewer',
        username: 'reviewer',
        runtime: 'codex',
        idempotencyKey: 'idem-legacy',
        checkpoint,
        managementCredential: { headers: async () => ({}) },
        onCheckpoint: async () => {
          throw new Error('resume must not checkpoint again')
        },
      }),
    ).resolves.toEqual({ checkpoint, descriptor: checkpoint.remote })
  })

  it('[spec: identities/installation-identifiers] enrolls an initialized checkpoint with legacy opaque identifiers', async () => {
    const legacyAgentId = 'agent-legacy-installation'
    const legacyHostId = 'host-legacy-installation'
    const legacyKeyId = 'agent-legacy-key'
    const requests: Array<{ url: string; init: RequestInit | undefined }> = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (request: string | URL | Request, init?: RequestInit) => {
        const url = request.toString()
        requests.push({ url, init })
        if (url.endsWith('/.well-known/agent-configuration')) return Response.json(configuration)
        if (url === `${origin}/api/agents`) {
          return Response.json({
            id: remoteAgentId,
            issuer: configuration.issuer,
            subject: remoteAgentId,
            username: 'reviewer',
            runtime: 'codex',
            status: 'active',
          })
        }
        if (url === configuration.agent_token_endpoint) {
          return Response.json({ access_token: 'legacy-agent-access-token', token_type: 'DPoP' })
        }
        if (url === configuration.agent_endpoint) {
          return Response.json({
            agent: {
              id: remoteAgentId,
              issuer: configuration.issuer,
              subject: remoteAgentId,
              username: 'reviewer',
              runtime: 'codex',
              status: 'active',
            },
          })
        }
        throw new Error(`Unexpected request: ${url}`)
      }),
    )
    const gateway = createRealmrootEnrollmentGateway()
    const initialized = await gateway.initialize({
      origin,
      name: 'Reviewer',
      username: 'reviewer',
      runtime: 'codex',
      idempotencyKey: 'idem-legacy-initialized',
    })
    const checkpoint = {
      ...initialized,
      state: {
        ...initialized.state,
        agent_id: legacyAgentId,
        host_id: legacyHostId,
        agent_key_id: legacyKeyId,
      },
    }

    const result = await gateway.provision({
      origin,
      name: 'Reviewer',
      username: 'reviewer',
      runtime: 'codex',
      idempotencyKey: 'idem-legacy-initialized',
      checkpoint,
      managementCredential: { headers: async () => ({ authorization: 'Bearer management' }) },
      onCheckpoint: async () => {},
    })

    expect(result).toMatchObject({
      checkpoint: { stage: 'enrolled' },
      descriptor: { agentId: remoteAgentId, subject: remoteAgentId },
    })
    const createRequest = requests.find(({ url }) => url === `${origin}/api/agents`)
    expect(JSON.parse(String(createRequest?.init?.body))).toMatchObject({
      installation: {
        agentId: legacyAgentId,
        hostId: legacyHostId,
        kid: legacyKeyId,
        publicKey: { kid: legacyKeyId },
      },
    })
    const tokenRequest = requests.find(({ url }) => url === configuration.agent_token_endpoint)
    const assertion = new URLSearchParams(String(tokenRequest?.init?.body)).get('assertion')
    expect(assertion).not.toBeNull()
    expect(decodeProtectedHeader(assertion!)).toMatchObject({ kid: legacyKeyId })
    expect(decodeJwt(assertion!)).toMatchObject({
      iss: legacyHostId,
      sub: legacyAgentId,
      aud: configuration.issuer,
    })
  })

  it('completes the fake enrollment flow, persists its checkpoint, and resumes an enrolled checkpoint', async () => {
    const gateway = createRealmrootEnrollmentGateway({
      AMA_E2E_TEST_AUTH: 'true',
      AMA_E2E_FAKE_REALMROOT_ENROLLMENT: 'true',
    } as never)
    const initialized = await gateway.initialize({
      origin: `${origin}/path-is-normalized`,
      name: 'Reviewer',
      username: 'reviewer',
      runtime: 'copilot',
      idempotencyKey: 'idem-fake',
    })
    const checkpoints: unknown[] = []
    const enrolled = await gateway.provision({
      origin,
      name: 'Reviewer',
      username: 'reviewer',
      runtime: 'copilot',
      idempotencyKey: 'idem-fake',
      checkpoint: initialized,
      managementCredential: { headers: async () => ({}) },
      onCheckpoint: async (checkpoint) => void checkpoints.push(checkpoint),
    })

    expect(enrolled.descriptor).toMatchObject({ runtime: 'copilot', username: 'reviewer' })
    expect(enrolled.checkpoint.state).toMatchObject({
      origin,
      identity: { id: enrolled.descriptor.agentId, runtime: 'copilot' },
      protocol_credential: {
        access_token: 'e2e-fixture-token',
        scopes: ['agent:read'],
      },
    })
    expect(checkpoints).toEqual([enrolled.checkpoint])
    await expect(
      gateway.provision({
        origin,
        name: 'Reviewer',
        username: 'reviewer',
        runtime: 'copilot',
        idempotencyKey: 'idem-fake',
        checkpoint: enrolled.checkpoint,
        managementCredential: { headers: async () => ({}) },
        onCheckpoint: async () => {
          throw new Error('resume must not checkpoint again')
        },
      }),
    ).resolves.toEqual({ checkpoint: enrolled.checkpoint, descriptor: enrolled.descriptor })
  })

  it('creates, self-proves, and checkpoints a real Realmroot Agent', async () => {
    const requests: Array<{ url: string; init: RequestInit | undefined }> = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (request: string | URL | Request, init?: RequestInit) => {
        const url = request.toString()
        requests.push({ url, init })
        if (url.endsWith('/.well-known/agent-configuration')) return Response.json(configuration)
        if (url === `${origin}/api/agents`) {
          return Response.json({
            id: remoteAgentId,
            issuer: configuration.issuer,
            subject: remoteAgentId,
            username: 'reviewer',
            runtime: 'codex',
            status: 'active',
          })
        }
        if (url === configuration.agent_token_endpoint) {
          return Response.json({ access_token: 'agent-access-token', token_type: 'DPoP', expires_in: 0 })
        }
        if (url === configuration.agent_endpoint) {
          return Response.json({
            agent: {
              id: remoteAgentId,
              issuer: configuration.issuer,
              subject: remoteAgentId,
              username: 'reviewer',
              runtime: 'codex',
              status: 'active',
            },
          })
        }
        throw new Error(`Unexpected request: ${url}`)
      }),
    )
    const gateway = createRealmrootEnrollmentGateway()
    const initialized = await gateway.initialize({
      origin,
      name: 'Reviewer',
      username: 'reviewer',
      runtime: 'codex',
      idempotencyKey: 'idem-real',
    })
    const onCheckpoint = vi.fn(async () => {})
    const result = await gateway.provision({
      origin,
      name: 'Reviewer',
      username: 'reviewer',
      runtime: 'codex',
      idempotencyKey: 'idem-real',
      checkpoint: initialized,
      managementCredential: { headers: async () => ({ authorization: 'Bearer management' }) },
      onCheckpoint,
    })

    expect(result.descriptor).toMatchObject({ agentId: remoteAgentId, subject: remoteAgentId, runtime: 'codex' })
    expect(result.checkpoint.state).toMatchObject({
      identity: { id: remoteAgentId },
      protocol_credential: {
        access_token: 'agent-access-token',
        expires_at: expect.any(String),
        private_key: expect.any(String),
      },
    })
    expect(onCheckpoint).toHaveBeenCalledWith(result.checkpoint)
    expect(requests.find(({ url }) => url === configuration.agent_token_endpoint)?.init?.headers).toMatchObject({
      dpop: expect.any(String),
    })
    expect(requests.find(({ url }) => url === configuration.agent_endpoint)?.init?.headers).toMatchObject({
      authorization: 'DPoP agent-access-token',
      dpop: expect.any(String),
    })
    const createRequest = requests.find(({ url }) => url === `${origin}/api/agents`)
    expect(JSON.parse(String(createRequest?.init?.body))).toMatchObject({
      installation: {
        agentId: initialized.state.agent_id,
        hostId: initialized.state.host_id,
        kid: initialized.state.agent_key_id,
        publicKey: { kid: initialized.state.agent_key_id },
      },
    })
  })

  it.each([
    'http://realmroot.example',
    'https://user:password@realmroot.example',
    'https://realmroot.example?query=1',
    'https://realmroot.example#fragment',
  ])('rejects unsafe origin %s', async (unsafeOrigin) => {
    await expect(
      createRealmrootEnrollmentGateway().initialize({
        origin: unsafeOrigin,
        name: 'Reviewer',
        username: 'reviewer',
        runtime: 'codex',
        idempotencyKey: 'idem-1',
      }),
    ).rejects.toThrow('safe HTTPS URL')
  })

  it('rejects a checkpoint from a different runtime or idempotency request', async () => {
    const gateway = createRealmrootEnrollmentGateway()
    const checkpoint = await gateway.initialize({
      origin,
      name: 'Reviewer',
      username: 'reviewer',
      runtime: 'codex',
      idempotencyKey: 'idem-1',
    })
    await expect(
      gateway.provision({
        origin,
        name: 'Reviewer',
        username: 'reviewer',
        runtime: 'ama',
        idempotencyKey: 'idem-other',
        checkpoint,
        managementCredential: { headers: async () => ({}) },
        onCheckpoint: async () => {},
      }),
    ).rejects.toThrow('checkpoint does not match')
  })

  it.each([
    'ama',
    'codex',
    'claude-code',
    'copilot',
  ] as const)('sends the selected %s runtime and rejects a mismatched Remote Agent response', async (runtime) => {
    const requests: Array<{ url: string; init: RequestInit | undefined }> = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (request: string | URL | Request, init?: RequestInit) => {
        const url = request.toString()
        requests.push({ url, init })
        if (url.endsWith('/.well-known/agent-configuration')) {
          return Response.json(configuration)
        }
        if (url === `${origin}/api/agents`) {
          return Response.json({
            id: 'rr_agent_1',
            issuer: configuration.issuer,
            subject: 'rr_agent_1',
            username: 'reviewer',
            runtime: runtime === 'codex' ? 'ama' : 'codex',
            status: 'active',
          })
        }
        throw new Error(`Unexpected request: ${url}`)
      }),
    )

    const gateway = createRealmrootEnrollmentGateway()
    const checkpoint = await gateway.initialize({
      origin,
      name: 'Reviewer',
      username: 'reviewer',
      runtime,
      idempotencyKey: 'idem-1',
    })
    await expect(
      gateway.provision({
        origin,
        name: 'Reviewer',
        username: 'reviewer',
        runtime,
        idempotencyKey: 'idem-1',
        checkpoint,
        managementCredential: { headers: async () => ({ authorization: 'Bearer management' }) },
        onCheckpoint: async () => {},
      }),
    ).rejects.toThrow('does not match the requested Identity')

    const create = requests.find(({ url }) => url === `${origin}/api/agents`)
    expect(create?.init?.headers).toMatchObject({ authorization: 'Bearer management', 'idempotency-key': 'idem-1' })
    expect(JSON.parse(String(create?.init?.body))).toMatchObject({ runtime, username: 'reviewer' })
  })

  it('fails discovery that crosses the Realmroot origin boundary', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({ ...configuration, agent_endpoint: 'https://evil.example/api/agent' })),
    )
    const gateway = createRealmrootEnrollmentGateway()
    const checkpoint = await gateway.initialize({
      origin,
      name: 'Reviewer',
      username: 'reviewer',
      runtime: 'codex',
      idempotencyKey: 'idem-1',
    })
    await expect(
      gateway.provision({
        origin,
        name: 'Reviewer',
        username: 'reviewer',
        runtime: 'codex',
        idempotencyKey: 'idem-1',
        checkpoint,
        managementCredential: { headers: async () => ({ authorization: 'Bearer management' }) },
        onCheckpoint: async () => {},
      }),
    ).rejects.toThrow('crossed an origin boundary')
  })

  it('rejects incompatible discovery and failed Realmroot requests', async () => {
    const gateway = createRealmrootEnrollmentGateway()
    const checkpoint = await gateway.initialize({
      origin,
      name: 'Reviewer',
      username: 'reviewer',
      runtime: 'codex',
      idempotencyKey: 'idem-1',
    })
    const input = {
      origin,
      name: 'Reviewer',
      username: 'reviewer',
      runtime: 'codex' as const,
      idempotencyKey: 'idem-1',
      checkpoint,
      managementCredential: { headers: async () => ({}) },
      onCheckpoint: async () => {},
    }
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({ ...configuration, agent_identity_issuer: 'other' })),
    )
    await expect(gateway.provision(input)).rejects.toThrow('discovery is incompatible')

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('unavailable', { status: 503 })),
    )
    await expect(gateway.provision(input)).rejects.toThrow('status 503')
  })
})
