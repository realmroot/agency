// Pure environment business rules. Zero outward imports — directly
// unit-testable. Network-policy shape parsing lives in the openapi/contract
// schema (zod) and the repo; the domain only owns secret-material rules and the
// version-snapshot decision.

import type { ResourceMetadata, ResourcePhase } from './resource'

export type EnvironmentHostingMode = 'cloud' | 'self_hosted'
export type EnvironmentScope = 'project' | 'organization'
export type EnvironmentType = 'cloud' | 'self_hosted'

// Optional fields explicitly admit `undefined` so a zod-inferred request body
// (which carries `T | undefined` under exactOptionalPropertyTypes) is accepted.
export interface EnvironmentNetworking {
  type: 'closed' | 'limited' | 'open'
  allowMcpServers: boolean
  allowPackageManagers: boolean
  allowedHosts?: string[] | undefined
}

export interface EnvironmentPackages {
  type: 'packages'
  apt: string[]
  cargo: string[]
  gem: string[]
  go: string[]
  npm: string[]
  pip: string[]
  webi: string[]
}

export interface EnvironmentVariable {
  description?: string | undefined
  required?: boolean | undefined
}

// The runtime-relevant configuration that an environment version snapshots.
export interface EnvironmentConfig {
  scope: EnvironmentScope
  type: EnvironmentType
  networking: EnvironmentNetworking
  packages: EnvironmentPackages
  variables: Record<string, EnvironmentVariable>
}

export interface Environment {
  metadata: ResourceMetadata
  spec: EnvironmentConfig
  status: EnvironmentStatus
}

export interface EnvironmentStatus {
  phase: ResourcePhase
  currentVersionId: string | null
  version: number
}

export interface EnvironmentVersion {
  metadata: ResourceMetadata
  spec: EnvironmentConfig
  status: EnvironmentVersionStatus
}

export interface EnvironmentVersionStatus {
  environmentId: string
  version: number
}

// The config fields whose presence in a PATCH body forces a new version
// snapshot. (name/description are not runtime config — they never version.)
export const RUNTIME_CONFIG_FIELDS = ['scope', 'type', 'networking', 'packages', 'variables'] as const

// Validation failures are keyed by the field that caused them; the http layer
// maps a non-null result to a 400 validation error envelope.
export type FieldErrors = Record<string, string>

function secretKey(key: string) {
  const normalized = key.toLowerCase().replaceAll(/[^a-z0-9]/g, '')
  return (
    normalized.includes('secret') ||
    normalized.includes('token') ||
    normalized.includes('apikey') ||
    normalized.includes('password') ||
    normalized.includes('privatekey')
  )
}

export function hasSecretMaterial(value: unknown): boolean {
  if (!value || typeof value !== 'object') {
    return false
  }
  if (Array.isArray(value)) {
    return value.some(hasSecretMaterial)
  }
  return Object.entries(value).some(([key, child]) => {
    return secretKey(key) || hasSecretMaterial(child)
  })
}

export function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

// The free-form JSON config fields that must never carry raw secret material —
// secrets belong in a vault secret reference, not inline configuration.
export function defaultEnvironmentPackages(): EnvironmentPackages {
  return { type: 'packages', apt: [], cargo: [], gem: [], go: [], npm: [], pip: [], webi: [] }
}
