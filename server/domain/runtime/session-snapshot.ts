import type { AgentVersionRow, EnvironmentVersionRow } from '@shared/runtime-rows'
import type { AgentSubagent, LegacyRealmrootAgentBinding, RealmrootAgentIdentity } from '../agent'
import {
  defaultEnvironmentPackages,
  type EnvironmentNetworking,
  type EnvironmentPackages,
  type EnvironmentVariable,
} from '../environment'
import type { RuntimeName } from '../runtime-catalog'
import { workspaceSystemPromptBlock } from '../workspace'
import type { Volume, VolumeMount } from './execution-inputs'

// Snapshot creation (DB row -> immutable session snapshot) and volume
// normalization for the session runtime data plane. Pure shaping/validation with
// no env or D1 dependency, factored out of the orchestration module.

export function parseJson<T>(value: string | null) {
  return value ? (JSON.parse(value) as T) : null
}

export function objectValue(value: unknown) {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

function legacyRealmrootBinding(value: string | null): LegacyRealmrootAgentBinding | null {
  return value ? (JSON.parse(value) as LegacyRealmrootAgentBinding) : null
}

export function createAgentSnapshot(
  row: AgentVersionRow,
  providerId: string,
  identity: RealmrootAgentIdentity | null,
  runtime: RuntimeName,
) {
  return {
    id: row.id,
    agentId: row.agentId,
    projectId: row.projectId,
    version: row.version,
    runtime,
    systemPrompt: row.systemPrompt,
    provider: providerId,
    model: row.model,
    skills: JSON.parse(row.skills) as string[],
    subagents: JSON.parse(row.subagents) as AgentSubagent[],
    allowedTools: JSON.parse(row.allowedTools) as string[],
    mcpConnectors: JSON.parse(row.mcpConnectors) as string[],
    identity,
    realmroot: legacyRealmrootBinding(row.realmroot),
    createdAt: row.createdAt,
  }
}

export type AgentSnapshot = Omit<ReturnType<typeof createAgentSnapshot>, 'realmroot'> & {
  realmroot?: LegacyRealmrootAgentBinding | null
}

export function parseAgentSnapshot(value: string | null) {
  const snapshot = parseJson<AgentSnapshot & { runtime?: RuntimeName; identity?: RealmrootAgentIdentity | null }>(value)
  if (!snapshot) return null
  return {
    ...snapshot,
    runtime: snapshot.runtime ?? 'codex',
    identity: snapshot.identity ?? null,
    realmroot: snapshot.realmroot ?? null,
  } satisfies AgentSnapshot
}

export function agentSnapshotWithWorkspaceContext(
  agentSnapshot: AgentSnapshot,
  volumes: Volume[],
  volumeMounts: VolumeMount[],
): AgentSnapshot {
  const block = workspaceSystemPromptBlock({ volumes, volumeMounts })
  const realmrootBlock =
    agentSnapshot.identity || agentSnapshot.realmroot
      ? 'Private Resources are available through the Realmroot Toolbox. Use `realmroot toolbox` to discover services and request only the authority required for the current task.'
      : null
  const context = [block, realmrootBlock].filter((value): value is string => Boolean(value)).join('\n\n')
  if (!context) {
    return agentSnapshot
  }
  const systemPrompt = agentSnapshot.systemPrompt?.trim()
  return {
    ...agentSnapshot,
    systemPrompt: systemPrompt ? `${systemPrompt}\n\n${context}` : context,
  }
}

function normalizePackages(value: unknown): EnvironmentPackages {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return defaultEnvironmentPackages()
  }
  const packages = value as Record<string, unknown>
  return {
    ...defaultEnvironmentPackages(),
    type: 'packages',
    apt: stringArray(packages.apt),
    cargo: stringArray(packages.cargo),
    gem: stringArray(packages.gem),
    go: stringArray(packages.go),
    npm: stringArray(packages.npm),
    pip: stringArray(packages.pip),
  }
}

function networkingFromRow(row: EnvironmentVersionRow): EnvironmentNetworking {
  const policy = JSON.parse(row.networkPolicy) as Record<string, unknown>
  return {
    type: policy.mode === 'offline' ? 'closed' : policy.mode === 'restricted' ? 'limited' : 'open',
    allowMcpServers: policy.allowMcpServers === true,
    allowPackageManagers: policy.allowPackageManagers !== false,
    ...(Array.isArray(policy.allowedHosts) ? { allowedHosts: stringArray(policy.allowedHosts) } : {}),
  }
}

function normalizeNetworking(value: unknown): EnvironmentNetworking {
  const networking = objectValue(value)
  const type = networking.type === 'closed' || networking.type === 'limited' ? networking.type : 'open'
  return {
    type,
    allowMcpServers: networking.allowMcpServers === true,
    allowPackageManagers: networking.allowPackageManagers !== false,
    ...(type === 'limited' ? { allowedHosts: stringArray(networking.allowedHosts) } : {}),
  }
}

function normalizeVariables(value: unknown): Record<string, EnvironmentVariable> {
  return Object.fromEntries(
    Object.entries(objectValue(value)).map(([key, variable]) => {
      const descriptor = objectValue(variable)
      return [
        key,
        {
          ...(typeof descriptor.description === 'string' ? { description: descriptor.description } : {}),
          ...(typeof descriptor.required === 'boolean' ? { required: descriptor.required } : {}),
        },
      ]
    }),
  )
}

export function createEnvironmentSnapshot(row: EnvironmentVersionRow) {
  const metadata = JSON.parse(row.metadata) as Record<string, unknown>
  return {
    id: row.id,
    environmentId: row.environmentId,
    projectId: row.projectId,
    version: row.version,
    scope: metadata.scope === 'organization' ? ('organization' as const) : ('project' as const),
    type: row.hostingMode === 'self_hosted' ? ('self_hosted' as const) : ('cloud' as const),
    networking: networkingFromRow(row),
    packages: normalizePackages(JSON.parse(row.packages) as unknown),
    variables: JSON.parse(row.variables) as Record<string, unknown>,
    createdAt: row.createdAt,
  }
}

export type EnvironmentSnapshot = ReturnType<typeof createEnvironmentSnapshot>

export function normalizeEnvironmentSnapshot(
  snapshot: ReturnType<typeof createEnvironmentSnapshot> | Record<string, unknown> | null,
): EnvironmentSnapshot | null {
  if (!snapshot) {
    return null
  }
  const snapshotRecord = snapshot as Record<string, unknown>
  return {
    id: typeof snapshotRecord.id === 'string' ? snapshotRecord.id : '',
    environmentId: typeof snapshotRecord.environmentId === 'string' ? snapshotRecord.environmentId : '',
    projectId: typeof snapshotRecord.projectId === 'string' ? snapshotRecord.projectId : '',
    version: typeof snapshotRecord.version === 'number' ? snapshotRecord.version : Number(snapshotRecord.version ?? 0),
    scope: snapshotRecord.scope === 'organization' ? 'organization' : 'project',
    type: snapshotRecord.type === 'self_hosted' ? 'self_hosted' : 'cloud',
    networking: normalizeNetworking(snapshotRecord.networking),
    packages: normalizePackages(snapshotRecord.packages),
    variables: normalizeVariables(snapshotRecord.variables),
    createdAt: typeof snapshotRecord.createdAt === 'string' ? snapshotRecord.createdAt : '',
  }
}
