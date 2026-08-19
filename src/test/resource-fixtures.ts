import type {
  Agent,
  AgentSpec,
  AgentVersion,
  Environment,
  EnvironmentSpec,
  MemoryStore,
  MemoryStoreMemory,
  ResourceMetadata,
  Runner,
  Trigger,
  TriggerSchedule,
  Vault,
  VaultCredential,
  VaultCredentialVersion,
} from '@/lib/amarpc'

const now = '2026-05-23T00:00:00.000Z'
type JsonObject = VaultCredential['spec']['metadata']

export type ResourceMetadataOverrides = Partial<ResourceMetadata> & {
  id?: string
  name?: string
  description?: string | null
  archivedAt?: string | null
}

export function metadata(overrides: ResourceMetadataOverrides = {}): ResourceMetadata {
  return {
    uid: overrides.uid ?? overrides.id ?? 'resource_1',
    projectId: overrides.projectId === undefined ? 'project_1' : overrides.projectId,
    name: overrides.name ?? 'Resource',
    description: overrides.description === undefined ? null : overrides.description,
    labels: overrides.labels ?? {},
    annotations: overrides.annotations ?? {},
    createdBy: overrides.createdBy === undefined ? 'user_1' : overrides.createdBy,
    createdAt: overrides.createdAt ?? now,
    updatedAt: overrides.updatedAt ?? now,
    archivedAt: overrides.archivedAt === undefined ? null : overrides.archivedAt,
  }
}

export type AgentOverrides = ResourceMetadataOverrides &
  Partial<AgentSpec> & {
    currentVersionId?: string | null
    version?: number
  }

export function agent(overrides: AgentOverrides = {}): Agent {
  return {
    metadata: metadata({
      id: 'agent_1',
      name: 'Coding agent',
      description: null,
      ...overrides,
    }),
    spec: {
      systemPrompt: overrides.systemPrompt === undefined ? 'Do the work' : overrides.systemPrompt,
      provider: overrides.provider === undefined ? 'workers-ai' : overrides.provider,
      model: overrides.model === undefined ? '@cf/moonshotai/kimi-k2.6' : overrides.model,
      skills: overrides.skills ?? ['ama@coding-agent'],
      subagents: overrides.subagents ?? [],
      allowedTools: overrides.allowedTools ?? ['read', 'write'],
      mcpConnectors: overrides.mcpConnectors ?? [],
      realmroot: overrides.realmroot ?? null,
    },
    status: {
      phase: overrides.archivedAt ? 'archived' : 'active',
      currentVersionId: overrides.currentVersionId === undefined ? 'agentver_1' : overrides.currentVersionId,
      version: overrides.version ?? 1,
    },
  }
}

export type AgentVersionOverrides = ResourceMetadataOverrides &
  Partial<AgentSpec> & {
    agentId?: string
    version?: number
  }

export function agentVersion(overrides: AgentVersionOverrides = {}): AgentVersion {
  return {
    metadata: metadata({ id: 'agentver_1', name: 'Agent v1', ...overrides }),
    spec: agent(overrides).spec,
    status: {
      agentId: overrides.agentId ?? 'agent_1',
      version: overrides.version ?? 1,
    },
  }
}

type LegacyEnvironmentPackage = { name: string; version?: string }
type LegacyEnvironmentNetworkPolicy = { mode: 'unrestricted' | 'restricted' | 'offline'; allowedHosts?: string[] }

export type EnvironmentOverrides = ResourceMetadataOverrides &
  Omit<Partial<EnvironmentSpec>, 'packages'> & {
    packages?: EnvironmentSpec['packages'] | LegacyEnvironmentPackage[]
    hostingMode?: EnvironmentSpec['type']
    networkPolicy?: LegacyEnvironmentNetworkPolicy
    runtimeConfig?: Record<string, unknown>
    mcpPolicy?: Record<string, unknown>
    packageManagerPolicy?: Record<string, unknown>
    resourceLimits?: Record<string, unknown>
    currentVersionId?: string | null
    version?: number
  }

function normalizeEnvironmentPackages(value: EnvironmentOverrides['packages']): EnvironmentSpec['packages'] {
  if (!value) {
    return { type: 'packages', apt: [], cargo: [], gem: [], go: [], npm: [], pip: [] }
  }
  if (Array.isArray(value)) {
    return {
      type: 'packages',
      apt: [],
      cargo: [],
      gem: [],
      go: [],
      npm: value.map((item) => `${item.name}${item.version ? `@${item.version}` : ''}`),
      pip: [],
    }
  }
  return value
}

function normalizeEnvironmentNetworking(overrides: EnvironmentOverrides): EnvironmentSpec['networking'] {
  if (overrides.networking) {
    return overrides.networking
  }
  if (overrides.networkPolicy?.mode === 'restricted') {
    return {
      type: 'limited',
      allowMcpServers: false,
      allowPackageManagers: true,
      allowedHosts: overrides.networkPolicy.allowedHosts ?? [],
    }
  }
  if (overrides.networkPolicy?.mode === 'offline') {
    return { type: 'closed', allowMcpServers: false, allowPackageManagers: true }
  }
  return { type: 'limited', allowMcpServers: false, allowPackageManagers: true, allowedHosts: [] }
}

