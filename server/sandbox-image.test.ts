import { readFileSync } from 'node:fs'
import {
  BUNDLED_REALMROOT_GO_PACKAGE,
  BUNDLED_REALMROOT_VERSION,
  BUNDLED_REALMROOT_WEBI_PACKAGE,
} from '@server/domain/environment'
import { describe, expect, it } from 'vitest'

const dockerfile = readFileSync(new URL('../Dockerfile', import.meta.url), 'utf8')

describe('[spec: environments/cloud-packages] Cloud Sandbox image', () => {
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
