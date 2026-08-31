import type { Env } from '@server/env'
import { type InboxSubscriptionGateway, InboxSubscriptionGatewayError } from '@server/usecases/ports'

const TIMEOUT_MS = 15_000
const API_VERSION = '2026-08-11'

function required(value: string | undefined, name: string) {
  if (!value?.trim()) throw new InboxSubscriptionGatewayError('unavailable', `${name} is required for Inbox Triggers`)
  return value.trim()
}

async function serviceAccessToken(env: Env, audience: string) {
  const issuer = required(env.OIDC_ISSUER, 'OIDC_ISSUER').replace(/\/$/, '')
  let discoveryResponse: Response
  try {
    discoveryResponse = await fetch(`${issuer}/.well-known/openid-configuration`, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
  } catch (cause) {
    throw new InboxSubscriptionGatewayError('unavailable', 'Inbox M2M discovery failed', { cause })
  }
  const discovery = (await discoveryResponse.json().catch(() => null)) as {
    issuer?: string
    token_endpoint?: string
  } | null
  if (!discoveryResponse.ok) {
    throw new InboxSubscriptionGatewayError(
      discoveryResponse.status === 429 || discoveryResponse.status >= 500 ? 'unavailable' : 'invalid_response',
      'Inbox M2M discovery was rejected',
    )
  }
  if (discovery?.issuer !== issuer || !discovery.token_endpoint) {
    throw new InboxSubscriptionGatewayError('invalid_response', 'Inbox M2M discovery returned an invalid response')
  }
  const tokenEndpoint = new URL(discovery.token_endpoint)
  if (tokenEndpoint.protocol !== 'https:' || tokenEndpoint.origin !== new URL(issuer).origin) {
    throw new InboxSubscriptionGatewayError('invalid_response', 'Inbox M2M token endpoint crossed an origin boundary')
  }

  let response: Response
  try {
    response = await fetch(tokenEndpoint, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/x-www-form-urlencoded',
        authorization: `Basic ${btoa(`${required(env.OIDC_CLIENT_ID, 'OIDC_CLIENT_ID')}:${required(env.OIDC_CLIENT_SECRET, 'OIDC_CLIENT_SECRET')}`)}`,
      },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        audience,
        scope: 'subscriptions:manage',
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
  } catch (cause) {
    throw new InboxSubscriptionGatewayError('unavailable', 'Inbox M2M token request failed', { cause })
  }
  const body = (await response.json().catch(() => null)) as { access_token?: string; token_type?: string } | null
  if (!response.ok) {
    throw new InboxSubscriptionGatewayError(
      response.status === 429 || response.status >= 500 ? 'unavailable' : 'rejected',
      'Inbox M2M token request was rejected',
    )
  }
  if (!body?.access_token || body.token_type?.toLowerCase() !== 'bearer') {
    throw new InboxSubscriptionGatewayError('rejected', 'Inbox M2M token request was rejected')
  }
  return body.access_token
}

function subscriptionUrl(resource: string, subscriptionId: string) {
  const base = new URL(resource)
  if (base.protocol !== 'https:') {
    throw new InboxSubscriptionGatewayError('unavailable', 'INBOX_RESOURCE must use HTTPS')
  }
  return `${base.toString().replace(/\/$/, '')}/subscriptions/${encodeURIComponent(subscriptionId)}`
}

function callbackUrl(env: Env) {
  const resource = new URL(required(env.OIDC_RESOURCE, 'OIDC_RESOURCE'))
  if (resource.protocol !== 'https:') {
    throw new InboxSubscriptionGatewayError('unavailable', 'OIDC_RESOURCE must use HTTPS')
  }
  return `${resource.toString().replace(/\/$/, '')}/v1/inbox-notifications`
}

export function createInboxSubscriptionGateway(env: Env): InboxSubscriptionGateway {
  async function request(resource: string, accessToken: string, subscriptionId: string, init: RequestInit) {
    try {
      return await fetch(subscriptionUrl(resource, subscriptionId), {
        ...init,
        headers: {
          accept: 'application/json',
          authorization: `Bearer ${accessToken}`,
          'API-Version': API_VERSION,
          ...init.headers,
        },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      })
    } catch (cause) {
      throw new InboxSubscriptionGatewayError('unavailable', 'Inbox Subscription request failed', { cause })
    }
  }

  function responseEtag(response: Response) {
    const etag = response.headers.get('etag')
    if (!etag) throw new InboxSubscriptionGatewayError('invalid_response', 'Inbox Subscription response omitted ETag')
    return etag
  }

  async function currentEtag(resource: string, accessToken: string, subscriptionId: string) {
    const response = await request(resource, accessToken, subscriptionId, { method: 'GET' })
    if (response.status === 404) return null
    if (!response.ok) {
      throw new InboxSubscriptionGatewayError(
        response.status === 429 || response.status >= 500 ? 'unavailable' : 'rejected',
        'Inbox Subscription read was rejected',
      )
    }
    return responseEtag(response)
  }

  return {
    async put(input) {
      const resource = required(env.INBOX_RESOURCE, 'INBOX_RESOURCE')
      const accessToken = await serviceAccessToken(env, resource)
      const body = JSON.stringify({
        agentId: input.agentId,
        events: ['message.created'],
        delivery: {
          url: callbackUrl(env),
          authorization: { scheme: 'bearer', token: input.callbackToken },
        },
      })
      const put = (etag: string | null) =>
        request(resource, accessToken, input.subscriptionId, {
          method: 'PUT',
          headers: {
            'content-type': 'application/json',
            ...(etag ? { 'If-Match': etag } : { 'If-None-Match': '*' }),
          },
          body,
        })

      let response = await put(input.etag)
      if (response.status === 412) {
        const etag = await currentEtag(resource, accessToken, input.subscriptionId)
        response = await put(etag)
      }
      if (!response.ok) {
        throw new InboxSubscriptionGatewayError(
          response.status === 429 || response.status >= 500 ? 'unavailable' : 'rejected',
          'Inbox Subscription update was rejected',
        )
      }
      return { etag: responseEtag(response) }
    },

    async delete(input) {
      const resource = required(env.INBOX_RESOURCE, 'INBOX_RESOURCE')
      const accessToken = await serviceAccessToken(env, resource)
      let etag = input.etag ?? (await currentEtag(resource, accessToken, input.subscriptionId))
      if (!etag) return
      const remove = (current: string) =>
        request(resource, accessToken, input.subscriptionId, {
          method: 'DELETE',
          headers: { 'If-Match': current },
        })

      let response = await remove(etag)
      if (response.status === 412) {
        etag = await currentEtag(resource, accessToken, input.subscriptionId)
        if (!etag) return
        response = await remove(etag)
      }
      if (!response.ok && response.status !== 404) {
        throw new InboxSubscriptionGatewayError(
          response.status === 429 || response.status >= 500 ? 'unavailable' : 'rejected',
          'Inbox Subscription deletion was rejected',
        )
      }
    },
  }
}