export function environment(overrides: EnvironmentOverrides = {}): Environment {
  return {
    metadata: metadata({
      id: 'env_1',
      name: 'Node workspace',
      description: null,
      ...overrides,
    }),
    spec: {
      scope: overrides.scope ?? 'project',
      type: overrides.type ?? overrides.hostingMode ?? 'cloud',
      networking: normalizeEnvironmentNetworking(overrides),
      packages: normalizeEnvironmentPackages(overrides.packages),
      variables: overrides.variables ?? {},
    },
    status: {
      phase: overrides.archivedAt ? 'archived' : 'active',
      currentVersionId: overrides.currentVersionId ?? 'envver_1',
      version: overrides.version ?? 1,
    },
  }
}

export type VaultOverrides = ResourceMetadataOverrides & {
  organizationId?: string
  scope?: 'project' | 'organization'
}

export function vault(overrides: VaultOverrides = {}): Vault {
  return {
    metadata: metadata({
      id: 'vault_1',
      name: 'Provider credentials',
      description: 'Model provider tokens',
      ...overrides,
    }),
    spec: {
      organizationId: overrides.organizationId ?? 'org_1',
      scope: overrides.scope ?? 'project',
    },
    status: {
      phase: overrides.archivedAt ? 'archived' : 'active',
    },
  }
}

export type VaultCredentialVersionOverrides = ResourceMetadataOverrides & {
  credentialId?: string
  vaultId?: string
  organizationId?: string
  version?: number
  provider?: 'ama'
  secretRef?: string
  referenceName?: string
  hasSecret?: boolean
  dataKeys?: string[]
  metadata?: JsonObject
  phase?: 'active' | 'superseded' | 'revoked'
  supersededAt?: string | null
  revokedAt?: string | null
}

export function vaultCredentialVersion(overrides: VaultCredentialVersionOverrides = {}): VaultCredentialVersion {
  return {
    metadata: metadata({ id: 'vaultver_1', name: 'Credential v1', ...overrides }),
    spec: {
      credentialId: overrides.credentialId ?? 'vaultcred_1',
      vaultId: overrides.vaultId ?? 'vault_1',
      organizationId: overrides.organizationId ?? 'org_1',
      version: overrides.version ?? 1,
      provider: overrides.provider ?? 'ama',
      secretRef: overrides.secretRef ?? 'ama-secret://vault_1/vaultcred_1',
      referenceName: overrides.referenceName ?? 'AMA_VAULTCRED_1_V1',
      hasSecret: overrides.hasSecret ?? true,
      dataKeys: overrides.dataKeys ?? ['value'],
      metadata: overrides.metadata ?? {},
    },
    status: {
      phase: overrides.phase ?? 'active',
      supersededAt: overrides.supersededAt ?? null,
      revokedAt: overrides.revokedAt ?? null,
    },
  }
}

export type VaultCredentialOverrides = ResourceMetadataOverrides & {
  vaultId?: string
  organizationId?: string
  type?: VaultCredential['spec']['type']
  metadata?: JsonObject
  phase?: 'active' | 'revoked'
  activeVersionId?: string | null
  activeVersion?: VaultCredentialVersion | null
  revokedAt?: string | null
  revokedByUserId?: string | null
  revokeReason?: string | null
}

export function credential(overrides: VaultCredentialOverrides = {}): VaultCredential {
  return {
    metadata: metadata({ id: 'vaultcred_1', name: 'OpenAI key', ...overrides }),
    spec: {
      vaultId: overrides.vaultId ?? 'vault_1',
      organizationId: overrides.organizationId ?? 'org_1',
      type: overrides.type ?? 'opaque',
      metadata: overrides.metadata ?? {},
    },
    status: {
      phase: overrides.phase ?? 'active',
      activeVersionId: overrides.activeVersionId ?? 'vaultver_1',
      activeVersion:
        overrides.activeVersion === undefined
          ? vaultCredentialVersion({ version: 2, credentialId: overrides.id ?? 'vaultcred_1' })
          : overrides.activeVersion,
      revokedAt: overrides.revokedAt ?? null,
      revokedByUserId: overrides.revokedByUserId ?? null,
      revokeReason: overrides.revokeReason ?? null,
    },
  }
}

export type MemoryStoreOverrides = ResourceMetadataOverrides

export function memoryStore(overrides: MemoryStoreOverrides = {}): MemoryStore {
  return {
    metadata: metadata({ id: 'store_1', name: 'Project memory', description: 'Reusable notes', ...overrides }),
    spec: {},
    status: {
      phase: overrides.archivedAt ? 'archived' : 'active',
    },
  }
}

