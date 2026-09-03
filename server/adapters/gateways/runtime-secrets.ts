import { gitRepositoryMountPath } from '@server/domain/git-repository'
import { memoryStoreIdFromRef } from '@server/domain/memory-store'
import {
  type EnvFromEntry,
  isEmptyDirVolume,
  isGitRepositoryVolume,
  isMemoryVolume,
  type SecretItem,
  type Volume,
  type VolumeMount,
  volumeMountPath,
  volumeMountReadOnly,
} from '@server/domain/runtime/execution-inputs'
import type {
  WorkspaceFile,
  WorkspaceGitCredential,
  WorkspaceManifest,
  WorkspaceManifestMount,
} from '@server/domain/workspace'
import type { RuntimeSecretGateway } from '@server/usecases/ports'
import type { drizzle } from 'drizzle-orm/d1'
import type { Env } from '../../env'
import { decryptSecretValue } from '../../vault-crypto'
import { createRuntimeOrchestrationRepo } from '../repos/runtime-orchestration'

type Db = ReturnType<typeof drizzle>

const ENV_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/

// Resolves envFrom secret handles into env values. Both
// dispatch paths use this seam: self-hosted lease materialization and cloud
// session startup. Enbor versions decrypt the stored ciphertext.
// Resolved values exist only in the runtime dispatch; they are never written
// to D1, session events, audit records, or logs.
export async function resolveEnvFrom(
  env: Env,
  db: Db,
  scope: { organizationId: string; projectId: string },
  items: EnvFromEntry[],
): Promise<Record<string, string>> {
  const resolved: Record<string, string> = {}
  const repo = createRuntimeOrchestrationRepo(db)
  for (const entry of items) {
    if (entry.type !== 'secret') {
      throw new Error(`Runtime envFrom entry has unsupported type ${entry.type}`)
    }
    const { secretRef } = entry
    const version = await repo.secretVersionForResolution(scope.organizationId, scope.projectId, secretRef)
    // Deleted versions are physically removed, so a missing row is unresolvable.
    if (!version) {
      throw new Error(`Runtime secret reference ${secretRef} cannot be resolved`)
    }
    if (version.state === 'revoked') {
      throw new Error(`Runtime secret reference ${secretRef} is revoked by vault policy`)
    }
    const data = await decryptVersionData(env, version.metadata, secretRef)
    if (entry.name === undefined) {
      if (entry.key !== undefined) {
        throw new Error(`Runtime secret reference ${secretRef} requires name when key is specified`)
      }
      for (const [name, value] of Object.entries(data)) {
        addResolvedEnv(resolved, name, value, secretRef)
      }
    } else {
      addResolvedEnv(resolved, entry.name, secretValueForEnv(entry, data, secretRef), secretRef)
    }
  }
  return resolved
}

