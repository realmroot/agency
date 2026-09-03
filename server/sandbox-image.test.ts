import { readFileSync } from 'node:fs'
import {
  BUNDLED_REALMROOT_GO_PACKAGE,
  BUNDLED_REALMROOT_VERSION,
  BUNDLED_REALMROOT_WEBI_PACKAGE,
} from '@server/domain/environment'
import { describe, expect, it } from 'vitest'

const dockerfile = readFileSync(new URL('../Dockerfile', import.meta.url), 'utf8')
const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
  dependencies?: Record<string, string>
}
const pnpmLock = readFileSync(new URL('../pnpm-lock.yaml', import.meta.url), 'utf8')
const wrangler = readFileSync(new URL('../wrangler.toml', import.meta.url), 'utf8')

describe('[spec: environments/cloud-packages] Cloud Sandbox image', () => {
  it('keeps the stable Sandbox SDK and image aligned without the unused Agents SDK', () => {
    expect(packageJson.dependencies?.['@cloudflare/sandbox']).toBe('^0.12.9')
    expect(packageJson.dependencies).not.toHaveProperty('agents')
    expect(pnpmLock).toMatch(/'@cloudflare\/sandbox':\n\s+specifier: \^0\.12\.9\n\s+version: 0\.12\.9/)
    expect(dockerfile).toMatch(/^FROM docker\.io\/cloudflare\/sandbox:0\.12\.9$/m)
  })

  it('uses RPC Sandbox transport in production, staging, and e2e deployments', () => {
    expect(wrangler.match(/^SANDBOX_TRANSPORT = "rpc"$/gm)).toHaveLength(3)
  })

  it('installs the pinned linux/amd64 Realmroot release after digest verification', () => {
    expect(dockerfile).toContain(`ARG REALMROOT_VERSION=${BUNDLED_REALMROOT_VERSION}`)
    expect(BUNDLED_REALMROOT_GO_PACKAGE).toBe(`github.com/realmroot/cli@v${BUNDLED_REALMROOT_VERSION}`)
    expect(BUNDLED_REALMROOT_WEBI_PACKAGE).toBe(`realmroot@${BUNDLED_REALMROOT_VERSION}`)
    expect(dockerfile).toContain(
      'ARG REALMROOT_SHA256=51a7d0d8c99a748a4bec8b8778f34659f621952d70756151d726c8c4d480e5da',
    )
    expect(dockerfile).toContain(`asset="realmroot_\${REALMROOT_VERSION}_linux_amd64.tar.gz"`)
    expect(dockerfile).toContain(`https://github.com/realmroot/cli/releases/download/v\${REALMROOT_VERSION}`)
    expect(dockerfile).toContain(`echo "\${REALMROOT_SHA256}  \${asset}" | sha256sum -c -`)

    const verify = dockerfile.indexOf('sha256sum -c -')
    const extract = dockerfile.indexOf(`tar -xzf "\${asset}" -C /usr/local/bin realmroot`)
    expect(verify).toBeGreaterThan(-1)
    expect(extract).toBeGreaterThan(verify)
    expect(dockerfile).toContain('realmroot version')
  })
})