export type MemoryOverrides = ResourceMetadataOverrides & {
  storeId?: string
  path?: string
  content?: string
  metadata?: JsonObject
}

export function memory(overrides: MemoryOverrides = {}): MemoryStoreMemory {
  return {
    metadata: metadata({ id: 'memory_1', name: overrides.path ?? 'guides/review.md', ...overrides }),
    spec: {
      storeId: overrides.storeId ?? 'store_1',
      path: overrides.path ?? 'guides/review.md',
      content: overrides.content ?? 'Review checklist',
      metadata: overrides.metadata ?? {},
    },
    status: {
      phase: overrides.archivedAt ? 'archived' : 'active',
    },
  }
}

export type RunnerOverrides = {
  id?: string
  projectId?: string
  name?: string
  environmentId?: string | null
  secretRef?: Runner['secretRef']
  authMode?: Runner['authMode']
  state?: Runner['state']
  currentLoad?: number
  maxConcurrent?: number
  runtimeUsage?: Runner['runtimeUsage']
  runtimes?: Runner['runtimes']
  metadata?: Runner['metadata']
  lastHeartbeatAt?: string | null
  archivedAt?: string | null
  createdAt?: string
  updatedAt?: string
}

export function runner(overrides: RunnerOverrides = {}): Runner {
  return {
    id: overrides.id ?? 'runner_1',
    projectId: overrides.projectId ?? 'project_1',
    name: overrides.name ?? 'Mac mini runner',
    environmentId: overrides.environmentId === undefined ? 'env_1' : overrides.environmentId,
    secretRef: overrides.secretRef ?? null,
    authMode: overrides.authMode ?? 'oidc',
    state: overrides.state ?? 'active',
    currentLoad: overrides.currentLoad ?? 1,
    maxConcurrent: overrides.maxConcurrent ?? 2,
    runtimeUsage: overrides.runtimeUsage ?? [],
    runtimes: overrides.runtimes ?? [
      { runtime: 'codex', models: ['gpt-5.3-codex'], version: '0.42.0', state: 'ready' },
    ],
    metadata: overrides.metadata ?? {},
    lastHeartbeatAt: overrides.lastHeartbeatAt === undefined ? now : overrides.lastHeartbeatAt,
    archivedAt: overrides.archivedAt === undefined ? null : overrides.archivedAt,
    createdAt: overrides.createdAt ?? now,
    updatedAt: overrides.updatedAt ?? now,
  }
}

export type TriggerOverrides = ResourceMetadataOverrides & {
  source?: Trigger['spec']['source']
  agentId?: Trigger['spec']['template']['spec']['agentId']
  environmentId?: Trigger['spec']['template']['spec']['environmentId']
  runtime?: Trigger['spec']['template']['spec']['runtime']
  promptTemplate?: string
  env?: Trigger['spec']['template']['spec']['env']
  envFrom?: Trigger['spec']['template']['spec']['envFrom']
  volumes?: Trigger['spec']['template']['spec']['volumes']
  volumeMounts?: Trigger['spec']['template']['spec']['volumeMounts']
  schedule?: TriggerSchedule | null
  suspend?: boolean
  templateMetadata?: Trigger['spec']['template']['metadata']
  nextDueAt?: string | null
  lastDispatchedAt?: string | null
  lastRunId?: string | null
}

export function trigger(overrides: TriggerOverrides = {}): Trigger {
  return {
    metadata: metadata({ id: 'trigger_1', name: 'Daily research heartbeat', ...overrides }),
    spec: {
      source:
        overrides.source ??
        (overrides.schedule === null
          ? { type: 'http' }
          : {
              type: 'schedule',
              schedule: overrides.schedule ?? { type: 'interval', intervalSeconds: 86400, windowSeconds: 0 },
            }),
      suspend: overrides.suspend ?? false,
      template: {
        metadata: overrides.templateMetadata ?? { labels: {}, annotations: {} },
        spec: {
          agentId: overrides.agentId ?? 'agent_1',
          environmentId: overrides.environmentId === undefined ? 'env_1' : overrides.environmentId,
          runtime: overrides.runtime ?? 'codex',
          promptTemplate: overrides.promptTemplate ?? 'Research current offers.',
          env: overrides.env ?? {},
          envFrom: overrides.envFrom ?? [],
          volumes: overrides.volumes ?? [],
          volumeMounts: overrides.volumeMounts ?? [],
        },
      },
    },
    status: {
      phase: overrides.archivedAt ? 'archived' : 'active',
      nextDueAt: overrides.nextDueAt === undefined ? '2026-06-19T12:00:00.000Z' : overrides.nextDueAt,
      lastDispatchedAt:
        overrides.lastDispatchedAt === undefined ? '2026-06-18T12:00:00.000Z' : overrides.lastDispatchedAt,
      lastRunId: overrides.lastRunId === undefined ? 'trigrun_1' : overrides.lastRunId,
    },
  }
}
