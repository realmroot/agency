import { gitRepositoryMountPath, normalizeGitRepositoryUrl } from './git-repository'
import { memoryStoreIdFromRef, memoryStoreMountPath } from './memory-store'
import {
  type GitRepositoryVolume,
  isGitRepositoryVolume,
  isMemoryVolume,
  type MemoryVolume,
  type Volume,
  type VolumeMount,
  volumeMountPath,
  volumeMountReadOnly,
} from './runtime/execution-inputs'

export type WorkspaceSpec = {
  volumes: Volume[]
  volumeMounts: VolumeMount[]
}

export type WorkspaceFile = {
  path: string
  content: string
}

export type WorkspaceGitCredential = {
  username: string
  password: string
}

export type WorkspaceManifestMount =
  | {
      type: 'git_repository'
      name: string
      mountPath: string
      url: string
      ref?: string | undefined
      credential?: WorkspaceGitCredential | undefined
    }
  | {
      type: 'memory'
      name: string
      mountPath: string
      memoryRef: string
      readOnly: boolean
      files: WorkspaceFile[]
    }
  | {
      type: 'secret'
      name: string
      mountPath: string
      readOnly: boolean
      files: WorkspaceFile[]
    }

export type WorkspaceManifest = {
  root: '/workspace'
  mounts: WorkspaceManifestMount[]
}

export function workspaceSpec(volumes: Volume[], volumeMounts: VolumeMount[]): WorkspaceSpec {
  return { volumes, volumeMounts }
}

export function workspaceSystemPromptBlock(spec: WorkspaceSpec): string | null {
  const repositories = spec.volumes.filter(isGitRepositoryVolume).map((volume) => {
    const url = String(volume.url ?? '')
    const mountPath = relativeWorkspacePath(
      volumeMountPath(volume.name, spec.volumeMounts) ?? gitRepositoryMountPath(url),
    )
    return `- ${url} at ${mountPath}`
  })
  const memoryStores = spec.volumes.filter(isMemoryVolume).map((volume) => {
    const storeId = memoryStoreIdFromRef(String(volume.memoryRef ?? '')) ?? String(volume.memoryRef ?? '')
    const mountPath = relativeWorkspacePath(
      volumeMountPath(volume.name, spec.volumeMounts) ?? memoryStoreMountPath(storeId),
    )
    const readOnly = volumeMountReadOnly(volume.name, spec.volumeMounts)
    return `- ${volume.name || storeId} (${readOnly ? 'readOnly' : 'writable'}) at ${mountPath}`
  })
  if (repositories.length === 0 && memoryStores.length === 0) {
    return null
  }
  const lines = ['Workspace layout:', '- The current working directory is this session workspace root.']
  if (repositories.length > 0) {
    lines.push('- Repositories:', ...repositories.map((repository) => `  ${repository}`))
  }
  if (memoryStores.length > 0) {
    lines.push('- Memory stores:', ...memoryStores.map((store) => `  ${store}`))
  }
  return lines.join('\n')
}

