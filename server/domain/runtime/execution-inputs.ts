// Internal runtime execution entities. These are the control-plane model for
// user-declared runtime inputs and the materialized inputs handed to a runtime
// host or runner after secret references have been resolved.

export interface EnvFromEntry {
  type: 'secret'
  name: string
  secretRef: string
  key?: string | undefined
}

export interface SecretItem {
  key: string
  path: string
}

export type Volume = SecretVolume | GitRepositoryVolume | MemoryVolume

export interface SecretVolume {
  name: string
  type: 'secret'
  secretRef: string
  items?: SecretItem[] | undefined
}

export interface GitRepositoryVolume extends Record<string, unknown> {
  name: string
  type: 'git_repository'
  url: string
  ref?: string | undefined
  secretRef?: string | undefined
  items?: SecretItem[] | undefined
}

export interface MemoryVolume extends Record<string, unknown> {
  name: string
  type: 'memory'
  memoryRef: string
  access: 'read_only' | 'read_write'
  storeName?: string | undefined
  description?: string | undefined
  memories?: Array<Record<string, unknown>> | undefined
}

export interface VolumeMount {
  name: string
  mountPath: string
  readOnly?: boolean | undefined
}

export interface RuntimeInputs {
  env: Record<string, string>
  envFrom: EnvFromEntry[]
  volumes: Volume[]
  volumeMounts: VolumeMount[]
}

export function isSecretVolume(volume: Volume): volume is SecretVolume {
  return volume.type === 'secret'
}

export function isGitRepositoryVolume(volume: Volume): volume is GitRepositoryVolume {
  return volume.type === 'git_repository'
}

export function isMemoryVolume(volume: Volume): volume is MemoryVolume {
  return volume.type === 'memory'
}

export function volumeMountPath(volumeName: string, volumeMounts: VolumeMount[]): string | null {
  return volumeMounts.find((mount) => mount.name === volumeName)?.mountPath ?? null
}
