import { calculateJwkThumbprint, decodeJwt, decodeProtectedHeader, importJWK, type JWTPayload, jwtVerify } from 'jose'
import type { Env } from '../env'

const DPOP_PROOF_MAX_AGE_SECONDS = 300
const DPOP_CLOCK_SKEW_SECONDS = 60

export class DpopError extends Error {
  constructor(
    readonly kind: 'invalid_token' | 'invalid_dpop_proof',
    message: string,
  ) {
    super(message)
    this.name = 'DpopError'
  }
}

export interface VerifiedDpopCredential {
  accessToken: string
  payload: JWTPayload & { sub: string }
  proofJti: string
  keyThumbprint: string
  replayExpiresAt: string
}

export function dpopChallenge(error?: DpopError['kind'] | 'insufficient_scope', scope?: string) {
  const parameters = ['algs="ES256"']
  if (error) parameters.push(`error="${error}"`)
  if (scope) parameters.push(`scope="${scope}"`)
  return `DPoP ${parameters.join(', ')}`
}

export function dpopAccessToken(request: Request) {
  const authorization = request.headers.get('authorization')
  const match = authorization?.match(/^DPoP[\t ]+([^\t ]+)[\t ]*$/i)
  if (!match?.[1]) throw new DpopError('invalid_token', 'A DPoP access token is required')
  return match[1]
}

export async function verifyDpopCredential(
  env: Env,
  request: Request,
  verifyAccessToken: (accessToken: string) => Promise<JWTPayload & { sub: string }>,
): Promise<VerifiedDpopCredential> {
  const accessToken = dpopAccessToken(request)
  const explicitE2eMode = env.RUNTIME_MODE === 'test' && env.E2E_TEST_AUTH === 'true'
  if (explicitE2eMode && accessToken.startsWith('e2e')) {
    const proof = request.headers.get('dpop')
    if (proof !== `e2e-proof:${request.method.toUpperCase()}:${normalizedDpopUrl(request.url)}`) {
      throw new DpopError('invalid_dpop_proof', 'The E2E DPoP proof is invalid')
    }
    return {
      accessToken,
      payload: await verifyAccessToken(accessToken),
      proofJti: crypto.randomUUID(),
      keyThumbprint: 'e2e',
      replayExpiresAt: new Date(Date.now() + DPOP_PROOF_MAX_AGE_SECONDS * 1000).toISOString(),
    }
  }

  const proof = request.headers.get('dpop')
  if (!proof) throw new DpopError('invalid_dpop_proof', 'A DPoP proof is required')
  let payload: JWTPayload & { sub: string }
  try {
    payload = await verifyAccessToken(accessToken)
  } catch (cause) {
    throw cause instanceof DpopError ? cause : new DpopError('invalid_token', errorMessage(cause))
  }

  let header: ReturnType<typeof decodeProtectedHeader>
  let proofClaims: JWTPayload
  try {
    header = decodeProtectedHeader(proof)
    proofClaims = decodeJwt(proof)
  } catch (cause) {
    throw new DpopError('invalid_dpop_proof', errorMessage(cause))
  }
  if (header.typ?.toLowerCase() !== 'dpop+jwt' || header.alg !== 'ES256' || !isPublicP256Jwk(header.jwk)) {
    throw new DpopError('invalid_dpop_proof', 'The DPoP proof header is invalid')
  }
  if (typeof proofClaims.jti !== 'string' || !proofClaims.jti || !Number.isInteger(proofClaims.iat)) {
    throw new DpopError('invalid_dpop_proof', 'The DPoP proof omitted replay protection claims')
  }
  const now = Math.floor(Date.now() / 1000)
  const issuedAt = proofClaims.iat as number
  if (issuedAt < now - DPOP_PROOF_MAX_AGE_SECONDS || issuedAt > now + DPOP_CLOCK_SKEW_SECONDS) {
    throw new DpopError('invalid_dpop_proof', 'The DPoP proof is stale')
  }
  if (proofClaims.htm !== request.method.toUpperCase() || proofClaims.htu !== normalizedDpopUrl(request.url)) {
    throw new DpopError('invalid_dpop_proof', 'The DPoP proof target is invalid')
  }
  if (proofClaims.ath !== (await accessTokenHash(accessToken))) {
    throw new DpopError('invalid_dpop_proof', 'The DPoP access-token hash is invalid')
  }

  try {
    const key = await importJWK(header.jwk, 'ES256')
    await jwtVerify(proof, key, { typ: 'dpop+jwt', algorithms: ['ES256'] })
  } catch (cause) {
    throw new DpopError('invalid_dpop_proof', errorMessage(cause))
  }
  const keyThumbprint = await calculateJwkThumbprint(header.jwk)
  if (!hasExactJkt(payload.cnf, keyThumbprint)) {
    throw new DpopError('invalid_token', 'The DPoP key does not match the access token')
  }
  const replayExpiresAt = new Date((issuedAt + DPOP_PROOF_MAX_AGE_SECONDS) * 1000).toISOString()
  await consumeProof(env.DB, String(payload.iss ?? ''), keyThumbprint, proofClaims.jti, replayExpiresAt)
  return { accessToken, payload, proofJti: proofClaims.jti, keyThumbprint, replayExpiresAt }
}

async function consumeProof(db: D1Database, issuer: string, keyThumbprint: string, jti: string, expiresAt: string) {
  const now = new Date().toISOString()
  await db.prepare('DELETE FROM dpop_proofs WHERE expires_at <= ?').bind(now).run()
  const result = await db
    .prepare(
      'INSERT OR IGNORE INTO dpop_proofs (issuer, key_thumbprint, jti, expires_at, consumed_at) VALUES (?, ?, ?, ?, ?)',
    )
    .bind(issuer, keyThumbprint, jti, expiresAt, now)
    .run()
  if (result.meta.changes !== 1) throw new DpopError('invalid_dpop_proof', 'The DPoP proof was already used')
}

function normalizedDpopUrl(value: string) {
  const url = new URL(value)
  url.hash = ''
  url.search = ''
  return url.toString()
}

async function accessTokenHash(accessToken: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(accessToken))
  return base64Url(new Uint8Array(digest))
}

function base64Url(value: Uint8Array) {
  let binary = ''
  for (const byte of value) binary += String.fromCharCode(byte)
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')
}

function isPublicP256Jwk(value: unknown): value is JsonWebKey {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const jwk = value as Record<string, unknown>
  return (
    jwk.kty === 'EC' && jwk.crv === 'P-256' && typeof jwk.x === 'string' && typeof jwk.y === 'string' && !('d' in jwk)
  )
}

function hasExactJkt(value: unknown, expected: string) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const entries = Object.entries(value)
  return entries.length === 1 && entries[0]?.[0] === 'jkt' && entries[0]?.[1] === expected
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'DPoP validation failed'
}
