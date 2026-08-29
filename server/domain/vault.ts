// Pure vault credential rules: secret-reference construction, credential/version
// state machine, and reference-pinning checks. Zero outward imports — directly
// unit-testable. Secret storage is a boundary and lives behind the SecretStore
// gateway, not here.

import type { ResourceMetadata, ResourcePhase } from './resource'
import type { RuntimeName } from './runtime-catalog'

export const SECRET_PROVIDERS = ['ama'] as const
export const VAULT_SCOPES = ['project', 'organization'] as const
export const CREDENTIAL_TYPES = [
  'opaque',
  'ama.dev/basic-auth',
  'ama.dev/ssh-auth',
  'ama.dev/tls',
  'ama.dev/private-key-jwk',
  'ama.dev/oauth-token',
  'ama.dev/realmroot-agent-state',
] as const
export const CREDENTIAL_STATES = ['active', 'revoked'] as const
export const VERSION_STATES = ['active', 'superseded', 'revoked'] as const

export type SecretProvider = (typeof SECRET_PROVIDERS)[number]
export type VaultScope = (typeof VAULT_SCOPES)[number]
export type CredentialType = (typeof CREDENTIAL_TYPES)[number]
export type CredentialState = (typeof CREDENTIAL_STATES)[number]
export type VersionState = (typeof VERSION_STATES)[number]

export interface SecretMaterial {
  stringData?: Record<string, string> | undefined
  referenceName?: string | undefined
  metadata?: Record<string, unknown> | undefined
}

export interface SecretIdentity {
  vaultId: string
  credentialId: string
  versionId: string
}

export interface SecretRefIdentity {
  vaultId: string
  credentialId?: string | undefined
  versionId?: string | undefined
}

// The safe (secret-free) reference fields a credential version persists. The
// actual secret value never appears here — it goes to the SecretStore gateway.
export interface SecretReference {
  provider: SecretProvider
  secretRef: string
  referenceName: string
  hasSecret: boolean
  metadata: Record<string, unknown>
}

export interface Vault {
  metadata: ResourceMetadata
  spec: VaultSpec
  status: VaultStatus
}

export interface VaultSpec {
  organizationId: string
  scope: VaultScope
}

export interface VaultStatus {
  phase: ResourcePhase
}

export interface Credential {
  metadata: ResourceMetadata
  spec: CredentialSpec
  status: CredentialStatus
}

export interface CredentialSpec {
  vaultId: string
  organizationId: string
  type: CredentialType
  metadata: Record<string, unknown>
}

export interface CredentialStatus {
  phase: CredentialState
  activeVersionId: string | null
  revokedAt: string | null
  revokedByUserId: string | null
  revokeReason: string | null
}

export interface CredentialVersion {
  metadata: ResourceMetadata
  spec: CredentialVersionSpec
  status: CredentialVersionStatus
}

export interface CredentialVersionSpec {
  credentialId: string
  vaultId: string
  organizationId: string
  version: number
  provider: SecretProvider
  secretRef: string
  referenceName: string
  hasSecret: boolean
  metadata: Record<string, unknown>
}

export interface CredentialVersionStatus {
  phase: VersionState
  supersededAt: string | null
  revokedAt: string | null
}

function secretReferenceName(credentialId: string, version: number, requestedName: string | undefined) {
  return requestedName ?? `AMA_${credentialId.toUpperCase()}_V${version}`
}

function uriPathSegment(value: string) {
  return encodeURIComponent(value)
}

export function credentialVersionSecretRef(identity: SecretIdentity) {
  return `ama://vaults/${uriPathSegment(identity.vaultId)}/credentials/${uriPathSegment(identity.credentialId)}/versions/${uriPathSegment(identity.versionId)}`
}

export function credentialScopedSecretRef(identity: { vaultId: string; credentialId: string }) {
  return `ama://vaults/${uriPathSegment(identity.vaultId)}/credentials/${uriPathSegment(identity.credentialId)}`
}

export function amaSecretRef(vaultId: string) {
  return `ama://vaults/${uriPathSegment(vaultId)}`
}

