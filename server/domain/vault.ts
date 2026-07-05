// Pure vault credential rules: secret-reference construction, credential/version
// state machine, and reference-pinning checks. Zero outward imports — directly
// unit-testable. Secret storage is a boundary and lives behind the SecretStore
// gateway, not here.

import type { ResourceMetadata, ResourcePhase } from './resource'

export const SECRET_PROVIDERS = ['ama'] as const
export const VAULT_SCOPES = ['project', 'organization'] as const
export const CREDENTIAL_TYPES = [
  'opaque',
  'ama.dev/basic-auth',
  'ama.dev/ssh-auth',
  'ama.dev/tls',
  'ama.dev/private-key-jwk',
  'ama.dev/oauth-token',
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
  return null
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
