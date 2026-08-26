import type { Context, Env as HonoEnv } from 'hono'
import { createRemoteJWKSet, decodeProtectedHeader, jwtVerify } from 'jose'
import type { Env } from '../env'
import { getBearerClaimsForAudience, oidcAudience, type UserInfoClaims } from './oidc'

const SESSION_COOKIE = 'ama_session'
const LOGIN_COOKIE = 'ama_login'
const SESSION_TTL_SECONDS = 8 * 60 * 60
const LOGIN_TTL_SECONDS = 10 * 60
const REFRESH_WINDOW_MS = 60_000

type AppContext<E extends HonoEnv = { Bindings: Env }> = Context<E & { Bindings: Env }>
type Metadata = {
  issuer: string
  authorization_endpoint: string
  token_endpoint: string
  jwks_uri: string
  end_session_endpoint?: string
  revocation_endpoint?: string
}
type Tokens = {
  access_token?: string
  refresh_token?: string
  expires_in?: number
  id_token?: string
  token_type?: string
}
type Stored = {
  id: string
  auth_json: string
  csrf_token: string
  expires_at: string
  rr_refresh_ciphertext: string
  rr_refresh_nonce: string
  rr_access_ciphertext: string
  rr_access_nonce: string
  rr_access_expires_at: string
}

const metadataCache = new Map<string, { value: Metadata; expiresAt: number }>()
const jwksCache = new Map<string, ReturnType<typeof createRemoteJWKSet>>()

function required(value: string | undefined, name: string) {
  if (!value?.trim()) throw new Error(`${name} is required`)
  return value.trim()
}

function randomToken(bytes = 32) {
  const value = crypto.getRandomValues(new Uint8Array(bytes))
  return base64Url(value)
}

function base64Url(value: Uint8Array) {
  let binary = ''
  for (const byte of value) binary += String.fromCharCode(byte)
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
}

function fromBase64Url(value: string) {
  const normalized = value
    .replaceAll('-', '+')
    .replaceAll('_', '/')
    .padEnd(Math.ceil(value.length / 4) * 4, '=')
  return Uint8Array.from(atob(normalized), (character) => character.charCodeAt(0))
}

async function sha256(value: string) {
  return base64Url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))))
}

async function encryptionKey(env: Env) {
  const raw = required(env.AMA_WEB_SESSION_ENCRYPTION_KEY, 'AMA_WEB_SESSION_ENCRYPTION_KEY')
  const bytes = fromBase64Url(raw)
  if (bytes.byteLength !== 32) throw new Error('AMA_WEB_SESSION_ENCRYPTION_KEY must encode 32 bytes')
  return await crypto.subtle.importKey('raw', bytes, 'AES-GCM', false, ['encrypt', 'decrypt'])
}

async function encrypt(env: Env, value: string) {
  const nonce = crypto.getRandomValues(new Uint8Array(12))
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: nonce },
    await encryptionKey(env),
    new TextEncoder().encode(value),
  )
  return { ciphertext: base64Url(new Uint8Array(ciphertext)), nonce: base64Url(nonce) }
}

async function decrypt(env: Env, ciphertext: string, nonce: string) {
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: fromBase64Url(nonce) },
    await encryptionKey(env),
    fromBase64Url(ciphertext),
  )
  return new TextDecoder().decode(plaintext)
}

async function discover(env: Env) {
  const issuer = required(env.OIDC_ISSUER, 'OIDC_ISSUER').replace(/\/$/, '')
  const cached = metadataCache.get(issuer)
  if (cached && cached.expiresAt > Date.now()) return cached.value
  const response = await fetch(`${issuer}/.well-known/openid-configuration`, {
    headers: { accept: 'application/json' },
  })
  if (!response.ok) throw new Error(`Realmroot discovery returned ${response.status}`)
  const metadata = (await response.json()) as Metadata
  if (
    metadata.issuer !== issuer ||
    !metadata.authorization_endpoint ||
    !metadata.token_endpoint ||
    !metadata.jwks_uri
  ) {
    throw new Error('Realmroot discovery is invalid')
  }
  metadataCache.set(issuer, { value: metadata, expiresAt: Date.now() + 10 * 60 * 1000 })
  return metadata
}

function clientAuthorization(env: Env) {
  return `Basic ${btoa(`${required(env.OIDC_CLIENT_ID, 'OIDC_CLIENT_ID')}:${required(env.OIDC_CLIENT_SECRET, 'OIDC_CLIENT_SECRET')}`)}`
}

