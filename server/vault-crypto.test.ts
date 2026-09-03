import { describe, expect, it } from 'vitest'
import type { Env } from './env'
import { decryptSecretValue, encryptSecretValue } from './vault-crypto'

const env = { VAULT_ENCRYPTION_KEY: 'x'.repeat(32) } as unknown as Env

describe('[spec: vaults/encryption] vault credential encryption', () => {
  it('round-trips a value through authenticated AES-GCM encryption', async () => {
    const encrypted = await encryptSecretValue(env, 'raw-secret-token')
    expect(encrypted.algorithm).toBe('AES-GCM')
    await expect(decryptSecretValue(env, encrypted)).resolves.toBe('raw-secret-token')
  })

  it('produces different ciphertext for repeated encryption of the same value', async () => {
    const first = await encryptSecretValue(env, 'raw-secret-token')
    const second = await encryptSecretValue(env, 'raw-secret-token')
    expect(first.ciphertext).not.toBe(second.ciphertext)
    expect(first.iv).not.toBe(second.iv)
  })

  it('fails authenticated decryption for tampered ciphertext with a safe error', async () => {
    const encrypted = await encryptSecretValue(env, 'raw-secret-token')
    const tampered = { ...encrypted, ciphertext: `${encrypted.ciphertext.slice(0, -2)}AA` }
    await expect(decryptSecretValue(env, tampered)).rejects.toThrow(/authenticated decryption/)
  })

  it('never embeds the plaintext value in the stored payload', async () => {
    const encrypted = await encryptSecretValue(env, 'raw-secret-token')
    expect(JSON.stringify(encrypted)).not.toContain('raw-secret-token')
  })
})