export async function resolveRuntimeWorkspaceManifest(
  env: Env,
  db: Db,
  scope: { organizationId: string; projectId: string },
  volumes: Volume[],
  volumeMounts: VolumeMount[],
): Promise<WorkspaceManifest> {
  const mounts: WorkspaceManifestMount[] = []
  const repo = createRuntimeOrchestrationRepo(db)
  for (const volume of volumes) {
    const mountPath = volumeMountPath(volume.name, volumeMounts)
    if (isGitRepositoryVolume(volume)) {
      const credential = volume.secretRef
        ? await resolveGitCredential(env, repo, scope, volume.secretRef, volume.items)
        : undefined
      mounts.push({
        type: 'git_repository',
        name: volume.name,
        mountPath: mountPath ?? gitRepositoryMountPath(volume.url),
        url: volume.url,
        ...(volume.ref ? { ref: volume.ref } : {}),
        ...(credential ? { credential } : {}),
      })
      continue
    }
    if (isMemoryVolume(volume)) {
      const storeId = memoryStoreIdFromRef(volume.memoryRef)
      if (!storeId) {
        throw new Error(`Runtime memory store reference ${volume.memoryRef} cannot be resolved`)
      }
      const memoryStore = await repo.findActiveMemoryStoreResource(scope.projectId, storeId)
      if (!memoryStore) {
        throw new Error(`Runtime memory store reference ${volume.memoryRef} cannot be resolved`)
      }
      mounts.push({
        type: 'memory',
        name: volume.name,
        mountPath: mountPath ?? memoryStore.mountPath,
        memoryRef: memoryStore.memoryRef,
        readOnly: volumeMountReadOnly(volume.name, volumeMounts),
        files: memoryFiles(memoryStore.memories),
      })
      continue
    }
    if (isEmptyDirVolume(volume)) {
      const files: WorkspaceFile[] = []
      for (const projection of volume.seedFrom ?? []) {
        if (projection.type !== 'secret') {
          throw new Error(`Runtime empty directory volume ${volume.name} has unsupported seed projection`)
        }
        files.push(...(await resolveSecretMount(env, repo, scope, projection.secretRef, projection.items)))
      }
      const paths = new Set<string>()
      for (const file of files) {
        if (paths.has(file.path)) {
          throw new Error(`Runtime empty directory volume ${volume.name} projects duplicate item path ${file.path}`)
        }
        paths.add(file.path)
      }
      mounts.push({
        type: 'empty_dir',
        name: volume.name,
        mountPath: mountPath ?? `/workspace/.enbor/empty-dirs/${volume.name}`,
        readOnly: false,
        files,
      })
      continue
    }
    if (volume.type === 'secret') {
      const resolved = await resolveSecretMount(env, repo, scope, volume.secretRef, volume.items)
      mounts.push({
        type: 'secret',
        name: volume.name,
        mountPath: mountPath ?? `/workspace/.enbor/secrets/${volume.name}`,
        readOnly: true,
        files: resolved,
      })
    }
  }
  return { root: '/workspace', mounts }
}

async function resolveGitCredential(
  env: Env,
  repo: ReturnType<typeof createRuntimeOrchestrationRepo>,
  scope: { organizationId: string; projectId: string },
  secretRef: string,
  items: SecretItem[] | undefined,
): Promise<WorkspaceGitCredential> {
  const version = await repo.secretVersionForResolution(scope.organizationId, scope.projectId, secretRef)
  if (version?.state !== 'active') {
    throw new Error(`Runtime git secret reference ${secretRef} cannot be resolved`)
  }
  return gitCredentialFromSecretData(
    projectSecretData(await decryptVersionData(env, version.metadata, version.secretRef), items, secretRef),
    version.secretRef,
  )
}

function parseGitCredential(secret: string): WorkspaceGitCredential {
  const trimmed = secret.trim()
  const separator = trimmed.indexOf(':')
  if (separator >= 0) {
    return { username: trimmed.slice(0, separator), password: trimmed.slice(separator + 1) }
  }
  return { username: 'x-access-token', password: trimmed }
}

function gitCredentialFromSecretData(data: Record<string, string>, secretRef: string): WorkspaceGitCredential {
  if (typeof data.username === 'string' && typeof data.password === 'string') {
    return { username: data.username, password: data.password }
  }
  const token = data['access-token'] ?? data.token ?? data.value
  if (typeof token === 'string') {
    return parseGitCredential(token)
  }
  return parseGitCredential(data[singleDataKey(data, secretRef)]!)
}

async function resolveSecretMount(
  env: Env,
  repo: ReturnType<typeof createRuntimeOrchestrationRepo>,
  scope: { organizationId: string; projectId: string },
  secretRef: string,
  items: SecretItem[] | undefined,
): Promise<WorkspaceFile[]> {
  const version = await repo.secretVersionForResolution(scope.organizationId, scope.projectId, secretRef)
  if (version) {
    if (version.state !== 'active') {
      throw new Error(`Runtime secret reference ${secretRef} cannot be resolved`)
    }
    return filesFromSecretData(
      projectSecretData(await decryptVersionData(env, version.metadata, secretRef), items, secretRef),
    )
  }
  if (items && items.length > 0) {
    throw new Error(`Runtime secret reference ${secretRef} cannot use items without a credential reference`)
  }
  const versions = await repo.vaultVersionsForResolution(scope.organizationId, scope.projectId, secretRef)
  if (!versions) {
    throw new Error(`Runtime secret reference ${secretRef} cannot be resolved`)
  }
  const files: WorkspaceFile[] = []
  for (const credentialVersion of versions) {
    if (credentialVersion.state !== 'active') {
      continue
    }
    const credentialName = safeFileName(credentialVersion.name)
    for (const file of filesFromSecretData(
      await decryptVersionData(env, credentialVersion.metadata, credentialVersion.secretRef),
    )) {
      files.push({ path: `${credentialName}/${file.path}`, content: file.content })
    }
  }
  return files
}