function managementResource(env: Env) {
  return env.REALMROOT_MANAGEMENT_RESOURCE?.trim() || `${new URL(required(env.OIDC_ISSUER, 'OIDC_ISSUER')).origin}/api`
}

async function exchangeRefresh(env: Env, metadata: Metadata, refreshToken: string) {
  const response = await fetch(metadata.token_endpoint, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      authorization: clientAuthorization(env),
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      resource: managementResource(env),
      scope: 'agents:write',
    }),
  })
  const body = (await response.json().catch(() => null)) as Tokens | null
  if (!response.ok || !body?.access_token || !body.refresh_token || body.token_type?.toLowerCase() !== 'bearer')
    throw new Error('Realmroot management grant exchange failed')
  return body
}

async function validateManagementToken(env: Env, stored: Pick<Stored, 'auth_json'>, accessToken: string) {
  const claims = await getBearerClaimsForAudience(env, accessToken, managementResource(env))
  const signedIn = JSON.parse(stored.auth_json) as UserInfoClaims
  const clientId = claims.client_id ?? claims.azp
  if (claims.sub !== signedIn.sub || clientId !== required(env.OIDC_CLIENT_ID, 'OIDC_CLIENT_ID')) {
    throw new Error('Realmroot management grant changed subject or Application')
  }
  if (!claims.permissions.includes('agents:write')) {
    throw new Error('Realmroot management grant omitted agents:write')
  }
}

async function verifyIdToken(env: Env, metadata: Metadata, token: string, nonce: string) {
  if (decodeProtectedHeader(token).typ === 'at+jwt') throw new Error('Realmroot ID token type is invalid')
  let jwks = jwksCache.get(metadata.jwks_uri)
  if (!jwks) {
    jwks = createRemoteJWKSet(new URL(metadata.jwks_uri))
    jwksCache.set(metadata.jwks_uri, jwks)
  }
  const result = await jwtVerify(token, jwks, {
    issuer: metadata.issuer,
    audience: required(env.OIDC_CLIENT_ID, 'OIDC_CLIENT_ID'),
  })
  if (result.payload.nonce !== nonce || typeof result.payload.sub !== 'string')
    throw new Error('Realmroot ID token is invalid')
  return result.payload
}

function cookie(name: string, value: string, maxAge: number) {
  return `${name}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`
}

function expireCookie(name: string) {
  return `${name}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`
}

function readCookie(header: string | undefined, name: string) {
  for (const item of (header ?? '').split(';')) {
    const [key, ...parts] = item.trim().split('=')
    if (key === name) return parts.join('=')
  }
  return null
}

function returnTo(value: string | undefined) {
  return value?.startsWith('/') && !value.startsWith('//') ? value : '/'
}

export async function beginWebLogin<E extends HonoEnv>(c: AppContext<E>) {
  const metadata = await discover(c.env)
  const attemptId = randomToken()
  const state = randomToken()
  const nonce = randomToken()
  const verifier = randomToken(48)
  const expiresAt = new Date(Date.now() + LOGIN_TTL_SECONDS * 1000).toISOString()
  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM web_auth_attempts WHERE expires_at <= ?').bind(new Date().toISOString()),
    c.env.DB.prepare(
      'INSERT INTO web_auth_attempts (id_hash,state_hash,nonce,pkce_verifier,return_to,expires_at) VALUES (?,?,?,?,?,?)',
    ).bind(await sha256(attemptId), await sha256(state), nonce, verifier, returnTo(c.req.query('returnTo')), expiresAt),
  ])
  const url = new URL(metadata.authorization_endpoint)
  url.searchParams.set('client_id', required(c.env.OIDC_CLIENT_ID, 'OIDC_CLIENT_ID'))
  url.searchParams.set('redirect_uri', new URL('/api/v1/auth/callback', c.req.url).toString())
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('scope', required(c.env.OIDC_BROWSER_SCOPES, 'OIDC_BROWSER_SCOPES'))
  url.searchParams.set('state', state)
  url.searchParams.set('nonce', nonce)
  url.searchParams.set('code_challenge', await sha256(verifier))
  url.searchParams.set('code_challenge_method', 'S256')
  url.searchParams.append('resource', oidcAudience(c.env, c.req.url))
  url.searchParams.append('resource', managementResource(c.env))
  return new Response(null, {
    status: 302,
    headers: { location: url.toString(), 'set-cookie': cookie(LOGIN_COOKIE, attemptId, LOGIN_TTL_SECONDS) },
  })
}

