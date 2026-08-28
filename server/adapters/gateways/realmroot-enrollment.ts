import type { RealmrootEnrollmentGateway, RealmrootEnrollmentIdentity } from '@server/usecases/ports'
import type { RuntimeName } from '@shared/runtime-types'
import { exportJWK, generateKeyPair, importJWK, type JWK, SignJWT } from 'jose'

type AgentConfiguration = {
  version: '1.0-draft'
  issuer: string
  algorithms: string[]
  agent_identity_issuer: string
  agent_endpoint: string
  agent_token_endpoint: string
}

type PendingState = Record<string, unknown> & {
  version: 18
  origin: string
  issuer: string
  runtime: RuntimeName
  name: string
  agent_id: string
  host_id: string
  agent_key_id: string
  agent_private_key: string
  enrollment_idempotency_key: string
  identity?: RealmrootEnrollmentIdentity
  protocol_credential?: Record<string, unknown>
}

function sameOrigin(left: string, right: string) {
  return new URL(left).origin === new URL(right).origin
}

async function jsonRequest<T>(url: string, init: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      accept: 'application/json',
      ...(init.body ? { 'content-type': 'application/json' } : {}),
      ...init.headers,
    },
    signal: AbortSignal.timeout(15_000),
  })
  if (!response.ok) {
    const problem = await response.text()
    throw new Error(`Realmroot ${new URL(url).pathname} returned ${response.status}: ${problem.slice(0, 400)}`)
  }
  return (await response.json()) as T
}

async function configuration(origin: string): Promise<AgentConfiguration> {
  const config = await jsonRequest<AgentConfiguration>(`${origin.replace(/\/$/, '')}/.well-known/agent-configuration`, {
    method: 'GET',
  })
  if (
    config.version !== '1.0-draft' ||
    config.issuer !== config.agent_identity_issuer ||
    !config.algorithms.includes('Ed25519') ||
    !sameOrigin(config.issuer, origin)
  ) {
    throw new Error('Realmroot Agent discovery is incompatible')
  }
  for (const endpoint of [config.agent_endpoint, config.agent_token_endpoint]) {
    if (!sameOrigin(endpoint, origin)) throw new Error('Realmroot Agent discovery crossed an origin boundary')
  }
  return config
}

function randomId(prefix: string) {
  return `${prefix}-${crypto.randomUUID()}`
}

function base64Url(bytes: Uint8Array) {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
}

function ed25519StatePrivate(jwk: JWK) {
  if (!jwk.d || !jwk.x) throw new Error('Generated Ed25519 key is not exportable')
  const decode = (value: string) => {
    const binary = atob(
      value
        .replaceAll('-', '+')
        .replaceAll('_', '/')
        .padEnd(Math.ceil(value.length / 4) * 4, '='),
    )
    return Uint8Array.from(binary, (character) => character.charCodeAt(0))
  }
  const seed = decode(jwk.d)
  const publicKey = decode(jwk.x)
  const value = new Uint8Array(seed.length + publicKey.length)
  value.set(seed)
  value.set(publicKey, seed.length)
  return base64Url(value)
}

async function signedJwt(jwk: JWK, kid: string, type: string, claims: Record<string, unknown>) {
  const key = await importJWK(jwk, 'EdDSA')
  return await new SignJWT(claims)
    .setProtectedHeader({ alg: 'EdDSA', typ: type, kid })
    .setIssuedAt()
    .setExpirationTime('2m')
    .setJti(crypto.randomUUID())
    .sign(key)
}

