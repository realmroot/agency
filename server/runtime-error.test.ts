import { describe, expect, it } from 'vitest'
import { EnvironmentPackageInstallationError, safeRuntimeError } from './runtime-error'

describe('safeRuntimeError', () => {
  it('exposes the package step while redacting credentials from bounded diagnostics', () => {
    const diagnostic = `download failed: https://user:password@example.test/archive token=super-secret ${'x'.repeat(3_000)}`

    const safe = safeRuntimeError(new EnvironmentPackageInstallationError('webi-install:realmroot@0.4.2', diagnostic))

    expect(safe).toMatchObject({
      type: 'runtime_error',
      code: 'environment_package_installation_failed',
      detail: { step: 'webi-install:realmroot@0.4.2' },
    })
    expect(safe.detail?.stderr).toContain('https://[redacted]@example.test/archive')
    expect(safe.detail?.stderr).toContain('token=[redacted]')
    expect(safe.detail?.stderr).not.toContain('super-secret')
    expect(safe.detail?.stderr?.length).toBeLessThanOrEqual(2_000)
  })
})
