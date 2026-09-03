import type { Env } from '@server/env'
import { encryptSecretValue } from '@server/vault-crypto'
import { describe, expect, it } from 'vitest'
import { createInboxCallbackTokenCodec } from './inbox-callback-tokens'

const env = { VAULT_ENCRYPTION_KEY: 'inbox-test-encryption-key-with-32-characters' } as Env

describe('[spec: triggers/inbox-provisioning] Inbox callback token encryption', () => {
  it('round-trips a token without placing plaintext in D1 ciphertext', async () => {
    const codec = createInboxCallbackTokenCodec(env)
    const ciphertext = await codec.seal('sub_0123456789abcdef0123456789abcdef', 'callback-secret')
    expect(ciphertext).not.toContain('callback-secret')
    await expect(codec.open('sub_0123456789abcdef0123456789abcdef', ciphertext)).resolves.toBe('callback-secret')
  })

  it('rejects malformed ciphertext, payloads, and cross-Subscription swaps', async () => {
    const codec = createInboxCallbackTokenCodec(env)
    await expect(codec.open('sub_0123456789abcdef0123456789abcdef', 'not-json')).rejects.toThrow(/ciphertext/)
    await expect(codec.open('sub_0123456789abcdef0123456789abcdef', '{}')).rejects.toThrow(/ciphertext/)
    const invalidPayload = JSON.stringify(await encryptSecretValue(env, 'not-json'))
    await expect(codec.open('sub_0123456789abcdef0123456789abcdef', invalidPayload)).rejects.toThrow(/payload/)
    const swapped = await codec.seal('sub_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'callback-secret')
    await expect(codec.open('sub_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', swapped)).rejects.toThrow(/does not match/)
    const missingToken = JSON.stringify(
      await encryptSecretValue(env, JSON.stringify({ subscriptionId: 'sub_0123456789abcdef0123456789abcdef' })),
    )
    await expect(codec.open('sub_0123456789abcdef0123456789abcdef', missingToken)).rejects.toThrow(/does not match/)
  })
})
