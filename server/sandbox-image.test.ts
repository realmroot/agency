import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const dockerfile = readFileSync(new URL('../Dockerfile', import.meta.url), 'utf8')

describe('[spec: environments/cloud-packages] Cloud Sandbox image', () => {
  it('installs the pinned Realmroot release for the target architecture after checksum verification', () => {
    expect(dockerfile).toContain('ARG REALMROOT_VERSION=0.4.2')
    expect(dockerfile).toContain('ARG TARGETARCH')
    expect(dockerfile).toContain(`case "\${TARGETARCH}" in amd64|arm64)`)
    expect(dockerfile).toContain(`asset="realmroot_\${REALMROOT_VERSION}_linux_\${TARGETARCH}.tar.gz"`)
    expect(dockerfile).toContain(`https://github.com/realmroot/cli/releases/download/v\${REALMROOT_VERSION}`)
    expect(dockerfile).toContain(`"\${release}/checksums.txt"`)
    expect(dockerfile).toContain(`awk -v asset="\${asset}" '$2 == asset { print }'`)
    expect(dockerfile).toContain('sha256sum -c realmroot.sha256')

    const verify = dockerfile.indexOf('sha256sum -c realmroot.sha256')
    const extract = dockerfile.indexOf(`tar -xzf "\${asset}" -C /usr/local/bin realmroot`)
    expect(verify).toBeGreaterThan(-1)
    expect(extract).toBeGreaterThan(verify)
    expect(dockerfile).toContain('realmroot version')
  })
})
