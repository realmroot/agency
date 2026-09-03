import { env } from 'cloudflare:workers'
import { describe, expect, it } from 'vitest'

describe('[CF] integration test bindings', () => {
  it('uses the deterministic test OIDC bindings instead of local development values', () => {
    expect(env).toMatchObject({
      SANDBOX_TRANSPORT: 'rpc',
      AMA_RUNTIME_MODE: 'test',
      AMA_E2E_TEST_AUTH: 'true',
      OIDC_ISSUER: 'https://identity.alias.test/api/auth/',
      OIDC_CLIENT_ID: 'ama-test',
      OIDC_RUNNER_CLIENT_ID: 'ama-runner-test',
      OIDC_RESOURCE: 'https://ama.tftt.cc/api',
    })
  })
})