async function agentAssertion(state: PendingState, audience: string) {
  const privateBytes = decodeBase64Url(state.agent_private_key)
  const seed = privateBytes.slice(0, 32)
  const publicKey = privateBytes.slice(32)
  const jwk: JWK = {
    kty: 'OKP',
    crv: 'Ed25519',
    d: base64Url(seed),
    x: base64Url(publicKey),
    kid: state.agent_key_id,
  }
  return await signedJwt(jwk, state.agent_key_id, 'agent+jwt', {
    iss: state.host_id,
    sub: state.agent_id,
    aud: audience,
  })
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

async function initialize(
  config: AgentConfiguration,
  input: { origin: string; nickname: string; runtime: RuntimeName; idempotencyKey: string },
) {
  const agent = await generateKeyPair('EdDSA', { extractable: true })
  const agentJwk = await exportJWK(agent.privateKey)
  return {
    version: 18,
    origin: input.origin,
    issuer: config.agent_identity_issuer,
    runtime: input.runtime,
    name: input.nickname,
    agent_id: randomId('agent'),
    host_id: randomId('host'),
    agent_key_id: randomId('agent'),
    agent_private_key: ed25519StatePrivate(agentJwk),
    enrollment_idempotency_key: input.idempotencyKey,
  } satisfies PendingState
}

function publicAgentJwk(state: PendingState): JWK {
  const privateBytes = decodeBase64Url(state.agent_private_key)
  return {
    kty: 'OKP',
    crv: 'Ed25519',
    x: base64Url(privateBytes.slice(32)),
    kid: state.agent_key_id,
    alg: 'EdDSA',
    use: 'sig',
  }
}

async function createAgent(
  config: AgentConfiguration,
  state: PendingState,
  input: {
    username: string
    nickname: string
    managementCredential: import('@server/usecases/ports').RealmrootManagementCredential
  },
): Promise<RealmrootEnrollmentIdentity> {
  const url = `${new URL(config.issuer).origin}/api/agents`
  const response = await jsonRequest<unknown>(url, {
    method: 'POST',
    headers: {
      ...(await input.managementCredential.headers('POST', url)),
      'idempotency-key': state.enrollment_idempotency_key,
    },
    body: JSON.stringify({
      username: input.username,
      name: input.nickname,
      runtime: state.runtime,
      installation: {
        agentId: state.agent_id,
        hostId: state.host_id,
        name: 'Any Managed Agents',
        kid: state.agent_key_id,
        publicKey: publicAgentJwk(state),
      },
    }),
  })
  return directAgentIdentity(response, config.agent_identity_issuer, state.runtime)
}

async function dpopProof(jwk: JWK, method: string, uri: string, accessToken?: string) {
  const key = await importJWK(jwk, 'ES256')
  const publicJwk = { ...jwk }
  delete publicJwk.d
  const payload: Record<string, unknown> = { htm: method, htu: uri }
  if (accessToken) {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(accessToken))
    payload.ath = base64Url(new Uint8Array(digest))
  }
  const proof = new SignJWT(payload)
    .setProtectedHeader({ typ: 'dpop+jwt', alg: 'ES256', jwk: publicJwk })
    .setIssuedAt()
    .setJti(crypto.randomUUID())
  return await proof.sign(key)
}

function p256PrivateScalar(jwk: JWK) {
  const scalar = typeof jwk.d === 'string' ? decodeBase64Url(jwk.d) : new Uint8Array()
  const order = Uint8Array.from(
    'FFFFFFFF00000000FFFFFFFFFFFFFFFFBCE6FAADA7179E84F3B9CAC2FC632551'.match(/../g)!,
    (byte) => Number.parseInt(byte, 16),
  )
  const scalarIsZero = scalar.every((byte) => byte === 0)
  let scalarIsBelowOrder = false
  for (let index = 0; index < scalar.length; index += 1) {
    if (scalar[index] === order[index]) continue
    scalarIsBelowOrder = scalar[index]! < order[index]!
    break
  }
  if (
    jwk.kty !== 'EC' ||
    jwk.crv !== 'P-256' ||
    typeof jwk.x !== 'string' ||
    decodeBase64Url(jwk.x).length !== 32 ||
    typeof jwk.y !== 'string' ||
    decodeBase64Url(jwk.y).length !== 32 ||
    typeof jwk.d !== 'string' ||
    scalar.length !== 32 ||
    scalarIsZero ||
    !scalarIsBelowOrder ||
    (jwk.alg !== undefined && jwk.alg !== 'ES256') ||
    (jwk.use !== undefined && jwk.use !== 'sig') ||
    (jwk.key_ops !== undefined && (jwk.key_ops.length !== 1 || jwk.key_ops[0] !== 'sign'))
  ) {
    throw new Error('Generated Realmroot protocol DPoP key is invalid')
  }
  return jwk.d
}

function exactObject(value: unknown, keys: readonly string[], message: string) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(message)
  const record = value as Record<string, unknown>
  if (Object.keys(record).some((key) => !keys.includes(key))) throw new Error(message)
  return record
}

function directAgentIdentity(value: unknown, issuer: string, runtime: RuntimeName): RealmrootEnrollmentIdentity {
  const agent = exactObject(
    value,
    ['id', 'issuer', 'subject', 'username', 'name', 'runtime', 'homeSpace', 'status', 'createdAt', 'updatedAt'],
    'Realmroot Agent identity response contains unknown fields',
  )
  const homeSpace = exactObject(
    agent.homeSpace,
    ['type', 'userId', 'organizationId'],
    'Realmroot Agent home space is invalid',
  )
  if (
    (homeSpace.type !== 'personal' && homeSpace.type !== 'organization') ||
    (homeSpace.type === 'personal' &&
      (typeof homeSpace.userId !== 'string' || homeSpace.organizationId !== undefined)) ||
    (homeSpace.type === 'organization' &&
      (typeof homeSpace.organizationId !== 'string' || homeSpace.userId !== undefined)) ||
    agent.status !== 'active' ||
    typeof agent.createdAt !== 'string' ||
    typeof agent.updatedAt !== 'string' ||
    typeof agent.id !== 'string' ||
    agent.issuer !== issuer ||
    typeof agent.subject !== 'string' ||
    typeof agent.username !== 'string' ||
    typeof agent.name !== 'string' ||
    agent.runtime !== runtime
  ) {
    throw new Error('Realmroot Agent identity response is incomplete')
  }
  return {
    id: agent.id,
    issuer: agent.issuer,
    subject: agent.subject,
    username: agent.username,
    name: agent.name,
    runtime: agent.runtime as RuntimeName,
  }
}

