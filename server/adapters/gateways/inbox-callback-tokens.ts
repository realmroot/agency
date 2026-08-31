import type { Env } from '@server/env'
import type { InboxCallbackTokenCodec } from '@server/usecases/ports'
import { decryptSecretValue, encryptSecretValue } from '@server/vault-crypto'

interface CallbackTokenPayload {
  subscriptionId: string
  token: string
}

export function createInboxCallbackTokenCodec(env: Env): InboxCallbackTokenCodec {
  return {
    async seal(subscriptionId, token) {
      return JSON.stringify(await encryptSecretValue(env, JSON.stringify({ subscriptionId, token })))
    },

    async open(subscriptionId, ciphertext) {
      let encrypted: unknown
      try {
        encrypted = JSON.parse(ciphertext)
      } catch {
        throw new Error('Inbox callback token ciphertext is invalid')
      }
      const plaintext = await decryptSecretValue(env, encrypted)
      if (!plaintext) throw new Error('Inbox callback token ciphertext is invalid')
      let payload: CallbackTokenPayload
      try {
        payload = JSON.parse(plaintext) as CallbackTokenPayload
      } catch {
        throw new Error('Inbox callback token payload is invalid')
      }
      if (payload.subscriptionId !== subscriptionId || typeof payload.token !== 'string' || !payload.token) {
        throw new Error('Inbox callback token payload does not match the Subscription')
      }
      return payload.token
    },
  }
}
