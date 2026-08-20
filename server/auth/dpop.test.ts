import { calculateJwkThumbprint, exportJWK, generateKeyPair, SignJWT } from 'jose'
import { describe, expect, it } from 'vitest'
import type { Env } from '../env'
import { verifyDpopCredential } from './dpop'

function replayDb() {
  const consumed = new Set<string>()
  return {
    prepare(sql: string) {
      return {
        bind(...params: unknown[]) {
          return {
            async run() {
              if (sql.startsWith('DELETE')) return { meta: { changes: 0 } }
              const key = params.slice(0, 3).join('|')
              if (consumed.has(key)) return { meta: { changes: 0 } }
              consumed.add(key)
              return { meta: { changes: 1 } }
            },
          }
        },
      }
    },
  } as unknown as D1Database
}

async function accessTokenHash(value: string) {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))
  let binary = ''
  for (const byte of digest) binary += String.fromCharCode(byte)
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')
}

async function fixture() {
  const accessToken = 'header.payload.signature'
  const target = 'https://ama.example.com/api/v1/agents/agent_1'
  const { privateKey, publicKey } = await generateKeyPair('ES256', { extractable: true })
  const publicJwk = await exportJWK(publicKey)
  const thumbprint = await calculateJwkThumbprint(publicJwk)
  const payload = { sub: 'user_1', iss: 'https://id.realmroot.dev/api/auth', cnf: { jkt: thumbprint } }
  const env = { DB: replayDb() } as Env
  const request = (proof?: string, authorization = `DPoP ${accessToken}`) =>
    new Request(target, {
      method: 'GET',
      headers: { authorization, ...(proof ? { dpop: proof } : {}) },
    })
  const proof = async (
    overrides: Partial<{ htu: string; htm: string; ath: string; jti: string }> = {},
    signingKey: CryptoKey = privateKey,
    embeddedJwk: JsonWebKey = publicJwk,
  ) =>
    new SignJWT({
      htu: target,
      htm: 'GET',
      ath: await accessTokenHash(accessToken),
      jti: crypto.randomUUID(),
      ...overrides,
    })
      .setProtectedHeader({ typ: 'dpop+jwt', alg: 'ES256', jwk: embeddedJwk })
      .setIssuedAt()
      .sign(signingKey)
  const verify = (candidate: Request) => verifyDpopCredential(env, candidate, async () => payload)
  return { accessToken, env, payload, privateKey, publicJwk, request, proof, target, verify }
}

describe('[spec: auth/dpop] [spec: auth/dpop-proof] Realmroot DPoP proof validation', () => {
  it('rejects Bearer authentication before access-token verification', async () => {
    const subject = await fixture()
    await expect(subject.verify(subject.request(undefined, `Bearer ${subject.accessToken}`))).rejects.toMatchObject({
      kind: 'invalid_token',
    })
  })

  it('rejects a DPoP access token without a proof', async () => {
    const subject = await fixture()
    await expect(subject.verify(subject.request())).rejects.toMatchObject({ kind: 'invalid_dpop_proof' })
  })

  it.each([
    ['htu', { htu: 'https://ama.example.com/api/v1/agents/other' }],
    ['htm', { htm: 'POST' }],
    ['ath', { ath: 'wrong-access-token-hash' }],
  ] as const)('rejects a proof with the wrong %s binding', async (_name, override) => {
    const subject = await fixture()
    await expect(subject.verify(subject.request(await subject.proof(override)))).rejects.toMatchObject({
      kind: 'invalid_dpop_proof',
    })
  })

  it('rejects a proof signed by a key different from its embedded public key', async () => {
    const subject = await fixture()
    const other = await generateKeyPair('ES256')
    await expect(
      subject.verify(subject.request(await subject.proof({}, other.privateKey, subject.publicJwk))),
    ).rejects.toMatchObject({ kind: 'invalid_dpop_proof' })
  })

  it('rejects a proof key that is not bound by the access token cnf.jkt', async () => {
    const subject = await fixture()
    const other = await generateKeyPair('ES256', { extractable: true })
    const otherJwk = await exportJWK(other.publicKey)
    await expect(
      subject.verify(subject.request(await subject.proof({}, other.privateKey, otherJwk))),
    ).rejects.toMatchObject({ kind: 'invalid_token' })
  })

  it('accepts a proof once and rejects replay of the same issuer, key, and jti', async () => {
    const subject = await fixture()
    const proof = await subject.proof({ jti: 'proof-once' })
    await expect(subject.verify(subject.request(proof))).resolves.toMatchObject({ proofJti: 'proof-once' })
    await expect(subject.verify(subject.request(proof))).rejects.toMatchObject({ kind: 'invalid_dpop_proof' })
  })
})