function enrollmentIdentity(value: unknown, issuer: string, runtime: RuntimeName): RealmrootEnrollmentIdentity {
  const response = exactObject(
    value,
    ['enrollment', 'agent', 'installation'],
    'Realmroot Agent status response contains unknown fields',
  )
  const enrollment = exactObject(
    response.enrollment,
    ['state', 'pending'],
    'Realmroot Agent enrollment status is invalid',
  )
  if (enrollment.state !== 'enrolled' || enrollment.pending !== null) {
    throw new Error('Realmroot Agent identity response is incomplete')
  }
  return directAgentIdentity(response.agent, issuer, runtime)
}

async function readIdentity(config: AgentConfiguration, state: PendingState): Promise<RealmrootEnrollmentIdentity> {
  const pair = await generateKeyPair('ES256', { extractable: true })
  const jwk = await exportJWK(pair.privateKey)
  const tokenProof = await dpopProof(jwk, 'POST', config.agent_token_endpoint)
  const tokenResponse = await fetch(config.agent_token_endpoint, {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded', dpop: tokenProof },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: await agentAssertion(state, config.issuer),
      resource: `${new URL(config.issuer).origin}/api`,
      scope: 'agent:read',
    }),
  })
  if (!tokenResponse.ok) throw new Error(`Realmroot Agent token returned ${tokenResponse.status}`)
  const token = (await tokenResponse.json()) as { access_token: string; token_type: string; expires_in: number }
  if (token.token_type !== 'DPoP' || !token.access_token) throw new Error('Realmroot returned an invalid Agent token')
  const proof = await dpopProof(jwk, 'GET', config.agent_endpoint, token.access_token)
  const response = await jsonRequest<unknown>(config.agent_endpoint, {
    method: 'GET',
    headers: { authorization: `DPoP ${token.access_token}`, dpop: proof },
  })
  const identity = enrollmentIdentity(response, config.agent_identity_issuer, state.runtime)
  state.protocol_credential = {
    resource_indicator: `${new URL(config.issuer).origin}/api`,
    credential_endpoint: config.agent_token_endpoint,
    proof_target: config.agent_token_endpoint,
    private_key: p256PrivateScalar(jwk),
    access_token: token.access_token,
    expires_at: new Date(Date.now() + token.expires_in * 1000).toISOString(),
    scopes: ['agent:read'],
  }
  return identity
}

export function createRealmrootEnrollmentGateway(): RealmrootEnrollmentGateway {
  return {
    async initialize(input) {
      const config = await configuration(input.origin)
      const state = await initialize(config, input)
      return { stage: 'initialized', state }
    },
    async prepare(input) {
      const config = await configuration(input.origin)
      const checkpoint = input.checkpoint
      if (!checkpoint) throw new Error('Realmroot Agent initialization checkpoint is required')
      if (checkpoint.stage === 'enrolled') return checkpoint
      if (checkpoint.stage !== 'initialized') throw new Error('Realmroot Agent creation checkpoint is invalid')
      const state = checkpoint.state as PendingState
      const createdIdentity = await createAgent(config, state, input)
      const assertedIdentity = await readIdentity(config, state)
      if (createdIdentity.id !== assertedIdentity.id || createdIdentity.subject !== assertedIdentity.subject) {
        throw new Error('Realmroot created Agent does not match its authenticated identity')
      }
      state.identity = createdIdentity
      const enrolled = {
        stage: 'enrolled' as const,
        state,
        identity: createdIdentity,
      }
      await input.onCheckpoint(enrolled)
      return enrolled
    },
    async complete(input) {
      const checkpoint = input.checkpoint
      if (checkpoint.stage !== 'enrolled' || !checkpoint.identity) {
        throw new Error('Realmroot Agent creation is incomplete')
      }
      const config = await configuration(input.origin)
      const state = checkpoint.state as PendingState
      const identity = await readIdentity(config, state)
      if (
        identity.id !== checkpoint.identity.id ||
        identity.issuer !== checkpoint.identity.issuer ||
        identity.subject !== checkpoint.identity.subject ||
        identity.username !== checkpoint.identity.username ||
        identity.runtime !== checkpoint.identity.runtime
      ) {
        throw new Error('Realmroot Agent checkpoint does not match its authenticated identity')
      }
      return { identity, state }
    },
  }
}