export function vaultIdFromRef(secretRef: string): string | null {
  let parsed: URL
  try {
    parsed = new URL(secretRef)
  } catch {
    return null
  }
  if (parsed.protocol !== 'ama:' || parsed.hostname !== 'vaults') {
    return null
  }
  const [vaultId, ...rest] = parsed.pathname.split('/').filter(Boolean)
  return vaultId && rest.length === 0 ? decodeURIComponent(vaultId) : null
}

export function secretRefIdentity(secretRef: string): SecretRefIdentity | null {
  let parsed: URL
  try {
    parsed = new URL(secretRef)
  } catch {
    return null
  }
  if (parsed.protocol !== 'ama:' || parsed.hostname !== 'vaults') {
    return null
  }
  const segments = parsed.pathname.split('/').filter(Boolean).map(decodeURIComponent)
  if (segments.length === 1) {
    return { vaultId: segments[0]! }
  }
  if (segments.length === 3 && segments[1] === 'credentials') {
    return { vaultId: segments[0]!, credentialId: segments[2]! }
  }
  if (segments.length === 5 && segments[1] === 'credentials' && segments[3] === 'versions') {
    return { vaultId: segments[0]!, credentialId: segments[2]!, versionId: segments[4]! }
  }
  return null
}

function requiredKeys(type: CredentialType): string[] {
  switch (type) {
    case 'opaque':
      return []
    case 'ama.dev/basic-auth':
      return ['username', 'password']
    case 'ama.dev/ssh-auth':
      return ['ssh-privatekey']
    case 'ama.dev/tls':
      return ['tls.crt', 'tls.key']
    case 'ama.dev/private-key-jwk':
      return ['jwk']
    case 'ama.dev/oauth-token':
      return ['access-token']
    case 'ama.dev/realmroot-agent-state':
      return ['state.json']
  }
}

function optionalKeys(type: CredentialType): string[] {
  return type === 'ama.dev/oauth-token' ? ['refresh-token', 'token-type', 'expires-at', 'scopes'] : []
}

export function validateSecretData(type: CredentialType, stringData: Record<string, string>) {
  const keys = Object.keys(stringData)
  if (keys.length === 0) {
    return { stringData: 'At least one data key is required.' }
  }
  for (const [key, value] of Object.entries(stringData)) {
    if (!key || key.length > 253 || key === '.' || key === '..' || key.includes('/')) {
      return { [`stringData.${key || '<empty>'}`]: 'Use a safe Secret data key.' }
    }
    if (value.length === 0) {
      return { [`stringData.${key}`]: 'Secret data values must not be empty.' }
    }
  }
  const allowed = new Set([...requiredKeys(type), ...optionalKeys(type)])
  for (const key of requiredKeys(type)) {
    if (!stringData[key]) {
      return { [`stringData.${key}`]: `Credential type ${type} requires ${key}.` }
    }
  }
  if (type !== 'opaque') {
    for (const key of keys) {
      if (!allowed.has(key)) {
        return { [`stringData.${key}`]: `Credential type ${type} does not define ${key}.` }
      }
    }
  }
  if (type === 'ama.dev/private-key-jwk') {
    const jwk = stringData.jwk
    if (!jwk) {
      return { 'stringData.jwk': 'Credential type ama.dev/private-key-jwk requires jwk.' }
    }
    try {
      const parsed: unknown = JSON.parse(jwk)
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return { 'stringData.jwk': 'JWK must be a JSON object.' }
      }
    } catch {
      return { 'stringData.jwk': 'JWK must be valid JSON.' }
    }
  }
  if (type === 'ama.dev/realmroot-agent-state') {
    try {
      parseRealmrootAgentState(stringData['state.json'] ?? '')
    } catch (error) {
      return {
        'stringData.state.json': error instanceof Error ? error.message : 'Realmroot Agent state is invalid.',
      }
    }
  }
  return null
}

export interface RealmrootAgentStateMetadata {
  agentId: string
  origin: string
  issuer: string
  runtime: RuntimeName
}

const REALMROOT_AGENT_STATE_VERSION = 18
const REALMROOT_AGENT_STATE_KEYS = new Set([
  'version',
  'origin',
  'issuer',
  'runtime',
  'name',
  'agent_id',
  'host_id',
  'agent_key_id',
  'agent_private_key',
  'registration_approval',
  'enrollment_idempotency_key',
  'identity',
  'credential_sources',
  'protocol_credential',
])

