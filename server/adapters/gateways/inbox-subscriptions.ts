import type { Env } from '@server/env'
import { type InboxSubscriptionGateway, InboxSubscriptionGatewayError } from '@server/usecases/ports'

const TIMEOUT_MS = 15_000
const API_VERSION = '2026-08-11'
const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const diagnosticCauses = new WeakMap<InboxSubscriptionGatewayError, unknown>()

function gatewayError(
  code: InboxSubscriptionGatewayError['code'],
  message: string,
  options: { status?: number; diagnosticCause?: unknown } = {},
) {
  const error = new InboxSubscriptionGatewayError(code, message, {
    ...(options.status === undefined ? {} : { status: options.status }),
  })
  if (options.diagnosticCause !== undefined) diagnosticCauses.set(error, options.diagnosticCause)
  return error
}

async function classified<T>(message: string, operation: () => Promise<T>) {
  try {
    return await operation()
  } catch (cause) {
    if (cause instanceof InboxSubscriptionGatewayError) throw cause
    throw gatewayError('unavailable', message, { diagnosticCause: cause })
  }
}

function required(value: string | undefined, name: string) {
  if (!value?.trim()) throw new InboxSubscriptionGatewayError('unavailable', `${name} is required for Inbox Triggers`)
  return value.trim()
}

async function serviceAccessToken(env: Env, resource: string) {
  const issuer = required(env.OIDC_ISSUER, 'OIDC_ISSUER').replace(/\/$/, '')
  let discoveryResponse: Response
  try {
    discoveryResponse = await fetch(`${issuer}/.well-known/openid-configuration`, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
  } catch (cause) {
    throw gatewayError('unavailable', 'Inbox M2M discovery failed', { diagnosticCause: cause })
  }
  const discovery = (await discoveryResponse.json().catch(() => null)) as {
    issuer?: string
    token_endpoint?: string
  } | null
  if (!discoveryResponse.ok) {
    throw new InboxSubscriptionGatewayError(
      discoveryResponse.status === 429 || discoveryResponse.status >= 500 ? 'unavailable' : 'invalid_response',
      'Inbox M2M discovery was rejected',
      { status: discoveryResponse.status },
    )
  }
  if (discovery?.issuer !== issuer || !discovery.token_endpoint) {
    throw new InboxSubscriptionGatewayError('invalid_response', 'Inbox M2M discovery returned an invalid response', {
      status: discoveryResponse.status,
    })
  }
  const tokenEndpoint = new URL(discovery.token_endpoint)
  if (tokenEndpoint.protocol !== 'https:' || tokenEndpoint.origin !== new URL(issuer).origin) {
    throw new InboxSubscriptionGatewayError('invalid_response', 'Inbox M2M token endpoint crossed an origin boundary', {
      status: discoveryResponse.status,
    })
  }

  let response: Response
  try {
    response = await fetch(tokenEndpoint, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/x-www-form-urlencoded',
        authorization: `Basic ${btoa(`${required(env.INBOX_CLIENT_ID, 'INBOX_CLIENT_ID')}:${required(env.INBOX_CLIENT_SECRET, 'INBOX_CLIENT_SECRET')}`)}`,
      },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        resource,
        scope: 'subscriptions:read subscriptions:manage',
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
  } catch (cause) {
    throw gatewayError('unavailable', 'Inbox M2M token request failed', { diagnosticCause: cause })
  }
  const body = (await response.json().catch(() => null)) as { access_token?: string; token_type?: string } | null
  if (!response.ok) {
    throw new InboxSubscriptionGatewayError(
      response.status === 429 || response.status >= 500 ? 'unavailable' : 'rejected',
      'Inbox M2M token request was rejected',
      { status: response.status },
    )
  }
  if (!body?.access_token || body.token_type?.toLowerCase() !== 'bearer') {
    throw new InboxSubscriptionGatewayError('rejected', 'Inbox M2M token request was rejected', {
      status: response.status,
    })
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
      throw gatewayError('unavailable', 'Inbox Subscription request failed', { diagnosticCause: cause })
    }
  }

  function responseEtag(response: Response) {
    const etag = response.headers.get('etag')
    if (!etag) {
      throw new InboxSubscriptionGatewayError('invalid_response', 'Inbox Subscription response omitted ETag', {
        status: response.status,
      })
    }
    return etag
  }

  async function currentSubscription(resource: string, accessToken: string, subscriptionId: string) {
    const response = await request(resource, accessToken, subscriptionId, { method: 'GET' })
    if (response.status === 404) return null
    if (!response.ok) {
      throw new InboxSubscriptionGatewayError(
        response.status === 429 || response.status >= 500 ? 'unavailable' : 'rejected',
        'Inbox Subscription read was rejected',
        { status: response.status },
      )
    }
    const representation = (await response.json().catch(() => null)) as { agentId?: unknown } | null
    if (typeof representation?.agentId !== 'string' || !UUID_V7.test(representation.agentId)) {
      throw new InboxSubscriptionGatewayError(
        'invalid_response',
        'Inbox Subscription read returned an invalid Agent subject',
        { status: response.status },
      )
    }
    return { etag: responseEtag(response), agentSubject: representation.agentId }
  }

  return {
    get(input) {
      return classified('Inbox Subscription read failed', async () => {
        const resource = required(env.INBOX_RESOURCE, 'INBOX_RESOURCE')
        const accessToken = await serviceAccessToken(env, resource)
        return currentSubscription(resource, accessToken, input.subscriptionId)
      })
    },

    put(input) {
      return classified('Inbox Subscription update failed', async () => {
        if (!UUID_V7.test(input.agentSubject)) {
          throw new InboxSubscriptionGatewayError('rejected', 'Inbox Subscription Agent subject must be UUIDv7')
        }
        const resource = required(env.INBOX_RESOURCE, 'INBOX_RESOURCE')
        const accessToken = await serviceAccessToken(env, resource)
        const body = JSON.stringify({
          agentId: input.agentSubject,
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
          const current = await currentSubscription(resource, accessToken, input.subscriptionId)
          response = await put(current?.etag ?? null)
        }
        if (!response.ok) {
          throw new InboxSubscriptionGatewayError(
            response.status === 429 || response.status >= 500 ? 'unavailable' : 'rejected',
            'Inbox Subscription update was rejected',
            { status: response.status },
          )
        }
        return { etag: responseEtag(response) }
      })
    },

    delete(input) {
      return classified('Inbox Subscription deletion failed', async () => {
        const resource = required(env.INBOX_RESOURCE, 'INBOX_RESOURCE')
        const accessToken = await serviceAccessToken(env, resource)
        let etag = input.etag ?? (await currentSubscription(resource, accessToken, input.subscriptionId))?.etag ?? null
        if (!etag) return
        const remove = (current: string) =>
          request(resource, accessToken, input.subscriptionId, {
            method: 'DELETE',
            headers: { 'If-Match': current },
          })

        let response = await remove(etag)
        if (response.status === 412) {
          etag = (await currentSubscription(resource, accessToken, input.subscriptionId))?.etag ?? null
          if (!etag) return
          response = await remove(etag)
        }
        if (!response.ok && response.status !== 404) {
          throw new InboxSubscriptionGatewayError(
            response.status === 429 || response.status >= 500 ? 'unavailable' : 'rejected',
            'Inbox Subscription deletion was rejected',
            { status: response.status },
          )
        }
      })
    },
  }
}
