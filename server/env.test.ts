import { describe, expect, it } from 'vitest'
import { fakeRealmrootEnrollmentEnabled } from './env'

describe('fakeRealmrootEnrollmentEnabled', () => {
  it('does not replace the real gateway for test runtime by default', () => {
    expect(fakeRealmrootEnrollmentEnabled({})).toBe(false)
    expect(fakeRealmrootEnrollmentEnabled({ AMA_E2E_TEST_AUTH: 'true' })).toBe(false)
    expect(fakeRealmrootEnrollmentEnabled({ AMA_E2E_FAKE_REALMROOT_ENROLLMENT: 'true' })).toBe(false)
  })

  it('requires both hermetic E2E gates', () => {
    expect(
      fakeRealmrootEnrollmentEnabled({
        AMA_E2E_TEST_AUTH: 'true',
        AMA_E2E_FAKE_REALMROOT_ENROLLMENT: 'true',
      }),
    ).toBe(true)
  })
})