function objectRecord(value: unknown, message: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(message)
  return value as Record<string, unknown>
}

function assertKnownKeys(value: Record<string, unknown>, allowed: ReadonlySet<string>, message: string) {
  if (Object.keys(value).some((key) => !allowed.has(key))) throw new Error(message)
}

function realmrootAbsoluteUrl(value: unknown, message: string) {
  if (typeof value !== 'string' || !value) throw new Error(message)
  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    throw new Error(message)
  }
  const loopback = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1' || parsed.hostname === '[::1]'
  if (
    parsed.username ||
    parsed.password ||
    (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && loopback))
  ) {
    throw new Error(message)
  }
  return parsed
}

const DPOP_CREDENTIAL_KEYS = new Set([
  'resource_indicator',
  'authorization_details',
  'credential_endpoint',
  'proof_target',
  'private_key',
  'access_token',
  'expires_at',
  'scopes',
])

function authorizationDetails(value: unknown) {
  if (value === undefined) return []
  if (!Array.isArray(value) || value.some((detail) => !detail || typeof detail !== 'object' || Array.isArray(detail))) {
    throw new Error('Realmroot Agent state contains invalid authorization details.')
  }
  const details: unknown[] = value
  return details
}

function canonicalJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalJson)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => [key, canonicalJson(nested)]),
  )
}

function canonicalAuthorizationDetails(details: unknown[]) {
  return details
    .map((detail) => JSON.stringify(canonicalJson(detail)))
    .sort()
    .join('\u0000')
}

function realmrootRfc3339(value: unknown, message: string) {
  if (typeof value !== 'string') throw new Error(message)
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|[+-](\d{2}):(\d{2}))$/.exec(value)
  if (!match) throw new Error(message)
  const [, yearText, monthText, dayText, hourText, minuteText, secondText, offsetHourText, offsetMinuteText] = match
  const year = Number(yearText)
  const month = Number(monthText)
  const day = Number(dayText)
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
  const daysInMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1]
  if (
    daysInMonth === undefined ||
    day < 1 ||
    day > daysInMonth ||
    Number(hourText) > 23 ||
    Number(minuteText) > 59 ||
    Number(secondText) > 59 ||
    (offsetHourText !== undefined && Number(offsetHourText) > 23) ||
    (offsetMinuteText !== undefined && Number(offsetMinuteText) > 59)
  ) {
    throw new Error(message)
  }
}

function dpopCredential(value: unknown, source?: { resource: string; details: unknown[] }) {
  const credential = objectRecord(value, 'Realmroot Agent state contains invalid DPoP credential metadata.')
  assertKnownKeys(credential, DPOP_CREDENTIAL_KEYS, 'Realmroot Agent state contains unknown DPoP credential fields.')
  const resource = realmrootAbsoluteUrl(
    credential.resource_indicator,
    'Realmroot Agent state contains an invalid DPoP resource URL.',
  ).toString()
  realmrootAbsoluteUrl(credential.credential_endpoint, 'Realmroot Agent state contains an invalid credential endpoint.')
  realmrootAbsoluteUrl(credential.proof_target, 'Realmroot Agent state contains an invalid proof target.')
  const details = authorizationDetails(credential.authorization_details)
  if (
    source &&
    (resource !== source.resource ||
      canonicalAuthorizationDetails(details) !== canonicalAuthorizationDetails(source.details))
  ) {
    throw new Error('Realmroot Agent state credential source and current credential do not match.')
  }
  if (
    credential.scopes !== undefined &&
    (!Array.isArray(credential.scopes) || credential.scopes.some((v) => typeof v !== 'string'))
  ) {
    throw new Error('Realmroot Agent state contains invalid DPoP scopes.')
  }
  for (const key of ['private_key', 'access_token'] as const) {
    if (credential[key] !== undefined && typeof credential[key] !== 'string') {
      throw new Error('Realmroot Agent state contains invalid DPoP credential values.')
    }
  }
  if (credential.expires_at !== undefined && credential.expires_at !== null) {
    realmrootRfc3339(credential.expires_at, 'Realmroot Agent state contains an invalid DPoP expiry.')
  }
  return credential
}

