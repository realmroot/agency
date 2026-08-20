import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('deployment environment example', () => {
  it('uses the canonical Realmroot OIDC issuer path', () => {
    const envExample = readFileSync('.env.example', 'utf8')
    expect(envExample).toMatch(/^OIDC_ISSUER=https:\/\/id\.realmroot\.dev\/api\/auth$/m)
    expect(envExample).not.toMatch(/^OIDC_ISSUER=https:\/\/id\.realmroot\.dev\/?$/m)
  })
})
