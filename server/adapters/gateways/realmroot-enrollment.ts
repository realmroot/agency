import type { IdentityCheckpoint, IdentityDescriptor, IdentityRuntime } from '@server/domain/identity'
import type { Env } from '@server/env'
import { newPrimaryKey } from '@server/id'
import type { RealmrootEnrollmentGateway, RealmrootManagementCredential } from '@server/usecases/ports'
import { exportJWK, generateKeyPair, importJWK, type JWK, SignJWT } from 'jose'

type Configuration = {
  issuer: string
  agent_identity_issuer: string
  agent_endpoint: string
  agent_token_endpoint: string
}

type PrivateState = Record<string, unknown> & {
  version: 18
  origin: string
  issuer: string
  runtime: string
  name: string
  agent_id: string
  host_id: string
  agent_key_id: string
  agent_private_key: string
  enrollment_idempotency_key: string
}

function base64Url(bytes: Uint8Array) {
  let value = ''
  for (const byte of bytes) value += String.fromCharCode(byte)
  return btoa(value).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
}

function decodeBase64Url(value: string) {
  const binary = atob(
    value
      .replaceAll('-', '+')
      .replaceAll('_', '/')
      .padEnd(Math.ceil(value.length / 4) * 4, '='),
  )
  return Uint8Array.from(binary, (character) => character.charCodeAt(0))
}

function safeOrigin(value: string) {
  const url = new URL(value)
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
    throw new Error('Realmroot origin must be a safe HTTPS URL')
  }
  return url.origin
}

async function requestJson(url: string, init: RequestInit) {
  const response = await fetch(url, {
    ...init,
    headers: {
      accept: 'application/json',
      ...(init.body ? { 'content-type': 'application/json' } : {}),
      ...init.headers,
    },
    signal: AbortSignal.timeout(15_000),
  })
  if (!response.ok) throw new Error(`Realmroot request failed with status ${response.status}`)
  return (await response.json()) as unknown
}

async function discover(origin: string): Promise<Configuration> {
  const normalized = safeOrigin(origin)
  const value = (await requestJson(`${normalized}/.well-known/agent-configuration`, { method: 'GET' })) as Configuration
  if (value.issuer !== value.agent_identity_issuer) {
    throw new Error('Realmroot Agent discovery is incompatible')
  }
  for (const endpoint of [value.issuer, value.agent_endpoint, value.agent_token_endpoint]) {
    if (safeOrigin(endpoint) !== normalized) throw new Error('Realmroot Agent discovery crossed an origin boundary')
  }
  return value
}

function installationJwk(state: PrivateState): JWK {
  const bytes = decodeBase64Url(state.agent_private_key)
  return {
    kty: 'OKP',
    crv: 'Ed25519',
    x: base64Url(bytes.slice(32)),
    kid: state.agent_key_id,
    alg: 'EdDSA',
    use: 'sig',
  }
}

function signingJwk(state: PrivateState): JWK {
  const bytes = decodeBase64Url(state.agent_private_key)
  return {
    kty: 'OKP',
    crv: 'Ed25519',
    d: base64Url(bytes.slice(0, 32)),
    x: base64Url(bytes.slice(32)),
    kid: state.agent_key_id,
  }
}

async function initializeState(input: { origin: string; name: string; runtime: string; idempotencyKey: string }) {
  const pair = await generateKeyPair('EdDSA', { extractable: true })
  const jwk = await exportJWK(pair.privateKey)
  if (!jwk.d || !jwk.x) throw new Error('Generated Ed25519 key is not exportable')
  const privateBytes = new Uint8Array([...decodeBase64Url(jwk.d), ...decodeBase64Url(jwk.x)])
  return {
    version: 18,
    origin: safeOrigin(input.origin),
    issuer: '',
    runtime: input.runtime,
    name: input.name,
    agent_id: newPrimaryKey(),
    host_id: newPrimaryKey(),
    agent_key_id: newPrimaryKey(),
    agent_private_key: base64Url(privateBytes),
    enrollment_idempotency_key: input.idempotencyKey,
  } satisfies PrivateState
}

function identity(value: unknown, expected: { issuer: string; username: string; runtime: IdentityRuntime }) {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Realmroot Agent response is invalid')
  const agent = value as Record<string, unknown>
  if (
    typeof agent.id !== 'string' ||
    agent.issuer !== expected.issuer ||
    typeof agent.subject !== 'string' ||
    agent.username !== expected.username ||
    agent.runtime !== expected.runtime ||
    agent.status !== 'active'
  )
    throw new Error('Realmroot Agent response does not match the requested Identity')
  const descriptor: Omit<IdentityDescriptor, 'identityId' | 'credentialRef'> = {
    agentId: agent.id,
    issuer: agent.issuer,
    subject: agent.subject,
    username: agent.username,
    runtime: expected.runtime,
  }
  return descriptor
}

async function createRemote(
  config: Configuration,
  state: PrivateState,
  input: { username: string; name: string; runtime: IdentityRuntime; credential: RealmrootManagementCredential },
) {
  const url = `${new URL(config.issuer).origin}/api/agents`
  const value = await requestJson(url, {
    method: 'POST',
    headers: { ...(await input.credential.headers('POST', url)), 'idempotency-key': state.enrollment_idempotency_key },
    body: JSON.stringify({
      username: input.username,
      name: input.name,
      runtime: input.runtime,
      installation: {
        agentId: state.agent_id,
        hostId: state.host_id,
        name: 'Any Managed Agents',
        kid: state.agent_key_id,
        publicKey: installationJwk(state),
      },
    }),
  })
  return identity(value, { issuer: config.agent_identity_issuer, username: input.username, runtime: input.runtime })
}