function validateRealmrootOptionalState(state: Record<string, unknown>) {
  if (state.registration_approval !== undefined && state.registration_approval !== null) {
    const approval = objectRecord(state.registration_approval, 'Realmroot Agent registration approval is invalid.')
    assertKnownKeys(
      approval,
      new Set(['verification_uri_complete', 'expires_at', 'interval_seconds']),
      'Realmroot Agent registration approval contains unknown fields.',
    )
    realmrootAbsoluteUrl(approval.verification_uri_complete, 'Realmroot Agent registration approval URL is invalid.')
    if (!Number.isInteger(approval.interval_seconds)) throw new Error('Realmroot Agent approval interval is invalid.')
    if (approval.expires_at !== undefined && approval.expires_at !== null) {
      realmrootRfc3339(approval.expires_at, 'Realmroot Agent registration approval expiry is invalid.')
    }
  }
  if (state.identity !== undefined && state.identity !== null) {
    const identity = objectRecord(state.identity, 'Realmroot Agent identity is invalid.')
    assertKnownKeys(
      identity,
      new Set(['id', 'issuer', 'subject', 'username', 'name', 'runtime']),
      'Realmroot Agent identity contains unknown fields.',
    )
    if (
      typeof identity.id !== 'string' ||
      typeof identity.issuer !== 'string' ||
      typeof identity.subject !== 'string'
    ) {
      throw new Error('Realmroot Agent identity is incomplete.')
    }
    for (const key of ['username', 'name', 'runtime'] as const) {
      if (identity[key] !== undefined && typeof identity[key] !== 'string') {
        throw new Error('Realmroot Agent identity contains invalid fields.')
      }
    }
  }
  if (state.credential_sources !== undefined && state.credential_sources !== null) {
    const sources = objectRecord(state.credential_sources, 'Realmroot Agent credential sources are invalid.')
    const contexts = new Set<string>()
    for (const [reference, rawSource] of Object.entries(sources)) {
      if (!reference.startsWith('rrcs_') || decodedBase64UrlLength(reference.slice(5)) !== 16) {
        throw new Error('Realmroot Agent credential source reference is invalid.')
      }
      const source = objectRecord(rawSource, 'Realmroot Agent credential source is invalid.')
      assertKnownKeys(
        source,
        new Set(['resource_indicator', 'authorization_details', 'credential']),
        'Realmroot Agent credential source contains unknown fields.',
      )
      const resource = realmrootAbsoluteUrl(
        source.resource_indicator,
        'Realmroot Agent credential source resource is invalid.',
      ).toString()
      const details = authorizationDetails(source.authorization_details)
      const context = `${resource}\u0000${canonicalAuthorizationDetails(details)}`
      if (contexts.has(context)) throw new Error('Realmroot Agent credential sources contain a duplicate context.')
      contexts.add(context)
      const credential = dpopCredential(source.credential, { resource, details })
      if (!Array.isArray(credential.scopes) || credential.scopes.length === 0) {
        throw new Error('Realmroot Agent credential source requires scopes.')
      }
      if (credential.private_key || credential.access_token || credential.expires_at) {
        throw new Error('Realmroot Agent credential source must not contain target key or token material.')
      }
    }
  }
  if (state.protocol_credential !== undefined && state.protocol_credential !== null) {
    const credential = dpopCredential(state.protocol_credential)
    if (typeof credential.private_key !== 'string' || decodedBase64UrlLength(credential.private_key) !== 32) {
      throw new Error('Realmroot Agent protocol DPoP private key is invalid.')
    }
    if (
      (typeof credential.access_token === 'string' && credential.access_token.length > 0) !==
      (credential.expires_at != null)
    ) {
      throw new Error('Realmroot Agent protocol credential is incomplete.')
    }
  }
}

function decodedBase64UrlLength(value: string) {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) return -1
  try {
    const normalized = value.replaceAll('-', '+').replaceAll('_', '/')
    return atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=')).length
  } catch {
    return -1
  }
}