export function normalizeWorkspaceSpec(spec: WorkspaceSpec) {
  const normalizedVolumes: Volume[] = []
  const normalizedMounts: VolumeMount[] = []
  const mountPaths = new Set<string>()
  const volumeNames = new Set<string>()
  for (const [index, mount] of spec.volumeMounts.entries()) {
    const normalizedPath = normalizeWorkspaceMountPath(mount.mountPath)
    if (!normalizedPath) {
      return { fields: { [`volumeMounts.${index}.mountPath`]: 'Volume mount path must stay under /workspace.' } }
    }
    if (mount.readOnly !== undefined && typeof mount.readOnly !== 'boolean') {
      return { fields: { [`volumeMounts.${index}.readOnly`]: 'Use a boolean readOnly value.' } }
    }
    normalizedMounts.push({ ...mount, mountPath: normalizedPath, readOnly: mount.readOnly ?? true })
  }
  for (const [index, volume] of spec.volumes.entries()) {
    if (volumeNames.has(volume.name)) {
      return { fields: { [`volumes.${index}.name`]: 'Volume names must be unique.' } }
    }
    volumeNames.add(volume.name)
    if (!isGitRepositoryVolume(volume)) {
      if (!isMemoryVolume(volume)) {
        normalizedVolumes.push(volume)
        continue
      }
      const parsed = volume
      const storeId = typeof parsed.memoryRef === 'string' ? memoryStoreIdFromRef(parsed.memoryRef) : null
      if (!storeId) {
        return { fields: { [`volumes.${index}.memoryRef`]: 'Memory reference must use ama://memories/{storeId}.' } }
      }
      const mountIndex = normalizedMounts.findIndex((mount) => mount.name === parsed.name)
      if (mountIndex === -1) {
        return { fields: { [`volumes.${index}.name`]: 'Memory store volume must have a matching volume mount.' } }
      }
      const mountPath = normalizedMounts[mountIndex]!.mountPath
      if (!mountPath.startsWith('/workspace/.ama/memory-stores/')) {
        return {
          fields: {
            [`volumeMounts.${mountIndex}.mountPath`]:
              'Memory store mounts must stay under /workspace/.ama/memory-stores.',
          },
        }
      }
      if (mountPaths.has(mountPath)) {
        return { fields: { [`volumeMounts.${mountIndex}.mountPath`]: 'Mount path must be unique within a session.' } }
      }
      mountPaths.add(mountPath)
      normalizedVolumes.push({
        name: parsed.name,
        type: 'memory',
        memoryRef: parsed.memoryRef,
      } satisfies MemoryVolume)
      continue
    }
    const parsed = volume
    const url = normalizeGitRepositoryUrl(parsed.url)
    if (!url) {
      return { fields: { [`volumes.${index}.url`]: 'Use a safe HTTPS Git repository URL.' } }
    }
    const mountIndex = normalizedMounts.findIndex((mount) => mount.name === parsed.name)
    if (mountIndex === -1) {
      return { fields: { [`volumes.${index}.name`]: 'Repository volume must have a matching volume mount.' } }
    }
    const mountPath = normalizedMounts[mountIndex]!.mountPath
    if (!mountPath.startsWith('/workspace/') || mountPath.startsWith('/workspace/.ama/')) {
      return {
        fields: {
          [`volumeMounts.${mountIndex}.mountPath`]:
            'Repository mount path must stay under /workspace outside /workspace/.ama.',
        },
      }
    }
    if (mountPaths.has(mountPath)) {
      return { fields: { [`volumeMounts.${mountIndex}.mountPath`]: 'Mount path must be unique within a session.' } }
    }
    mountPaths.add(mountPath)
    normalizedVolumes.push({
      name: parsed.name,
      type: 'git_repository',
      url,
      ...(parsed.ref ? { ref: parsed.ref } : {}),
      ...(parsed.secretRef ? { secretRef: parsed.secretRef } : {}),
      ...(parsed.items ? { items: parsed.items } : {}),
    } satisfies GitRepositoryVolume)
  }
  return { volumes: normalizedVolumes, volumeMounts: normalizedMounts }
}

export function workspaceMountPath(name: string, mounts: VolumeMount[], fallback: string): string {
  return volumeMountPath(name, mounts) ?? fallback
}

function normalizeWorkspaceMountPath(path: string) {
  const trimmed = path.trim()
  if (!trimmed || /[\p{C}\\]/u.test(trimmed)) {
    return null
  }
  const absolute = trimmed.startsWith('/') ? trimmed : `/workspace/${trimmed}`
  if (!absolute.startsWith('/workspace/')) {
    return null
  }
  const relativePath = absolute.slice('/workspace/'.length)
  const segments = relativePath.split('/')
  if (segments.some((segment) => segment.length === 0 || segment === '.' || segment === '..')) {
    return null
  }
  return `/workspace/${segments.join('/')}`
}

function relativeWorkspacePath(path: string): string {
  if (path === '/workspace') {
    return '.'
  }
  if (path.startsWith('/workspace/')) {
    return path.slice('/workspace/'.length)
  }
  return path
}
