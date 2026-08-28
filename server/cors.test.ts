import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { createApp } from './app'
import type { Env } from './env'

const wranglerConfig = readFileSync(new URL('../wrangler.toml', import.meta.url), 'utf8')
const allowedOrigins = wranglerConfig.match(/^AMA_ALLOWED_ORIGINS\s*=\s*"([^"]+)"$/m)?.[1]

if (!allowedOrigins) {
  throw new Error('wrangler.toml must declare AMA_ALLOWED_ORIGINS')
}

const akOrigin = 'https://ak.tftt.cc'
const env = {
  AMA_ALLOWED_ORIGINS: allowedOrigins,
  OIDC_ISSUER: 'https://identity.cors.test/api/auth',
  OIDC_CLIENT_ID: 'ama-cors-test',
  OIDC_RESOURCE: 'https://ama.tftt.cc/api',
} as Env

function commaSeparatedHeader(response: Response, name: string) {
  return (response.headers.get(name) ?? '')
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean)
}

describe('AMA CORS policy', () => {
  it('allows an AK production origin to preflight authenticated idempotent project requests', async () => {
    expect(allowedOrigins.split(',')).toContain(akOrigin)

    const response = await createApp().fetch(
      new Request('https://ama.tftt.cc/api/v1/sessions', {
        method: 'OPTIONS',
        headers: {
          Origin: akOrigin,
          'Access-Control-Request-Method': 'POST',
          'Access-Control-Request-Headers': 'Authorization, X-AMA-Project-ID, Idempotency-Key',
        },
      }),
      env,
    )

    expect(response.status).toBe(204)
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe(akOrigin)
    expect(commaSeparatedHeader(response, 'Access-Control-Allow-Methods')).toContain('post')
    expect(commaSeparatedHeader(response, 'Access-Control-Allow-Headers')).toEqual(
      expect.arrayContaining(['authorization', 'x-ama-project-id', 'idempotency-key']),
    )
    expect(response.headers.has('Access-Control-Allow-Credentials')).toBe(false)
  })

  it('does not grant CORS access to an origin outside the allowlist', async () => {
    const response = await createApp().fetch(
      new Request('https://ama.tftt.cc/api/v1/sessions', {
        method: 'OPTIONS',
        headers: {
          Origin: 'https://hostile.example',
          'Access-Control-Request-Method': 'POST',
          'Access-Control-Request-Headers': 'Authorization, X-AMA-Project-ID, Idempotency-Key',
        },
      }),
      env,
    )

    expect(response.headers.has('Access-Control-Allow-Origin')).toBe(false)
    expect(response.headers.has('Access-Control-Allow-Credentials')).toBe(false)
  })

  it('exposes correlation, concurrency, and creation response headers without credentialed CORS', async () => {
    const response = await createApp().fetch(
      new Request('https://ama.tftt.cc/api', {
        headers: { Origin: akOrigin },
      }),
      env,
    )

    expect(response.status).toBe(200)
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe(akOrigin)
    expect(commaSeparatedHeader(response, 'Access-Control-Expose-Headers')).toEqual(
      expect.arrayContaining(['request-id', 'etag', 'location']),
    )
    expect(response.headers.has('Access-Control-Allow-Credentials')).toBe(false)
  })
})