export async function finishWebLogin<E extends HonoEnv>(c: AppContext<E>) {
  const attemptId = readCookie(c.req.header('cookie'), LOGIN_COOKIE)
  const code = c.req.query('code')
  const state = c.req.query('state')
  if (!attemptId || !code || !state) return new Response('Invalid sign-in callback', { status: 400 })
  const attempt = await c.env.DB.prepare(
    'DELETE FROM web_auth_attempts WHERE id_hash=? AND state_hash=? AND expires_at>? RETURNING nonce,pkce_verifier,return_to',
  )
    .bind(await sha256(attemptId), await sha256(state), new Date().toISOString())
    .first<{
      nonce: string
      pkce_verifier: string
      return_to: string
    }>()
  if (!attempt) return new Response('Expired or replayed sign-in callback', { status: 400 })
  const metadata = await discover(c.env)
  const tokenResponse = await fetch(metadata.token_endpoint, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      authorization: clientAuthorization(c.env),
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: new URL('/api/v1/auth/callback', c.req.url).toString(),
      code_verifier: attempt.pkce_verifier,
      resource: oidcAudience(c.env, c.req.url),
    }),
  })
  const tokens = (await tokenResponse.json().catch(() => null)) as Tokens | null
  if (
    !tokenResponse.ok ||
    !tokens?.id_token ||
    !tokens.access_token ||
    !tokens.refresh_token ||
    tokens.token_type?.toLowerCase() !== 'bearer'
  ) {
    return new Response('Realmroot token exchange failed', { status: 502 })
  }
  await verifyIdToken(c.env, metadata, tokens.id_token, attempt.nonce)
  const claims = await getBearerClaimsForAudience(c.env, tokens.access_token, oidcAudience(c.env, c.req.url))
  // Preserve the rotated confidential-web refresh credential. Realmroot Agent
  // management is exchanged lazily only by create/delete Agent workflows.
  const encryptedRefresh = await encrypt(c.env, tokens.refresh_token)
  const encryptedAccess = await encrypt(c.env, '')
  const sessionToken = randomToken(48)
  const sessionId = crypto.randomUUID()
  const csrf = randomToken()
  const expiresAt = new Date(Date.now() + SESSION_TTL_SECONDS * 1000).toISOString()
  const accessExpiresAt = new Date(0).toISOString()
  await c.env.DB.prepare(
    `INSERT INTO web_sessions
      (id,token_hash,auth_json,csrf_token,expires_at,rr_refresh_ciphertext,rr_refresh_nonce,rr_access_ciphertext,rr_access_nonce,rr_access_expires_at)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
  )
    .bind(
      sessionId,
      await sha256(sessionToken),
      JSON.stringify(claims),
      csrf,
      expiresAt,
      encryptedRefresh.ciphertext,
      encryptedRefresh.nonce,
      encryptedAccess.ciphertext,
      encryptedAccess.nonce,
      accessExpiresAt,
    )
    .run()
  const headers = new Headers({ location: new URL(attempt.return_to, c.req.url).toString() })
  headers.append('set-cookie', cookie(SESSION_COOKIE, sessionToken, SESSION_TTL_SECONDS))
  headers.append('set-cookie', expireCookie(LOGIN_COOKIE))
  return new Response(null, { status: 302, headers })
}

async function storedSession<E extends HonoEnv>(c: AppContext<E>) {
  const token = readCookie(c.req.header('cookie'), SESSION_COOKIE)
  if (!token) return null
  return await c.env.DB.prepare(
    `SELECT id,auth_json,csrf_token,expires_at,rr_refresh_ciphertext,rr_refresh_nonce,
            rr_access_ciphertext,rr_access_nonce,rr_access_expires_at
     FROM web_sessions WHERE token_hash=? AND expires_at>?`,
  )
    .bind(await sha256(token), new Date().toISOString())
    .first<Stored>()
}

async function managementAuthorization(env: Env, stored: Stored) {
  if (Date.parse(stored.rr_access_expires_at) - REFRESH_WINDOW_MS > Date.now()) {
    const accessToken = await decrypt(env, stored.rr_access_ciphertext, stored.rr_access_nonce)
    await validateManagementToken(env, stored, accessToken)
    return `Bearer ${accessToken}`
  }
  const refresh = await decrypt(env, stored.rr_refresh_ciphertext, stored.rr_refresh_nonce)
  const tokens = await exchangeRefresh(env, await discover(env), refresh)
  const encryptedRefresh = await encrypt(env, tokens.refresh_token!)
  const encryptedAccess = await encrypt(env, tokens.access_token!)
  const expiresAt = new Date(Date.now() + Math.max(1, tokens.expires_in ?? 300) * 1000).toISOString()
  const updated = await env.DB.prepare(
    `UPDATE web_sessions SET rr_refresh_ciphertext=?,rr_refresh_nonce=?,rr_access_ciphertext=?,rr_access_nonce=?,rr_access_expires_at=?
     WHERE id=? AND rr_refresh_ciphertext=?`,
  )
    .bind(
      encryptedRefresh.ciphertext,
      encryptedRefresh.nonce,
      encryptedAccess.ciphertext,
      encryptedAccess.nonce,
      expiresAt,
      stored.id,
      stored.rr_refresh_ciphertext,
    )
    .run()
  if ((updated.meta.changes ?? 0) === 0) {
    const current = await env.DB.prepare(
      'SELECT rr_access_ciphertext,rr_access_nonce,rr_access_expires_at FROM web_sessions WHERE id=?',
    )
      .bind(stored.id)
      .first<Pick<Stored, 'rr_access_ciphertext' | 'rr_access_nonce' | 'rr_access_expires_at'>>()
    if (!current || Date.parse(current.rr_access_expires_at) <= Date.now()) {
      throw new Error('Realmroot management refresh rotation conflicted')
    }
    const accessToken = await decrypt(env, current.rr_access_ciphertext, current.rr_access_nonce)
    await validateManagementToken(env, stored, accessToken)
    return `Bearer ${accessToken}`
  }
  await validateManagementToken(env, stored, tokens.access_token!)
  return `Bearer ${tokens.access_token}`
}

export async function resolveWebSession<E extends HonoEnv>(c: AppContext<E>) {
  const stored = await storedSession(c)
  if (!stored) return null
  if (!['GET', 'HEAD', 'OPTIONS'].includes(c.req.method.toUpperCase())) {
    const csrf = c.req.header('x-csrf-token')
    if (!csrf || csrf !== stored.csrf_token) throw new WebCsrfError()
  }
  return {
    claims: JSON.parse(stored.auth_json) as UserInfoClaims,
    csrfToken: stored.csrf_token,
    sessionId: stored.id,
  }
}

export async function managementAuthorizationForWebSession(env: Env, sessionId: string) {
  const stored = await env.DB.prepare(
    `SELECT id,auth_json,csrf_token,expires_at,rr_refresh_ciphertext,rr_refresh_nonce,
            rr_access_ciphertext,rr_access_nonce,rr_access_expires_at
     FROM web_sessions WHERE id=? AND expires_at>?`,
  )
    .bind(sessionId, new Date().toISOString())
    .first<Stored>()
  if (!stored) throw new Error('Realmroot Agent management authority is required')
  return await managementAuthorization(env, stored)
}

export async function readWebSession<E extends HonoEnv>(c: AppContext<E>) {
  const session = await resolveWebSession(c)
  if (!session) return null
  const claims = session.claims
  return {
    csrfToken: session.csrfToken,
    user: { id: claims.sub, email: claims.email ?? '', name: claims.name ?? null },
  }
}

export async function endWebSession<E extends HonoEnv>(c: AppContext<E>) {
  const stored = await storedSession(c)
  if (!stored) return new Response(null, { status: 204, headers: { 'set-cookie': expireCookie(SESSION_COOKIE) } })
  if (c.req.header('x-csrf-token') !== stored.csrf_token) throw new WebCsrfError()
  const refresh = await decrypt(c.env, stored.rr_refresh_ciphertext, stored.rr_refresh_nonce).catch(() => null)
  await c.env.DB.prepare('DELETE FROM web_sessions WHERE id=?').bind(stored.id).run()
  if (refresh) {
    const metadata = await discover(c.env).catch(() => null)
    if (metadata?.revocation_endpoint) {
      await fetch(metadata.revocation_endpoint, {
        method: 'POST',
        headers: { authorization: clientAuthorization(c.env), 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ token: refresh, token_type_hint: 'refresh_token' }),
      }).catch(() => null)
    }
  }
  return new Response(null, { status: 204, headers: { 'set-cookie': expireCookie(SESSION_COOKIE) } })
}

export class WebCsrfError extends Error {
  constructor() {
    super('Invalid CSRF token')
  }
}
