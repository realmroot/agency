import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('deployment environment example', () => {
  it('keeps deployment names explicit while production remains on legacy physical resources', () => {
    const wrangler = readFileSync('wrangler.toml', 'utf8')
    const production = wrangler.split('\n[env.staging]')[0]
    const staging = wrangler.split('\n[env.staging]')[1]?.split('\n[env.e2e]')[0]

    expect(production).toMatch(/^name = "any-managed-agents"$/m)
    expect(production).toContain('queue = "ama-cloud-turns"')
    expect(production).toContain('dead_letter_queue = "ama-cloud-turns-dlq"')
    expect(production).toContain('queue = "ama-trigger-dispatches"')
    expect(production).toContain('dead_letter_queue = "ama-trigger-dispatches-dlq"')
    expect(production).toContain('database_name = "any-managed-agents-db"')
    expect(production).toContain('bucket_name = "ama-session-events"')
    expect(production).toMatch(/^name = "any-managed-agents-sandbox"$/m)
    expect(production).toContain('`wrangler queues create ama-cloud-turns-dlq`')
    expect(production).not.toContain('`wrangler queues create enbor-cloud-turns-dlq`')
    expect(staging).toMatch(/^name = "any-managed-agents-staging"$/m)
    expect(staging).toMatch(/^name = "any-managed-agents-staging-sandbox"$/m)
  })

  it('uses the canonical Realmroot OIDC issuer path', () => {
    const envExample = readFileSync('.env.example', 'utf8')
    expect(envExample).toMatch(/^OIDC_ISSUER=https:\/\/id\.realmroot\.dev\/api\/auth$/m)
    expect(envExample).not.toMatch(/^OIDC_ISSUER=https:\/\/id\.realmroot\.dev\/?$/m)
  })

  it('keeps the self-hosted runner client and exact scopes aligned with production', () => {
    const envExample = readFileSync('.env.example', 'utf8')
    const wrangler = readFileSync('wrangler.toml', 'utf8')
    const runnerClient = envExample.match(/^OIDC_RUNNER_CLIENT_ID=(.+)$/m)?.[1]
    const exampleScopes = envExample.match(/^OIDC_RUNNER_SCOPES=(.+)$/m)?.[1]
    const productionScopes = wrangler.match(/^OIDC_RUNNER_SCOPES = "([^"]+)"$/m)?.[1]

    expect(runnerClient).toBe('replace-with-realmroot-runner-client-id')
    expect(exampleScopes).toBe(productionScopes)
    expect(exampleScopes?.split(' ')).toEqual([
      'openid',
      'profile',
      'email',
      'offline_access',
      'runners:read',
      'runners:write',
      'work-items:read',
      'work-items:write',
      'leases:read',
      'leases:write',
      'sessions:write',
    ])
  })

  it('does not configure a product-specific Bearer client allowlist', () => {
    const wrangler = readFileSync('wrangler.toml', 'utf8')
    expect(wrangler).not.toContain('OIDC_TRUSTED_BEARER_CLIENT_IDS')
    expect(readFileSync('.env.example', 'utf8')).not.toContain('OIDC_TRUSTED_BEARER_CLIENT_IDS')
  })

  it('delegates runner behavior to Features and describes authentication generically', () => {
    const guide = readFileSync('docs/infra/self-hosted-runner.md', 'utf8')

    expect(guide).toContain('OAuth 2.0 and OpenID Connect provider')
    expect(guide).toContain('Realmroot is the current provider.')
    expect(guide.match(/Realmroot/g)).toHaveLength(1)
    expect(guide).toMatch(/\]\(\.\.\/\.\.\/spec\/runners\.feature\)/)
    expect(guide).toMatch(/\]\(\.\.\/\.\.\/spec\/runtime\.feature\)/)
    expect(guide).not.toContain('Loads the saved Realmroot Bearer Context-login profile.')
    expect(guide).not.toContain('device-login profile and DPoP private key')
  })
})
