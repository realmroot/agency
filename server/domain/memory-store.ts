import type { ResourceMetadata, ResourcePhase } from './resource'

export interface MemoryStore {
  metadata: ResourceMetadata
  spec: MemoryStoreSpec
  status: MemoryStoreStatus
}

export type MemoryStoreSpec = Record<string, never>

export interface MemoryStoreStatus {
  phase: ResourcePhase
}

export interface Memory {
  metadata: ResourceMetadata
  spec: MemorySpec
  status: MemoryStatus
}

export interface MemorySpec {
  storeId: string
  path: string
  content: string
  metadata: Record<string, unknown>
}

export interface MemoryStatus {
  phase: ResourcePhase
}

export const MEMORY_STORE_MOUNT_ROOT = '/workspace/.ama/memory-stores'

function uriPathSegment(value: string) {
  return encodeURIComponent(value)
}

export function enborMemoryRef(storeId: string) {
  return `ama://memories/${uriPathSegment(storeId)}`
}

export function memoryStoreIdFromRef(memoryRef: string): string | null {
  let parsed: URL
  try {
    parsed = new URL(memoryRef)
  } catch {
    return null
  }
  if (parsed.protocol !== 'ama:' || parsed.hostname !== 'memories') {
    return null
  }
  const [storeId, ...rest] = parsed.pathname.split('/').filter(Boolean)
  return storeId && rest.length === 0 ? decodeURIComponent(storeId) : null
}

export function memoryStoreMountPath(storeId: string): string {
  return `${MEMORY_STORE_MOUNT_ROOT}/${storeId}`
}

export function normalizeMemoryPath(path: string): string {
  const requested = path.trim()
  if (!requested) {
    throw new Error('Memory path is required.')
  }
  if (/[\p{C}\\]/u.test(requested)) {
    throw new Error('Memory path contains invalid characters.')
  }
  if (requested.startsWith('/')) {
    throw new Error('Memory path must be relative.')
  }
  const segments = requested.split('/')
  if (
    segments.length === 0 ||
    segments.some((segment) => segment.length === 0 || segment === '.' || segment === '..') ||
    segments[0] === '.ama'
  ) {
    throw new Error('Memory path must use clean relative segments outside .ama.')
  }
  if (!segments.every((segment) => /^[A-Za-z0-9._-]+$/.test(segment))) {
    throw new Error('Memory path segments may contain only letters, numbers, dots, underscores, and hyphens.')
  }
  return segments.join('/')
}