function memoryFiles(memories: Array<{ path: string; content: string }>): WorkspaceFile[] {
  return memories.map((memory) => ({
    path: memory.path,
    content: memory.content,
  }))
}

async function decryptVersionData(env: Env, metadata: string, secretRef: string) {
  const parsed = parseMetadata(metadata)
  const encryptedSecretData = parsed?.encryptedSecretData
  if (!encryptedSecretData || typeof encryptedSecretData !== 'object' || Array.isArray(encryptedSecretData)) {
    throw new Error(`Runtime secret reference ${secretRef} cannot be resolved`)
  }
  const data: Record<string, string> = {}
  for (const [key, encrypted] of Object.entries(encryptedSecretData)) {
    const value = await decryptSecretValue(env, encrypted)
    if (typeof value !== 'string') {
      throw new Error(`Runtime secret reference ${secretRef} cannot be resolved`)
    }
    data[key] = value
  }
  return data
}

function secretValueForEnv(entry: EnvFromEntry, data: Record<string, string>, secretRef: string) {
  const key = entry.key ?? singleDataKey(data, secretRef)
  const value = data[key]
  if (typeof value !== 'string') {
    throw new Error(`Runtime secret reference ${secretRef} has no data key ${key}`)
  }
  return value
}

function addResolvedEnv(resolved: Record<string, string>, name: string, value: string, secretRef: string) {
  if (!ENV_NAME_PATTERN.test(name)) {
    throw new Error(`Runtime secret reference ${secretRef} projects invalid environment variable ${name}`)
  }
  if (Object.hasOwn(resolved, name)) {
    throw new Error(`Runtime secret reference ${secretRef} projects duplicate environment variable ${name}`)
  }
  resolved[name] = value
}

function projectSecretData(data: Record<string, string>, items: SecretItem[] | undefined, secretRef: string) {
  if (!items || items.length === 0) {
    return data
  }
  const projected: Record<string, string> = {}
  for (const item of items) {
    const value = data[item.key]
    if (typeof value !== 'string') {
      throw new Error(`Runtime secret reference ${secretRef} has no data key ${item.key}`)
    }
    const path = safeFilePath(item.path)
    if (Object.hasOwn(projected, path)) {
      throw new Error(`Runtime secret reference ${secretRef} projects duplicate item path ${path}`)
    }
    projected[path] = value
  }
  return projected
}

function singleDataKey(data: Record<string, string>, secretRef: string) {
  const keys = Object.keys(data)
  if (keys.length !== 1) {
    throw new Error(`Runtime secret reference ${secretRef} must specify a data key`)
  }
  return keys[0]!
}

function filesFromSecretData(data: Record<string, string>) {
  return Object.entries(data)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([path, content]) => ({ path: safeFilePath(path), content }))
}

function safeFileName(value: string) {
  if (!/^[A-Za-z0-9._-]+$/.test(value) || value === '.' || value === '..') {
    throw new Error(`Vault credential name cannot be mounted as a file: ${value}`)
  }
  return value
}

function safeFilePath(value: string) {
  if (
    !/^[A-Za-z0-9._/-]+$/.test(value) ||
    value.startsWith('/') ||
    value.split('/').some((segment) => !segment || segment === '.' || segment === '..')
  ) {
    throw new Error(`Vault credential item path cannot be mounted as a file: ${value}`)
  }
  return value
}

function parseMetadata(raw: unknown): Record<string, unknown> | null {
  if (typeof raw !== 'string') {
    return null
  }
  try {
    const parsed: unknown = JSON.parse(raw)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null
  } catch {
    return null
  }
}

// Wraps runtime secret projections behind the gateway port. Resolved values are
// used only for runtime dispatch and never persisted.
export function createRuntimeSecretGateway(env: Env, db: Db): RuntimeSecretGateway {
  return {
    async resolveEnv(scope, items) {
      return resolveEnvFrom(env, db, scope, items)
    },
    async resolveWorkspaceManifest(scope, volumes, volumeMounts) {
      return resolveRuntimeWorkspaceManifest(env, db, scope, volumes, volumeMounts)
    },
  }
}
