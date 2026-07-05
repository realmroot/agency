// Internal runtime execution entities. These are the control-plane model for
// user-declared runtime inputs and the materialized inputs handed to a runtime
// host or runner after secret references have been resolved.

export interface EnvFromEntry {
  type: 'secret'
  name?: string | undefined
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

export interface MemoryVolume {
  name: string
  type: 'memory'
  memoryRef: string
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

export function declaredVolumes(volumes: Volume[]): Volume[] {
  return volumes.map((volume) => {
    if (isMemoryVolume(volume)) {
      return {
        name: volume.name,
        type: 'memory',
        memoryRef: volume.memoryRef,
      }
    }
    if (isGitRepositoryVolume(volume)) {
      return {
        name: volume.name,
        type: 'git_repository',
        url: volume.url,
        ...(volume.ref ? { ref: volume.ref } : {}),
        ...(volume.secretRef ? { secretRef: volume.secretRef } : {}),
        ...(volume.items ? { items: volume.items } : {}),
      }
    }
    return {
      name: volume.name,
      type: 'secret',
      secretRef: volume.secretRef,
      ...(volume.items ? { items: volume.items } : {}),
    }
  })
}

export function volumeMountPath(volumeName: string, volumeMounts: VolumeMount[]): string | null {
  return volumeMounts.find((mount) => mount.name === volumeName)?.mountPath ?? null
}

export function volumeMountReadOnly(volumeName: string, volumeMounts: VolumeMount[]): boolean {
  return volumeMounts.find((mount) => mount.name === volumeName)?.readOnly ?? true
}
