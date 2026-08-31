import type { Env } from '@server/env'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createInboxSubscriptionGateway } from './inbox-subscriptions'

function testEnv(overrides: Record<string, unknown> = {}) {
  return {
    OIDC_ISSUER: 'https://id.example/api/auth',
    OIDC_RESOURCE: 'https://agency.example/api',
    INBOX_RESOURCE: 'https://inbox.example/api',
    INBOX_CLIENT_ID: 'agency-inbox-service',
    INBOX_CLIENT_SECRET: 'service-secret',
    ...overrides,
  } as Env
}

afterEach(() => vi.unstubAllGlobals())

describe('[spec: triggers/inbox-provisioning] Inbox Subscription gateway', () => {
  const putInput = {
    subscriptionId: 'sub_0123456789abcdef0123456789abcdef',
    agentSubject: '01a05643-33a4-704f-8d6b-c30c04e18c6c',
    callbackToken: 'callback-secret',
    etag: null,
  }

  it('uses client credentials and PUTs the registered callback without leaking the token into the URL', async () => {
    const requests: Array<{ url: string; init: RequestInit | undefined }> = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (request: string | URL | Request, init?: RequestInit) => {
        const url = request.toString()
        requests.push({ url, init })
        if (url.endsWith('/.well-known/openid-configuration')) {
          return Response.json({
            issuer: 'https://id.example/api/auth',
            token_endpoint: 'https://id.example/api/auth/token',
          })
        }
        if (url.endsWith('/token')) return Response.json({ access_token: 'm2m-token', token_type: 'Bearer' })
        return Response.json({ id: 'sub_0123456789abcdef0123456789abcdef' }, { headers: { etag: '"v1"' } })
      }),
    )

    await expect(
      createInboxSubscriptionGateway(testEnv()).put({
        subscriptionId: 'sub_0123456789abcdef0123456789abcdef',
        agentSubject: '01a05643-33a4-704f-8d6b-c30c04e18c6c',
        callbackToken: 'callback-secret',
        etag: null,
      }),
    ).resolves.toEqual({ etag: '"v1"' })

    const tokenRequest = requests[1]
    const tokenForm = new URLSearchParams(String(tokenRequest?.init?.body))
    expect(tokenForm.get('grant_type')).toBe('client_credentials')
    expect(tokenForm.get('scope')).toBe('subscriptions:read subscriptions:manage')
    expect(tokenForm.get('resource')).toBe('https://inbox.example/api')
    expect(tokenForm.has('audience')).toBe(false)
    const put = requests[2]
    expect(put?.url).toBe('https://inbox.example/api/subscriptions/sub_0123456789abcdef0123456789abcdef')
    expect(put?.url).not.toContain('callback-secret')
    expect(put?.init?.headers).toMatchObject({
      authorization: 'Bearer m2m-token',
      'API-Version': '2026-08-11',
      'If-None-Match': '*',
    })
    expect(JSON.parse(String(put?.init?.body))).toEqual({
      agentId: '01a05643-33a4-704f-8d6b-c30c04e18c6c',
      events: ['message.created'],
      delivery: {
        url: 'https://agency.example/api/v1/inbox-notifications',
        authorization: { scheme: 'bearer', token: 'callback-secret' },
      },
    })
  })

  it('treats DELETE 404 as an idempotent success', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (request: string | URL | Request) => {
        const url = request.toString()
        if (url.endsWith('/.well-known/openid-configuration')) {
          return Response.json({
            issuer: 'https://id.example/api/auth',
            token_endpoint: 'https://id.example/api/auth/token',
          })
        }
        if (url.endsWith('/token')) return Response.json({ access_token: 'm2m-token', token_type: 'Bearer' })
        return new Response(null, { status: 404 })
      }),
    )
    await expect(
      createInboxSubscriptionGateway(testEnv()).delete({
        subscriptionId: 'sub_0123456789abcdef0123456789abcdef',
        etag: null,
      }),
    ).resolves.toBeUndefined()
  })

  it('recovers the current ETag after a replacement race and retries with If-Match', async () => {
    const subscriptionRequests: RequestInit[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (request: string | URL | Request, init?: RequestInit) => {
        const url = request.toString()
        if (url.endsWith('/.well-known/openid-configuration')) {
          return Response.json({
            issuer: 'https://id.example/api/auth',
            token_endpoint: 'https://id.example/api/auth/token',
          })
        }
        if (url.endsWith('/token')) return Response.json({ access_token: 'm2m-token', token_type: 'Bearer' })
        subscriptionRequests.push(init ?? {})
        if (init?.method === 'GET') return Response.json({}, { headers: { etag: '"v2"' } })
        if (subscriptionRequests.length === 1) return new Response(null, { status: 412 })
        return Response.json({}, { headers: { etag: '"v3"' } })
      }),
    )

    await expect(
      createInboxSubscriptionGateway(testEnv()).put({
        subscriptionId: 'sub_0123456789abcdef0123456789abcdef',
        agentSubject: '01a05643-33a4-704f-8d6b-c30c04e18c6c',
        callbackToken: 'callback-secret',
        etag: '"v1"',
      }),
    ).resolves.toEqual({ etag: '"v3"' })
    expect(subscriptionRequests.map((request) => request.method)).toEqual(['PUT', 'GET', 'PUT'])
    expect(subscriptionRequests[2]?.headers).toMatchObject({ 'If-Match': '"v2"' })
  })

  it('fails closed when a required M2M boundary is missing or crosses origins', async () => {
    await expect(
      createInboxSubscriptionGateway(testEnv({ INBOX_RESOURCE: undefined })).put({
        subscriptionId: 'trigger_1',
        agentSubject: 'agent_1',
        callbackToken: 'token',
        etag: null,
      }),
    ).rejects.toMatchObject({ code: 'unavailable' })

    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json({ issuer: 'https://id.example/api/auth', token_endpoint: 'https://evil.example/token' }),
      ),
    )
    await expect(
      createInboxSubscriptionGateway(testEnv()).put({
        subscriptionId: 'trigger_1',
        agentSubject: 'agent_1',
        callbackToken: 'token',
        etag: null,
      }),
    ).rejects.toMatchObject({ code: 'invalid_response' })
  })

  it.each([
    ['OIDC_ISSUER', { OIDC_ISSUER: undefined }],
    ['INBOX_CLIENT_ID', { INBOX_CLIENT_ID: undefined }],
    ['INBOX_CLIENT_SECRET', { INBOX_CLIENT_SECRET: undefined }],
  ])('rejects missing %s configuration', async (_name, override) => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (request: string | URL | Request) => {
        const url = request.toString()
        if (url.endsWith('/.well-known/openid-configuration')) {
          return Response.json({
            issuer: 'https://id.example/api/auth',
            token_endpoint: 'https://id.example/api/auth/token',
          })
        }
        throw new Error('token request should fail before fetch')
      }),
    )
    await expect(createInboxSubscriptionGateway(testEnv(override)).put(putInput)).rejects.toMatchObject({
      code: 'unavailable',
    })
  })

  it('classifies discovery network, status, and document failures', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Promise.reject(new Error('offline'))),
    )
    await expect(createInboxSubscriptionGateway(testEnv()).put(putInput)).rejects.toMatchObject({
      code: 'unavailable',
      cause: expect.any(Error),
    })

    for (const [status, code] of [
      [429, 'unavailable'],
      [400, 'invalid_response'],
    ] as const) {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => new Response(null, { status })),
      )
      await expect(createInboxSubscriptionGateway(testEnv()).put(putInput)).rejects.toMatchObject({ code })
    }

    for (const document of [
      null,
      { issuer: 'https://wrong.example', token_endpoint: 'https://id.example/api/auth/token' },
      { issuer: 'https://id.example/api/auth' },
      { issuer: 'https://id.example/api/auth', token_endpoint: 'http://id.example/token' },
    ]) {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => Response.json(document)),
      )
      await expect(createInboxSubscriptionGateway(testEnv()).put(putInput)).rejects.toMatchObject({
        code: 'invalid_response',
      })
    }
  })

  it('classifies token endpoint network, status, and document failures', async () => {
    const tokenFailure = async (response: () => Promise<Response>) => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async (request: string | URL | Request) => {
          if (request.toString().endsWith('/.well-known/openid-configuration')) {
            return Response.json({
              issuer: 'https://id.example/api/auth',
              token_endpoint: 'https://id.example/api/auth/token',
            })
          }
          return response()
        }),
      )
      return createInboxSubscriptionGateway(testEnv()).put(putInput)
    }

    await expect(tokenFailure(async () => Promise.reject(new Error('offline')))).rejects.toMatchObject({
      code: 'unavailable',
      cause: expect.any(Error),
    })
    await expect(tokenFailure(async () => new Response(null, { status: 500 }))).rejects.toMatchObject({
      code: 'unavailable',
    })
    await expect(tokenFailure(async () => new Response(null, { status: 401 }))).rejects.toMatchObject({
      code: 'rejected',
    })
    await expect(tokenFailure(async () => Response.json({ token_type: 'Bearer' }))).rejects.toMatchObject({
      code: 'rejected',
    })
    await expect(
      tokenFailure(async () => Response.json({ access_token: 'token', token_type: 'Basic' })),
    ).rejects.toMatchObject({
      code: 'rejected',
    })
  })

  it('validates protected-resource and callback HTTPS boundaries', async () => {
    const authenticatedFetch = vi.fn(async (request: string | URL | Request) => {
      const url = request.toString()
      if (url.endsWith('/.well-known/openid-configuration')) {
        return Response.json({
          issuer: 'https://id.example/api/auth',
          token_endpoint: 'https://id.example/api/auth/token',
        })
      }
      if (url.endsWith('/token')) return Response.json({ access_token: 'm2m-token', token_type: 'Bearer' })
      return Response.json({}, { headers: { etag: '"v1"' } })
    })
    vi.stubGlobal('fetch', authenticatedFetch)
    await expect(
      createInboxSubscriptionGateway(testEnv({ INBOX_RESOURCE: 'http://inbox.example/api' })).put(putInput),
    ).rejects.toMatchObject({ code: 'unavailable' })
    await expect(
      createInboxSubscriptionGateway(testEnv({ OIDC_RESOURCE: 'http://agency.example/api' })).put(putInput),
    ).rejects.toMatchObject({ code: 'unavailable' })
    await expect(
      createInboxSubscriptionGateway(testEnv({ OIDC_RESOURCE: undefined })).put(putInput),
    ).rejects.toMatchObject({ code: 'unavailable' })
  })

  it('classifies Subscription request failures and invalid success responses', async () => {
    const managementResponse = async (response: () => Promise<Response>) => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async (request: string | URL | Request) => {
          const url = request.toString()
          if (url.endsWith('/.well-known/openid-configuration')) {
            return Response.json({
              issuer: 'https://id.example/api/auth',
              token_endpoint: 'https://id.example/api/auth/token',
            })
          }
          if (url.endsWith('/token')) return Response.json({ access_token: 'm2m-token', token_type: 'Bearer' })
          return response()
        }),
      )
      return createInboxSubscriptionGateway(testEnv()).put(putInput)
    }
    await expect(managementResponse(async () => Promise.reject(new Error('offline')))).rejects.toMatchObject({
      code: 'unavailable',
      cause: expect.any(Error),
    })
    await expect(managementResponse(async () => new Response(null, { status: 503 }))).rejects.toMatchObject({
      code: 'unavailable',
      status: 503,
    })
    await expect(managementResponse(async () => new Response(null, { status: 400 }))).rejects.toMatchObject({
      code: 'rejected',
    })
    await expect(managementResponse(async () => Response.json({}))).rejects.toMatchObject({
      code: 'invalid_response',
    })
  })

  it('uses subscriptions:read to recover ETags and classifies GET failures', async () => {
    const requests: RequestInit[] = []
    const run = async (getResponse: Response) => {
      requests.length = 0
      vi.stubGlobal(
        'fetch',
        vi.fn(async (request: string | URL | Request, init?: RequestInit) => {
          const url = request.toString()
          if (url.endsWith('/.well-known/openid-configuration')) {
            return Response.json({
              issuer: 'https://id.example/api/auth',
              token_endpoint: 'https://id.example/api/auth/token',
            })
          }
          if (url.endsWith('/token')) return Response.json({ access_token: 'm2m-token', token_type: 'Bearer' })
          requests.push(init ?? {})
          if (init?.method === 'PUT') return new Response(null, { status: 412 })
          return getResponse
        }),
      )
      return createInboxSubscriptionGateway(testEnv()).put({ ...putInput, etag: '"stale"' })
    }
    await expect(run(new Response(null, { status: 500 }))).rejects.toMatchObject({ code: 'unavailable' })
    await expect(run(new Response(null, { status: 403 }))).rejects.toMatchObject({ code: 'rejected' })
    await expect(run(Response.json({}))).rejects.toMatchObject({ code: 'invalid_response' })
    expect(requests.at(-1)?.headers).toMatchObject({ authorization: 'Bearer m2m-token', 'API-Version': '2026-08-11' })
  })

  it('deletes with known and recovered ETags across races', async () => {
    const subscriptionRequests: RequestInit[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (request: string | URL | Request, init?: RequestInit) => {
        const url = request.toString()
        if (url.endsWith('/.well-known/openid-configuration')) {
          return Response.json({
            issuer: 'https://id.example/api/auth',
            token_endpoint: 'https://id.example/api/auth/token',
          })
        }
        if (url.endsWith('/token')) return Response.json({ access_token: 'm2m-token', token_type: 'Bearer' })
        subscriptionRequests.push(init ?? {})
        if (init?.method === 'GET') return Response.json({}, { headers: { etag: '"v2"' } })
        if (subscriptionRequests.length === 1) return new Response(null, { status: 412 })
        return new Response(null, { status: 204 })
      }),
    )
    await expect(
      createInboxSubscriptionGateway(testEnv()).delete({ ...putInput, etag: '"v1"' }),
    ).resolves.toBeUndefined()
    expect(subscriptionRequests.map((request) => request.method)).toEqual(['DELETE', 'GET', 'DELETE'])
    expect(subscriptionRequests[2]?.headers).toMatchObject({ 'If-Match': '"v2"' })
  })

  it('treats a disappeared DELETE race as success and classifies deletion rejection', async () => {
    const run = async (responses: Response[]) => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async (request: string | URL | Request) => {
          const url = request.toString()
          if (url.endsWith('/.well-known/openid-configuration')) {
            return Response.json({
              issuer: 'https://id.example/api/auth',
              token_endpoint: 'https://id.example/api/auth/token',
            })
          }
          if (url.endsWith('/token')) return Response.json({ access_token: 'm2m-token', token_type: 'Bearer' })
          return responses.shift() ?? new Response(null, { status: 500 })
        }),
      )
      return createInboxSubscriptionGateway(testEnv()).delete({ ...putInput, etag: '"v1"' })
    }
    await expect(
      run([new Response(null, { status: 412 }), new Response(null, { status: 404 })]),
    ).resolves.toBeUndefined()
    await expect(run([new Response(null, { status: 429 })])).rejects.toMatchObject({ code: 'unavailable' })
    await expect(run([new Response(null, { status: 409 })])).rejects.toMatchObject({ code: 'rejected' })
  })
})
