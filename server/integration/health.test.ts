import { SELF } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import { healthResponse } from '../http/health'

describe('[CF] GET /api/v1/health [spec: api-contracts/health]', () => {
  it('returns the Worker health response', async () => {
    const res = await SELF.fetch('https://example.com/api/v1/health')

    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({
      status: 'ok',
      name: 'Any Managed Agents',
      runtime: 'cloudflare-workers',
      oidcIssuer: 'https://oidc.test',
      oidcResource: 'https://example.com',
      runnerClientId: 'ama-runner-test',
      runnerScopes: 'openid profile email offline_access',
    })
  })

  it('does not publish runner device-login metadata without a dedicated runner client', () => {
    expect(
      healthResponse({
        OIDC_ISSUER: 'https://oidc.test/',
        OIDC_RUNNER_SCOPES: 'openid profile email offline_access',
      }),
    ).toMatchObject({
      oidcIssuer: 'https://oidc.test',
      oidcResource: null,
      runnerClientId: null,
      runnerScopes: null,
    })
  })
})
