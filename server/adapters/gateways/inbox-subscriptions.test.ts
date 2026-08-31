import type { Env } from '@server/env'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createInboxSubscriptionGateway } from './inbox-subscriptions'

function testEnv(overrides: Record<string, unknown> = {}) {
  return {
    OIDC_ISSUER: 'https://id.example/api/auth',
    OIDC_CLIENT_ID: 'agency-service',
    OIDC_CLIENT_SECRET: 'service-secret',
    OIDC_RESOURCE: 'https://agency.example/api',
    INBOX_RESOURCE: 'https://inbox.example/api',
    ...overrides,
  } as Env
}

afterEach(() => vi.unstubAllGlobals())

describe('[spec: triggers/inbox-provisioning] Inbox Subscription gateway', () => {
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
        agentId: '019ff41a-7da6-708f-8b05-49a4cc6d5300',
        callbackToken: 'callback-secret',
        etag: null,
      }),
    ).resolves.toEqual({ etag: '"v1"' })

    const tokenRequest = requests[1]
    expect(new URLSearchParams(String(tokenRequest?.init?.body)).get('grant_type')).toBe('client_credentials')
    expect(new URLSearchParams(String(tokenRequest?.init?.body)).get('scope')).toBe('subscriptions:manage')
    expect(new URLSearchParams(String(tokenRequest?.init?.body)).get('audience')).toBe('https://inbox.example/api')
    const put = requests[2]
    expect(put?.url).toBe('https://inbox.example/api/subscriptions/sub_0123456789abcdef0123456789abcdef')
    expect(put?.url).not.toContain('callback-secret')
    expect(put?.init?.headers).toMatchObject({
      authorization: 'Bearer m2m-token',
      'API-Version': '2026-08-11',
      'If-None-Match': '*',
    })
    expect(JSON.parse(String(put?.init?.body))).toEqual({
      agentId: '019ff41a-7da6-708f-8b05-49a4cc6d5300',
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
        agentId: '019ff41a-7da6-708f-8b05-49a4cc6d5300',
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
        agentId: 'agent_1',
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
        agentId: 'agent_1',
        callbackToken: 'token',
        etag: null,
      }),
    ).rejects.toMatchObject({ code: 'invalid_response' })
  })
})