async function assertion(state: PrivateState, audience: string) {
  return await new SignJWT({})
    .setProtectedHeader({ alg: 'EdDSA', typ: 'agent+jwt', kid: state.agent_key_id })
    .setIssuer(state.host_id)
    .setSubject(state.agent_id)
    .setAudience(audience)
    .setIssuedAt()
    .setExpirationTime('2m')
    .setJti(crypto.randomUUID())
    .sign(await importJWK(signingJwk(state), 'EdDSA'))
}

async function dpop(jwk: JWK, method: string, url: string, token?: string) {
  const claims: Record<string, unknown> = { htm: method, htu: url }
  if (token)
    claims.ath = base64Url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))))
  const publicJwk = { ...jwk }
  delete publicJwk.d
  return await new SignJWT(claims)
    .setProtectedHeader({ typ: 'dpop+jwt', alg: 'ES256', jwk: publicJwk })
    .setIssuedAt()
    .setJti(crypto.randomUUID())
    .sign(await importJWK(jwk, 'ES256'))
}

async function prove(
  config: Configuration,
  state: PrivateState,
  expected: Omit<IdentityDescriptor, 'identityId' | 'credentialRef'>,
) {
  const pair = await generateKeyPair('ES256', { extractable: true })
  const jwk = await exportJWK(pair.privateKey)
  const tokenResponse = await fetch(config.agent_token_endpoint, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/x-www-form-urlencoded',
      dpop: await dpop(jwk, 'POST', config.agent_token_endpoint),
    },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: await assertion(state, config.issuer),
      resource: `${new URL(config.issuer).origin}/api`,
      scope: 'agent:read',
    }),
    signal: AbortSignal.timeout(15_000),
  })
  const token = (await tokenResponse.json().catch(() => null)) as {
    access_token?: string
    token_type?: string
    expires_in?: number
  } | null
  if (!tokenResponse.ok || !token?.access_token || token.token_type !== 'DPoP')
    throw new Error('Realmroot Agent self-proof token failed')
  const value = (await requestJson(config.agent_endpoint, {
    method: 'GET',
    headers: {
      authorization: `DPoP ${token.access_token}`,
      dpop: await dpop(jwk, 'GET', config.agent_endpoint, token.access_token),
    },
  })) as Record<string, unknown>
  const asserted = identity(value.agent ?? value, {
    issuer: expected.issuer,
    username: expected.username,
    runtime: expected.runtime,
  })
  if (asserted.agentId !== expected.agentId || asserted.subject !== expected.subject)
    throw new Error('Realmroot authenticated Agent does not match the created Agent')
  state.identity = {
    id: asserted.agentId,
    issuer: asserted.issuer,
    subject: asserted.subject,
    username: asserted.username,
    name: state.name,
    runtime: asserted.runtime,
  }
  state.protocol_credential = {
    resource_indicator: `${new URL(config.issuer).origin}/api`,
    credential_endpoint: config.agent_token_endpoint,
    proof_target: config.agent_token_endpoint,
    private_key: jwk.d,
    access_token: token.access_token,
    expires_at: new Date(Date.now() + Math.max(1, token.expires_in ?? 300) * 1000).toISOString(),
    scopes: ['agent:read'],
  }
  return asserted
}

export function createRealmrootEnrollmentGateway(env?: Env): RealmrootEnrollmentGateway {
  const fake = env?.AMA_E2E_TEST_AUTH === 'true' && env.AMA_E2E_FAKE_REALMROOT_ENROLLMENT === 'true'
  return {
    async initialize(input) {
      const state = await initializeState(input)
      state.issuer = `${safeOrigin(input.origin)}/api/auth`
      return { version: 1, stage: 'initialized', state, remote: null }
    },
    async provision(input) {
      if (input.checkpoint.stage === 'enrolled' && input.checkpoint.remote) {
        return { checkpoint: input.checkpoint, descriptor: input.checkpoint.remote }
      }
      const state = input.checkpoint.state as PrivateState
      if (state.runtime !== input.runtime || state.enrollment_idempotency_key !== input.idempotencyKey)
        throw new Error('Identity checkpoint does not match the request')
      if (fake) {
        const descriptor = {
          agentId: state.agent_id,
          issuer: state.issuer,
          subject: state.agent_id,
          username: input.username,
          runtime: input.runtime,
        }
        state.identity = {
          id: descriptor.agentId,
          issuer: descriptor.issuer,
          subject: descriptor.subject,
          username: descriptor.username,
          name: state.name,
          runtime: descriptor.runtime,
        }
        state.protocol_credential = {
          resource_indicator: `${safeOrigin(input.origin)}/api`,
          credential_endpoint: `${safeOrigin(input.origin)}/api/credentials`,
          proof_target: `${safeOrigin(input.origin)}/api/credentials`,
          private_key: base64Url(new Uint8Array(32).fill(7)),
          access_token: 'e2e-fixture-token',
          expires_at: new Date(Date.now() + 300_000).toISOString(),
          scopes: ['agent:read'],
        }
        const checkpoint: IdentityCheckpoint = { version: 1, stage: 'enrolled', state, remote: descriptor }
        await input.onCheckpoint(checkpoint)
        return { checkpoint, descriptor }
      }
      const config = await discover(input.origin)
      state.issuer = config.agent_identity_issuer
      const created = await createRemote(config, state, {
        username: input.username,
        name: input.name,
        runtime: input.runtime,
        credential: input.managementCredential,
      })
      const asserted = await prove(config, state, created)
      const checkpoint: IdentityCheckpoint = { version: 1, stage: 'enrolled', state, remote: asserted }
      await input.onCheckpoint(checkpoint)
      return { checkpoint, descriptor: asserted }
    },
  }
}
