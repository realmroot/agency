import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Env } from '../../env'

const encryptSecretValueMock = vi.fn()

vi.mock('../../vault-crypto', () => ({
  encryptSecretValue: encryptSecretValueMock,
}))

const { createSecretStoreGateway } = await import('./secret-store')

afterEach(() => {
  encryptSecretValueMock.mockReset()
})

const encryptedValue = { version: 'v1', algorithm: 'AES-GCM', iv: 'aaa', ciphertext: 'bbb' }

function makeEnv(): Env {
  return { VAULT_ENCRYPTION_KEY: 'x'.repeat(32) } as Env
}

describe('[spec: secret-store/gateway] createSecretStoreGateway', () => {
  it('returns a gateway with a store method', () => {
    const gateway = createSecretStoreGateway(makeEnv())
    expect(typeof gateway.store).toBe('function')
  })

  it('throws when stringData is missing', async () => {
    const gateway = createSecretStoreGateway(makeEnv())
    await expect(
      gateway.store(
        {
          provider: 'enbor',
          referenceName: 'MY_KEY',
          secretRef: 'enbor://vaults/vault_1/credentials/cred_1/versions/ver_1',
          hasSecret: true,
          metadata: {},
        },
        {},
      ),
    ).rejects.toThrow(/stringData is required/)
  })

  it('encrypts managed secret values and returns encrypted metadata', async () => {
    encryptSecretValueMock.mockResolvedValue(encryptedValue)
    const gateway = createSecretStoreGateway(makeEnv())
    const result = await gateway.store(
      {
        provider: 'enbor',
        referenceName: 'MY_KEY',
        secretRef: 'enbor://vaults/vault_1/credentials/cred_1/versions/ver_1',
        hasSecret: true,
        metadata: {},
      },
      { stringData: { z: 'last', a: 'first' } },
    )
    expect(result).toEqual({ encryptedSecretData: { a: encryptedValue, z: encryptedValue } })
    expect(encryptSecretValueMock.mock.calls.map((call) => call[1])).toEqual(['first', 'last'])
  })
})