export function parseRealmrootAgentState(content: string): RealmrootAgentStateMetadata {
  let parsed: unknown
  try {
    parsed = JSON.parse(content)
  } catch {
    throw new Error('Realmroot Agent state must be valid JSON.')
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Realmroot Agent state must be a JSON object.')
  }
  const state = parsed as Record<string, unknown>
  assertKnownKeys(state, REALMROOT_AGENT_STATE_KEYS, 'Realmroot Agent state contains fields unknown to v0.4.2.')
  if (state.name !== undefined && typeof state.name !== 'string') {
    throw new Error('Realmroot Agent state contains an invalid name.')
  }
  if (state.version !== REALMROOT_AGENT_STATE_VERSION) {
    throw new Error(`Realmroot Agent state must use version ${REALMROOT_AGENT_STATE_VERSION}.`)
  }
  for (const key of [
    'agent_id',
    'origin',
    'issuer',
    'host_id',
    'agent_key_id',
    'enrollment_idempotency_key',
  ] as const) {
    if (typeof state[key] !== 'string' || !state[key].trim()) {
      throw new Error(`Realmroot Agent state requires ${key}.`)
    }
  }
  let origin: URL
  try {
    origin = new URL(state.origin as string)
  } catch {
    throw new Error('Realmroot Agent state origin must be a safe HTTPS URL.')
  }
  if (origin.protocol !== 'https:' || origin.username || origin.password || origin.search || origin.hash) {
    throw new Error('Realmroot Agent state origin must be a safe HTTPS URL.')
  }
  let issuer: URL
  try {
    issuer = new URL(state.issuer as string)
  } catch {
    throw new Error('Realmroot Agent state issuer must be a safe HTTPS URL.')
  }
  if (issuer.protocol !== 'https:' || issuer.username || issuer.password || issuer.search || issuer.hash) {
    throw new Error('Realmroot Agent state issuer must be a safe HTTPS URL.')
  }
  if (!['ama', 'claude-code', 'codex', 'copilot'].includes(state.runtime as string)) {
    throw new Error('Realmroot Agent state contains an unsupported runtime.')
  }
  if (typeof state.agent_private_key !== 'string' || decodedBase64UrlLength(state.agent_private_key) !== 64) {
    throw new Error('Realmroot Agent state contains an invalid Ed25519 private key.')
  }
  validateRealmrootOptionalState(state)
  const stableIdentity =
    state.identity && typeof state.identity === 'object' && !Array.isArray(state.identity)
      ? (state.identity as Record<string, unknown>)
      : null
  return {
    agentId: typeof stableIdentity?.id === 'string' ? stableIdentity.id : (state.agent_id as string),
    origin: state.origin as string,
    issuer: state.issuer as string,
    runtime: state.runtime as RuntimeName,
  }
}

// Builds the safe reference for a credential version from the requested secret
// material, validating the provider-specific field combination. Throws on an
// invalid combination so the http layer maps it to a 400.
export function secretReference(
  identity: SecretIdentity,
  version: number,
  type: CredentialType,
  values: SecretMaterial,
): SecretReference {
  const stringData = values.stringData ?? {}
  const invalid = validateSecretData(type, stringData)
  if (invalid) {
    throw new Error(Object.values(invalid)[0] ?? 'Invalid credential data')
  }
  const referenceName = secretReferenceName(identity.credentialId, version, values.referenceName)
  return {
    provider: 'ama',
    secretRef: credentialVersionSecretRef(identity),
    referenceName,
    hasSecret: true,
    metadata: { ...(values.metadata ?? {}), dataKeys: Object.keys(stringData).sort() },
  }
}

// Stored secret material (ciphertext, legacy local values) lives only in the
// D1 row. It must never leave through API responses or audit snapshots.
const STORED_SECRET_METADATA_KEYS = ['encryptedSecretValue', 'encryptedSecretData', 'localSecretValue'] as const

export function stripStoredSecretMetadata(metadata: Record<string, unknown>): Record<string, unknown> {
  const safe = { ...metadata }
  for (const key of STORED_SECRET_METADATA_KEYS) {
    delete safe[key]
  }
  return safe
}

export function credentialDataKeys(metadata: Record<string, unknown>): string[] {
  if (Array.isArray(metadata.dataKeys) && metadata.dataKeys.every((key) => typeof key === 'string')) {
    return [...metadata.dataKeys].sort()
  }
  const encryptedSecretData = metadata.encryptedSecretData
  if (encryptedSecretData && typeof encryptedSecretData === 'object' && !Array.isArray(encryptedSecretData)) {
    return Object.keys(encryptedSecretData).sort()
  }
  return []
}
