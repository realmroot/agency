import type { Agent, AgentSpec, AgentVersion } from '@server/domain/agent'
import type { ConnectorAvailability, ConnectorCatalogEntry, ConnectorCatalogTool } from '@server/domain/connector'
import type { Environment, EnvironmentConfig, EnvironmentVersion } from '@server/domain/environment'
import type { Memory, MemoryStore, MemoryStoreAccess } from '@server/domain/memory-store'
import type { CatalogModel } from '@server/domain/model-catalog'
import type { ModelAvailability, ModelCatalogState } from '@server/domain/provider'
import type { RunnerAuthMode } from '@server/domain/runner-queue'
import type { EnvFromEntry, MemoryVolume, Volume, VolumeMount } from '@server/domain/runtime/execution-inputs'
import type {
  MessageDelivery,
  MessageState,
  Session,
  SessionApproval,
  SessionEvent,
  SessionMessage,
  SessionState,
} from '@server/domain/session'
import type { Trigger, TriggerRun, TriggerSessionTemplate, TriggerSource } from '@server/domain/trigger'
import type {
  Credential,
  CredentialState,
  CredentialType,
  CredentialVersion,
  SecretMaterial,
  SecretReference,
  Vault,
  VaultScope,
  VersionState,
} from '@server/domain/vault'
import type { WorkspaceManifest } from '@server/domain/workspace'
import type { AmaEvent } from '@shared/session-events'

export type {
  EnvFromEntry,
  Volume,
  VolumeMount,
} from '@server/domain/runtime/execution-inputs'

export type { Session, SessionApproval, SessionEvent, SessionMessage }

// A port-level error so the http layer can map orchestration validation
// failures to a 400 without importing usecases internals or adapters. The
// fields map mirrors the domain FieldErrors shape.
export class AgentValidationError extends Error {
  readonly fields: Record<string, string>
  constructor(message: string, fields: Record<string, string>) {
    super(message)
    this.name = 'AgentValidationError'
    this.fields = fields
  }
}

// Agent thrown when an archived agent receives field updates. The http layer
// maps it to 409.
export class AgentArchivedError extends Error {
  constructor(message = 'Archived agents cannot be updated') {
    super(message)
    this.name = 'AgentArchivedError'
  }
}

// Identity claims the audit + policy ports need. Mirrors the http auth context
// without dragging the http auth module into usecases.
export interface AuthScope {
  organization: { id: string; name: string }
  project: { id: string; name: string; organizationId?: string }
  user: { id: string }
  roles: string[]
  permissions: string[]
  teams?: string[]
}

// Organization-level identity: the AuthScope subset that org-scoped usecases
// (which never resolve a project) require. Both AuthScope and the project-less
// http AuthIdentity satisfy it structurally, so neither needs a cast.
export type OrgScope = Pick<AuthScope, 'organization'>

export interface AgentListQuery {
  projectId: string
  archived: boolean
  search?: string
  createdFrom?: string
  createdTo?: string
  limit: number
  cursor: { createdAt: string; id: string } | null
}

export interface AgentListPage {
  rows: Agent[]
  hasMore: boolean
}

export interface CreateAgentInput {
  projectId: string
  name: string
  description: string | null
  spec: AgentSpec
}

export interface UpdateAgentFields {
  name: string
  description: string | null
  spec: AgentSpec
  archivedAt: string | null
  currentVersionId: string | null
}

// DB boundary. The only implementation lives in adapters/repos and is the only
// place drizzle/schema is imported. Repos return parsed records — no JSON
// strings, no drizzle rows leak past this port.
export interface AgentRepo {
  list(query: AgentListQuery): Promise<AgentListPage>
  find(projectId: string, agentId: string): Promise<Agent | null>
  // Live (non-archived) agents in the project, newest first.
  liveAgents(projectId: string): Promise<Agent[]>

  latestVersionNumber(agentId: string): Promise<number | null>
  insertVersion(agent: Agent, spec: AgentSpec, createdAt: string): Promise<AgentVersion>
  listVersions(projectId: string, agentId: string): Promise<AgentVersion[]>
  findVersion(projectId: string, agentId: string, version: number): Promise<AgentVersion | null>

  insert(input: CreateAgentInput, createdAt: string): Promise<Agent>
  setCurrentVersion(agentId: string, versionId: string): Promise<void>
  update(projectId: string, agentId: string, fields: UpdateAgentFields, updatedAt: string): Promise<void>
  unarchive(projectId: string, agentId: string, updatedAt: string): Promise<void>

  // Reference validation against sibling resources.
  providerEnabled(projectId: string, providerId: string): Promise<boolean>
  connectorAvailable(connectorId: string): Promise<boolean>
}

export interface AuditEntry {
  action: string
  resourceType: string
  resourceId?: string | null
  outcome: 'success' | 'failure' | 'denied'
  requestId?: string | null
  // Correlates the audit record with a broader dispatch flow (e.g. a scheduled
  // trigger run). Persisted to the audit_records.correlation_id column.
  correlationId?: string | null
  // Correlates the audit record with a session (e.g. a tool call denied inside
  // a session). Persisted to the audit_records.session_id column.
  sessionId?: string | null
  policyCategory?: string | null
  before?: unknown
  after?: unknown
  metadata?: Record<string, unknown>
}

// Audit log boundary. Records governance-relevant mutations.
export interface AuditPort {
  record(auth: AuthScope, entry: AuditEntry): Promise<void>
}

// A policy decision crossing the port boundary. Mirrors the http-layer
// PolicyDecision so usecases can branch on it without importing the policy
// module.
export interface PolicyDecisionResult {
  allowed: boolean
  category: string
  rule: string | null
  message: string
}

// The sandbox operation a runtime tool maps to, mirrored at the port boundary
// so the runtime callers branch on it without importing the policy module.
// Structurally matches domain/policy's SandboxRuntimeOperation so the adapter's
// real return value is assignable.
export type SandboxRuntimeOperationView =
  | { operation: 'command'; command: string | null; resourceType: 'sandbox_command'; resourceId: string }
  | { operation: 'network'; host: string | null; resourceType: 'sandbox_network'; resourceId: string }

// A blocked sandbox operation: the denying decision plus the operation it
// concerns. Null at the call site means the tool is not a sandbox operation or
// the operation is allowed.
export interface SandboxPolicyBlock {
  decision: PolicyDecisionResult
  operation: SandboxRuntimeOperationView
}

// Session-creation provider decision crossing the port boundary. Mirrors
// server/policy's ProviderPolicySessionDecision: the resolved decision plus the
// denied decision an admin explicitly overrode (null when none).
export interface ProviderPolicySessionDecisionView {
  decision: PolicyDecisionResult
  override: PolicyDecisionResult | null
}

// Effective-policy boundary. Agents need the merged tool policy that gates which
// tools an agent version may attach. The effective-policy resource reads the full
// merged policy and evaluates provider/model decisions. The DB-mixed hierarchy
// resolution and provider evaluation stay in server/policy.ts behind this port.
export interface PolicyPort {
  resolveToolPolicy(auth: AuthScope): Promise<Record<string, unknown>>
  resolveMcpPolicy(auth: AuthScope): Promise<Record<string, unknown>>
  evaluateMcpTool(
    auth: AuthScope,
    values: {
      connectorId: string
      toolName: string
      session: { id: string; agentSnapshot: string | null; environmentSnapshot: string | null }
    },
  ): Promise<PolicyDecisionResult>
  resolveEffective(auth: AuthScope): Promise<EffectivePolicyResult>
  evaluateProvider(auth: AuthScope, values: { providerId: string; modelId: string }): Promise<PolicyDecisionResult>
  // Sandbox executor seam: evaluates a startup/command/network operation against
  // the governance sandbox policy and the session environment network policy.
  // Session creation gates the cloud startup; the executor gates command/network.
  evaluateSandboxRuntime(
    auth: AuthScope,
    values: {
      session: { id: string; agentSnapshot: string | null; environmentSnapshot: string | null }
      operation: 'startup' | 'command' | 'network'
      command: string | null
      host: string | null
    },
  ): Promise<PolicyDecisionResult>
  // Maps a runtime tool call to its sandbox operation and gates it. Returns null
  // when the tool is not a sandbox operation or the operation is allowed.
  policyBlocksSandboxOperation(
    auth: AuthScope,
    values: {
      session: { id: string; agentSnapshot: string | null; environmentSnapshot: string | null }
      toolName: string
      input: Record<string, unknown>
    },
  ): Promise<SandboxPolicyBlock | null>
  // Whether a sensitive sandbox tool demands a human decision before execution.
  toolPolicyRequiresApproval(auth: AuthScope, toolName: string): Promise<boolean>
  // Session-creation provider gate: evaluates effective provider policy and
  // honors an explicit admin override request only for admin-role callers.
  evaluateProviderForSession(
    auth: AuthScope,
    values: { providerId: string; modelId: string | null; adminOverride?: boolean },
  ): Promise<ProviderPolicySessionDecisionView>
}

// --- environments ---

// Port-level validation error for environment orchestration. The http layer
// maps it to a 400 with the same field-keyed shape the domain produces.
export class EnvironmentValidationError extends Error {
  readonly fields: Record<string, string>
  constructor(message: string, fields: Record<string, string>) {
    super(message)
    this.name = 'EnvironmentValidationError'
    this.fields = fields
  }
}

// Thrown when an archived environment receives field updates. The http layer
// maps it to 409.
export class EnvironmentArchivedError extends Error {
  constructor(message = 'Archived environments cannot be updated') {
    super(message)
    this.name = 'EnvironmentArchivedError'
  }
}

export interface EnvironmentListQuery {
  projectId: string
  archived: boolean
  search?: string
  createdFrom?: string
  createdTo?: string
  limit: number
  cursor: { createdAt: string; id: string } | null
}

export interface EnvironmentListPage {
  rows: Environment[]
  hasMore: boolean
}

export interface CreateEnvironmentInput {
  projectId: string
  name: string
  description: string | null
  config: EnvironmentConfig
}

export interface UpdateEnvironmentFields {
  name: string
  description: string | null
  config: EnvironmentConfig
  archivedAt: string | null
  currentVersionId: string | null
}

// DB boundary for environments. The only implementation lives in
// adapters/repos and is the only place drizzle/schema is imported. Repos
// return parsed records — no JSON strings, no drizzle rows leak past this port.
export interface EnvironmentRepo {
  list(query: EnvironmentListQuery): Promise<EnvironmentListPage>
  find(projectId: string, environmentId: string): Promise<Environment | null>

  insertVersion(environment: Environment, config: EnvironmentConfig, createdAt: string): Promise<EnvironmentVersion>
  listVersions(projectId: string, environmentId: string): Promise<EnvironmentVersion[]>
  findVersion(projectId: string, environmentId: string, version: number): Promise<EnvironmentVersion | null>

  insert(input: CreateEnvironmentInput, createdAt: string): Promise<Environment>
  setCurrentVersion(environmentId: string, versionId: string): Promise<void>
  update(projectId: string, environmentId: string, fields: UpdateEnvironmentFields, updatedAt: string): Promise<void>
  unarchive(projectId: string, environmentId: string, updatedAt: string): Promise<void>

  connectorAvailable(connectorId: string): Promise<boolean>
}

// --- providers ---

// A provider is a model VENDOR (anthropic, openai, moonshotai, …). Global, not
// per-tenant: the platform serves one shared catalog. Populated by the scheduled
// discovery refresh.
export interface ProviderRecord {
  id: string
  slug: string
  displayName: string
  enabled: boolean
  metadata: Record<string, unknown>
  modelCatalogState: ModelCatalogState
  lastError: Record<string, unknown> | null
  createdAt: string
  updatedAt: string
}

export interface ProviderModelRecord {
  id: string
  providerId: string
  modelId: string
  displayName: string
  capabilities: string[]
  contextWindow: number | null
  pricing: Record<string, unknown>
  availability: ModelAvailability
  metadata: Record<string, unknown>
  createdAt: string
  updatedAt: string
}

// Discovery seeds vendor rows by slug.
export interface UpsertProviderInput {
  slug: string
  displayName: string
}

export interface UpsertProviderModelInput {
  providerId: string
  modelId: string
  displayName: string
  capabilities: string[]
  contextWindow: number | null
  pricing: Record<string, unknown>
  availability: ModelAvailability
  metadata: Record<string, unknown>
}

export interface ProviderCatalogStatus {
  modelCatalogState: ModelCatalogState
  lastError: Record<string, unknown> | null
}

// DB boundary for the GLOBAL vendor catalog (providers = model vendors) and
// their models. Populated by the scheduled discovery refresh; read by the model
// dropdown, policy, and usage. No per-tenant scope. The only implementation
// lives in adapters/repos.
export interface ProviderRepo {
  list(): Promise<ProviderRecord[]>
  find(providerId: string): Promise<ProviderRecord | null>
  findBySlug(slug: string): Promise<ProviderRecord | null>
  upsert(input: UpsertProviderInput, timestamp: string): Promise<ProviderRecord>
  setCatalogStatus(providerId: string, status: ProviderCatalogStatus, updatedAt: string): Promise<void>
  agentReferences(providerId: string): Promise<boolean>

  listModels(providerId?: string): Promise<ProviderModelRecord[]>
  findModel(providerId: string, modelId: string): Promise<ProviderModelRecord | null>
  upsertModel(
    input: UpsertProviderModelInput,
    timestamp: string,
  ): Promise<{ record: ProviderModelRecord; created: boolean }>
  deleteModel(modelRecordId: string): Promise<void>
}

// Discovery source boundary: fetches the platform's live model catalog from the
// Workers AI search API (native @cf models) and models.dev (third-party gateway
// models). Throws on transport/HTTP failure (normalized by the usecase).
export interface ProviderCatalogGateway {
  fetchPlatformCatalog(): Promise<CatalogModel[]>
}

// --- vaults ---

// Thrown when secret material is invalid (bad provider field combination,
// unapproved external path, secret-store failure). The http layer maps it to a
// 400 validation error keyed on the secret field.
export class VaultSecretError extends Error {
  constructor(message = 'Invalid secret reference') {
    super(message)
    this.name = 'VaultSecretError'
  }
}

// Thrown when a credential version cannot be deleted: it is the active version
// or pinned by live runtime metadata. The http layer maps it to 409.
export class VaultVersionReferencedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'VaultVersionReferencedError'
  }
}

export interface VaultListQuery {
  organizationId: string
  projectId: string
  archived: boolean
  search?: string
  createdFrom?: string
  createdTo?: string
  limit: number
  cursor: { createdAt: string; id: string } | null
}

export interface CredentialListQuery {
  vaultId: string
  state?: CredentialState
  search?: string
  createdFrom?: string
  createdTo?: string
  limit: number
  cursor: { createdAt: string; id: string } | null
}

export interface VersionListQuery {
  credentialId: string
  state?: VersionState
  createdFrom?: string
  createdTo?: string
  limit: number
  cursor: { createdAt: string; id: string } | null
}

export interface ListPageResult<T> {
  rows: T[]
  hasMore: boolean
}

export interface ResolvedMemoryStoreResource {
  type: 'memory'
  memoryRef: string
  name: string
  description: string | null
  access: MemoryStoreAccess
  mountPath: string
  memories: Array<{ path: string; content: string }>
}

export interface MemoryStoreListQuery {
  projectId: string
  archived: boolean
  search?: string
  createdFrom?: string
  createdTo?: string
  limit: number
  cursor: { createdAt: string; id: string } | null
}

export interface MemoryStoreMemoryListQuery {
  projectId: string
  storeId: string
  limit: number
  cursor: { createdAt: string; id: string } | null
}

export interface CreateMemoryStoreInput {
  projectId: string
  name: string
  description: string | null
}

export interface UpdateMemoryStoreFields {
  name: string
  description: string | null
  archivedAt: string | null
}

export interface CreateMemoryStoreMemoryInput {
  storeId: string
  projectId: string
  path: string
  content: string
  metadata: Record<string, unknown>
}

export interface UpdateMemoryStoreMemoryFields {
  path: string
  content: string
  metadata: Record<string, unknown>
}

export interface MemoryStoreRepo {
  list(query: MemoryStoreListQuery): Promise<ListPageResult<MemoryStore>>
  find(projectId: string, storeId: string): Promise<MemoryStore | null>
  insert(input: CreateMemoryStoreInput, createdAt: string): Promise<MemoryStore>
  update(projectId: string, storeId: string, fields: UpdateMemoryStoreFields, updatedAt: string): Promise<void>
  listMemories(query: MemoryStoreMemoryListQuery): Promise<ListPageResult<Memory>>
  findMemory(projectId: string, storeId: string, memoryId: string): Promise<Memory | null>
  insertMemory(input: CreateMemoryStoreMemoryInput, createdAt: string): Promise<Memory>
  updateMemory(
    projectId: string,
    storeId: string,
    memoryId: string,
    fields: UpdateMemoryStoreMemoryFields,
    updatedAt: string,
  ): Promise<void>
  deleteMemory(projectId: string, storeId: string, memoryId: string): Promise<void>
}

export interface VaultVisibility {
  organizationId: string
  projectId: string
}

export interface CreateVaultInput {
  organizationId: string
  projectId: string | null
  name: string
  description: string | null
  scope: VaultScope
}

export interface UpdateVaultFields {
  name: string
  description: string | null
  scope: VaultScope
  projectId: string | null
  archivedAt: string | null
}

export interface CreateCredentialInput {
  vaultId: string
  organizationId: string
  projectId: string | null
  name: string
  type: CredentialType
  metadata: Record<string, unknown>
}

export interface InsertVersionInput {
  id: string
  credentialId: string
  vaultId: string
  organizationId: string
  projectId: string | null
  version: number
  reference: SecretReference
  metadata: Record<string, unknown>
}

// DB boundary for vaults, credentials, and versions. The only implementation
// lives in adapters/repos. Visibility (project|organization scope) is enforced
// inside the repo.
export interface VaultRepo {
  list(query: VaultListQuery): Promise<ListPageResult<Vault>>
  find(vaultId: string, visibility: VaultVisibility): Promise<Vault | null>
  insert(input: CreateVaultInput, createdAt: string): Promise<Vault>
  update(vaultId: string, fields: UpdateVaultFields, updatedAt: string): Promise<void>
  hasCredentials(vaultId: string): Promise<boolean>

  listCredentials(query: CredentialListQuery): Promise<ListPageResult<Credential>>
  findCredential(vaultId: string, credentialId: string): Promise<Credential | null>
  activeVersion(credential: Credential): Promise<CredentialVersion | null>
  latestVersionNumber(credentialId: string): Promise<number>
  insertCredentialWithVersion(
    credential: CreateCredentialInput,
    version: InsertVersionInput,
    createdAt: string,
  ): Promise<{ credential: Credential; version: CredentialVersion }>
  updateCredential(
    credentialId: string,
    fields: {
      metadata: Record<string, unknown>
      state: CredentialState
      activeVersionId: string | null
      revokedAt: string | null
      revokedByUserId: string | null
      revokeReason: string | null
    },
    updatedAt: string,
    revokeActiveVersions: boolean,
    revokedAt: string,
  ): Promise<void>

  listVersions(query: VersionListQuery): Promise<ListPageResult<CredentialVersion>>
  findVersion(credentialId: string, versionId: string): Promise<CredentialVersion | null>
  insertVersionRotation(
    version: InsertVersionInput,
    previousActiveVersionId: string | null,
    timestamp: string,
  ): Promise<CredentialVersion>
  deleteVersion(versionId: string): Promise<void>
  versionHasActiveReferences(version: CredentialVersion): Promise<boolean>
}

// Secret-store boundary. Stores a secret value for a credential version and
// returns stored metadata such as ciphertext. Throws on invalid material.
export interface SecretStoreGateway {
  store(reference: SecretReference, values: SecretMaterial): Promise<Record<string, unknown> | undefined>
}

// --- connectors ---

export interface ConnectorRecord extends ConnectorCatalogEntry {
  createdAt: string
  updatedAt: string
}

export interface ConnectorListQuery {
  search?: string
  category?: string
  trustLevel?: string
  capability?: string
  availability?: ConnectorAvailability
  limit: number
  cursor: { createdAt: string; id: string } | null
}

// DB boundary for the connector catalog. The catalog is a static, read-only
// platform directory; rows are lazily seeded once and only read afterwards.
export interface ConnectorRepo {
  seedCatalog(): Promise<void>
  list(query: ConnectorListQuery): Promise<ListPageResult<ConnectorRecord>>
  find(connectorId: string): Promise<ConnectorRecord | null>
}

// Session-event boundary. Runtime flows append canonical session events so
// activity stays inspectable on the session after completion.
// --- governance: policies, access rules, budgets ---

import type { BudgetScope, PolicyScopeLevel } from '@server/domain/policy'

// Field-keyed validation error for governance CRUD orchestration (scope rules,
// immutability). The http layer maps it to a 400 with the same shape the domain
// produces.
export class GovernanceValidationError extends Error {
  readonly fields: Record<string, string>
  constructor(message: string, fields: Record<string, string>) {
    super(message)
    this.name = 'GovernanceValidationError'
    this.fields = fields
  }
}

// Thrown when a scoped policy already exists for the requested scope. The http
// layer maps it to 409.
export class PolicyScopeConflictError extends Error {
  readonly policyId: string
  constructor(policyId: string, message = 'A policy already exists for this scope') {
    super(message)
    this.name = 'PolicyScopeConflictError'
    this.policyId = policyId
  }
}

export interface PolicyScope {
  level: PolicyScopeLevel
  teamId?: string
}

export interface PolicyRecord {
  id: string
  projectId: string
  scope: PolicyScope
  toolPolicy: Record<string, unknown>
  mcpPolicy: Record<string, unknown>
  sandboxPolicy: Record<string, unknown>
  metadata: Record<string, unknown>
  createdAt: string
  updatedAt: string
}

export interface CreatePolicyInput {
  organizationId: string
  projectId: string
  scope: PolicyScope
  toolPolicy: Record<string, unknown>
  mcpPolicy: Record<string, unknown>
  sandboxPolicy: Record<string, unknown>
  metadata: Record<string, unknown>
}

export interface ReplacePolicyFields {
  toolPolicy: Record<string, unknown>
  mcpPolicy: Record<string, unknown>
  sandboxPolicy: Record<string, unknown>
  metadata: Record<string, unknown>
}

// DB boundary for scoped governance policy documents. The only implementation
// lives in adapters/repos. Repos return parsed records — no JSON strings.
export interface PolicyRepo {
  list(projectId: string): Promise<PolicyRecord[]>
  find(projectId: string, policyId: string): Promise<PolicyRecord | null>
  findByScope(projectId: string, scope: PolicyScope): Promise<PolicyRecord | null>
  insert(input: CreatePolicyInput, timestamp: string): Promise<PolicyRecord>
  replace(projectId: string, policyId: string, fields: ReplacePolicyFields, updatedAt: string): Promise<PolicyRecord>
  delete(projectId: string, policyId: string): Promise<void>
}

export interface BudgetRecord {
  id: string
  scope: BudgetScope
  providerId: string | null
  modelId: string | null
  limitType: 'tokens' | 'cost_micros' | 'sessions'
  limitValue: number
  window: 'day' | 'month'
  enabled: boolean
  metadata: Record<string, unknown>
  createdAt: string
  updatedAt: string
}

export interface CreateBudgetInput {
  organizationId: string
  projectId: string
  scope: BudgetScope
  providerId: string | null
  modelId: string | null
  limitType: 'tokens' | 'cost_micros' | 'sessions'
  limitValue: number
  window: 'day' | 'month'
  enabled: boolean
  metadata: Record<string, unknown>
}

export interface UpdateBudgetFields {
  limitValue: number
  window: 'day' | 'month'
  enabled: boolean
  metadata: Record<string, unknown>
}

// DB boundary for usage budgets. The only implementation lives in
// adapters/repos.
export interface BudgetRepo {
  list(projectId: string): Promise<BudgetRecord[]>
  listEnabled(projectId: string): Promise<BudgetRecord[]>
  find(projectId: string, budgetId: string): Promise<BudgetRecord | null>
  insert(input: CreateBudgetInput, timestamp: string): Promise<BudgetRecord>
  update(projectId: string, budgetId: string, fields: UpdateBudgetFields, updatedAt: string): Promise<BudgetRecord>
  delete(projectId: string, budgetId: string): Promise<void>
}

// The merged effective governance policy (org → team → project) the
// effective-policy resource reads. Mirrors resolveEffectivePolicy's projection;
// the heavy hierarchy resolution stays in server/policy.ts behind this port.
export interface EffectivePolicyResult {
  source: { type: string; id: string }
  sources: { scope: string; id: string; teamId: string | null }[]
  toolPolicy: Record<string, unknown>
  mcpPolicy: Record<string, unknown>
  sandboxPolicy: Record<string, unknown>
}

// --- policy evaluation (read side) ---

import type { BudgetRule, BudgetUsageRecord, PolicyLevel } from '@server/domain/policy'

// A provider row the policy engine evaluates: enablement + the vault credential
// binding it must verify is still usable.
export interface PolicyProvider {
  id: string
  enabled: boolean
  credentialId: string | null
  credentialVersionId: string | null
}

// An MCP connection row the policy engine gates: connection state + credential
// binding + tool availability the tool-call decision needs.
// Read-only DB boundary for the cross-cutting policy engine (server/policy.ts).
// Aggregates every governance read the engine needs so the engine itself stays
// drizzle-free: it composes these reads with the pure decision rules in
// domain/policy.ts. The only implementation lives in adapters/repos. `auth` is
// the same identity shape the engine receives (org/project/team claims).
export interface PolicyEvalRepo {
  // The applicable policy hierarchy rows (org for the org, all team rows, the
  // project row); applicablePolicyLevels filters them by team membership.
  policyLevels(auth: AuthScope): Promise<PolicyLevel[]>

  // The provider row matched by id (or the workers-ai type for the platform
  // default id); null when not configured.
  findProvider(projectId: string, providerId: string): Promise<PolicyProvider | null>
  // Whether the provider's pinned/active vault credential version is usable
  // (credential + version present and not revoked).
  providerCredentialUsable(auth: AuthScope, provider: PolicyProvider): Promise<boolean>

  // The project's successful usage records (budget windows filter by createdAt).
  successfulUsage(projectId: string): Promise<BudgetUsageRecord[]>
  // The project's enabled budgets.
  enabledBudgets(projectId: string): Promise<BudgetRule[]>
}

// --- usage records + summary (read-only reporting) ---

import type { UsageMeasurement, UsageProviderType, UsageStatus, UsageType } from '@server/domain/usage'

export interface UsageRecord {
  id: string
  projectId: string
  agentId: string | null
  agentVersionId: string | null
  sessionId: string | null
  sessionEventId: string | null
  correlationId: string | null
  providerId: string | null
  providerType: UsageProviderType
  modelId: string
  state: UsageStatus
  promptTokens: number
  completionTokens: number
  totalTokens: number
  durationMs: number
  costMicros: number
  currency: string
  usageType: UsageType
  metadata: Record<string, unknown>
  createdAt: string
}

export interface UsageListQuery {
  projectId: string
  providerId?: string
  modelId?: string
  agentId?: string
  sessionId?: string
  from?: string
  to?: string
  limit: number
  cursor: { createdAt: string; id: string } | null
}

export interface UsageSummaryQuery {
  projectId: string
  from?: string
  to?: string
}

// DB boundary for usage records. Read-only: rows are written by the runtime
// metering path, this port only lists/reads/aggregates. The only implementation
// lives in adapters/repos. `list` returns the full filtered, ordered set (the
// route paginates or serializes to CSV); `summaryRows` returns the bare
// measurement projection the domain summarizer folds over.
export interface UsageRepo {
  list(query: UsageListQuery): Promise<UsageRecord[]>
  find(projectId: string, recordId: string): Promise<UsageRecord | null>
  summaryRows(query: UsageSummaryQuery): Promise<UsageMeasurement[]>
}

// --- audit records (read side) ---

export interface AuditRecord {
  id: string
  projectId: string | null
  actorUserId: string | null
  actorType: 'user' | 'system'
  action: string
  resourceType: string
  resourceId: string | null
  outcome: 'success' | 'failure' | 'denied'
  requestId: string | null
  correlationId: string | null
  sessionId: string | null
  policyCategory: string | null
  metadata: Record<string, unknown>
  before: Record<string, unknown>
  after: Record<string, unknown>
  createdAt: string
}

export interface AuditListQuery {
  organizationId: string
  actorId?: string
  projectId?: string
  action?: string
  resourceType?: string
  resourceId?: string
  outcome?: string
  from?: string
  to?: string
  limit: number
  cursor: { createdAt: string; id: string } | null
}

// DB boundary for reading audit records. Distinct from AuditPort (the write
// boundary other resources use to record governance mutations): this is the
// audit *resource* reading its own log.
export interface AuditReadRepo {
  list(query: AuditListQuery): Promise<AuditRecord[]>
  find(organizationId: string, recordId: string): Promise<AuditRecord | null>
}

// --- triggers ---

import type { RuntimeName } from '@server/contracts/environment-contracts'

// Field-keyed validation error for trigger orchestration (secret-material
// rejection). The http layer maps it to a 400.
export class TriggerValidationError extends Error {
  readonly fields: Record<string, string>
  constructor(message: string, fields: Record<string, string>) {
    super(message)
    this.name = 'TriggerValidationError'
    this.fields = fields
  }
}

// Thrown when an archived trigger receives field updates, or when the
// referenced agent/environment is archived/unavailable. `status` selects the
// http mapping (404 missing, 409 conflict).
export class TriggerConflictError extends Error {
  readonly status: 404 | 409
  constructor(message: string, status: 404 | 409 = 409) {
    super(message)
    this.name = 'TriggerConflictError'
    this.status = status
  }
}

export interface TriggerConfig {
  name: string
  source: TriggerSource
  suspend: boolean
  template: TriggerSessionTemplate
  nextDueAt: string | null
}

export interface TriggerListQuery {
  projectId: string
  archived: boolean
  enabled?: boolean
  search?: string
  createdFrom?: string
  createdTo?: string
  limit: number
  cursor: { createdAt: string; id: string } | null
}

export interface TriggerRunListQuery {
  projectId: string
  triggerId: string
  state?: 'claimed' | 'dispatched' | 'failed'
  search?: string
  createdFrom?: string
  createdTo?: string
  limit: number
  cursor: { createdAt: string; id: string } | null
}

export interface CreateTriggerInput {
  organizationId: string
  projectId: string
  config: TriggerConfig
  createdByUserId: string | null
}

export interface UpdateTriggerFields {
  config: TriggerConfig
  archivedAt: string | null
}

// DB boundary for triggers and their run sub-resource. The only implementation
// lives in adapters/repos. Repos return parsed records — no JSON strings.
export interface TriggerRepo {
  list(query: TriggerListQuery): Promise<ListPageResult<Trigger>>
  find(projectId: string, triggerId: string): Promise<Trigger | null>
  insert(input: CreateTriggerInput, timestamp: string): Promise<Trigger>
  update(projectId: string, triggerId: string, fields: UpdateTriggerFields, updatedAt: string): Promise<Trigger>
  // Hard-deletes the trigger and its runs (the only FK to triggers.id). Returns
  // whether the trigger row existed so the caller can map a missing row to 404.
  delete(projectId: string, triggerId: string): Promise<boolean>

  listRuns(query: TriggerRunListQuery): Promise<ListPageResult<TriggerRun>>
  findRun(projectId: string, triggerId: string, runId: string): Promise<TriggerRun | null>

  // Reference validation against sibling resources, returning a stable status
  // when the agent/environment is missing (404) or unusable (409).
  agentUsable(projectId: string, agentId: string): Promise<{ status: 404 | 409; message: string } | null>
  environmentUsable(projectId: string, environmentId: string): Promise<{ status: 404 | 409; message: string } | null>
}

// --- trigger dispatch (background cron/queue) ---

// The dispatch-relevant projection of a due trigger. Carries only the fields the
// dispatch orchestration reads — the parsed execution spec plus the scheduling
// columns needed to advance the next due time. runtime is validated at the repo
// boundary so the usecase never re-parses raw column strings.
export interface DueTrigger {
  id: string
  organizationId: string
  projectId: string
  name: string
  template: TriggerSessionTemplate
  nextDueAt: string
  intervalSeconds: number
}

// A claimed dispatch run: the idempotency-keyed triggerRuns row the dispatch
// flow advances. Null at claim time means the run was already claimed (the
// UNIQUE idempotency guard lost the race) and is skipped.
export interface ClaimedRun {
  id: string
  scheduledFor: string
  correlationId: string
}

// DB boundary for the background trigger dispatcher (cron/queue entry). The
// drizzle reads (due triggers), the idempotent run claim (UNIQUE-guarded
// insert), and the run/trigger state advances all live in adapters/repos; the
// dispatch-triggers usecase owns the orchestration (claim → session → audit).
export interface TriggerDispatchRepo {
  dueTriggers(options: { heartbeatAt: string; projectId?: string; limit: number }): Promise<DueTrigger[]>
  // Returns null when the idempotency key collides (run already claimed).
  claimRun(trigger: DueTrigger, heartbeatAt: string): Promise<ClaimedRun | null>
  claimHttpRun(
    auth: AuthScope,
    trigger: Trigger,
    triggeredAt: string,
    idempotencyKey: string | null,
  ): Promise<ClaimedRun | null>
  projectName(projectId: string): Promise<string | null>
  markRunFailed(trigger: DueTrigger | Trigger, run: ClaimedRun, message: string): Promise<void>
  markRunDispatched(
    trigger: DueTrigger | Trigger,
    run: ClaimedRun,
    sessionId: string,
    sessionMetadata: Record<string, unknown>,
  ): Promise<void>
}

// --- projects ---

export interface ProjectRecord {
  id: string
  name: string
  createdAt: string
  updatedAt: string
}

export interface ProjectListQuery {
  organizationId: string
  limit: number
  cursor: { createdAt: string; id: string } | null
}

// DB boundary for projects. organizationId stays in the DB for tenancy but is
// never exposed on ProjectRecord. The only implementation lives in
// adapters/repos.
export interface ProjectRepo {
  list(query: ProjectListQuery): Promise<ListPageResult<ProjectRecord>>
  find(organizationId: string, projectId: string): Promise<ProjectRecord | null>
  insert(organizationId: string, name: string, timestamp: string): Promise<ProjectRecord>
}

// --- federated tenants ---

// Thrown when a federated tenant already exists for the (issuer, externalTenant)
// pair. The http layer maps it to 409.
export class FederatedTenantConflictError extends Error {
  constructor(message = 'Federated tenant already exists for this issuer and external tenant') {
    super(message)
    this.name = 'FederatedTenantConflictError'
  }
}

export interface FederatedTenantRecord {
  id: string
  issuer: string
  externalTenantId: string
  projectId: string
  environmentId: string | null
  capabilities: string[]
  enabled: boolean
  metadata: Record<string, unknown>
  createdAt: string
  updatedAt: string
}

export interface FederatedTenantListQuery {
  projectId: string
  limit: number
  cursor: { createdAt: string; id: string } | null
}

export interface CreateFederatedTenantInput {
  issuer: string
  externalTenantId: string
  projectId: string
  environmentId: string | null
  capabilities: string[]
  metadata: Record<string, unknown>
}

export interface UpdateFederatedTenantFields {
  enabled: boolean
  capabilities: string[]
  environmentId: string | null
  metadata: Record<string, unknown>
}

// DB boundary for federated tenants. The only implementation lives in
// adapters/repos.
export interface FederatedTenantRepo {
  list(query: FederatedTenantListQuery): Promise<ListPageResult<FederatedTenantRecord>>
  find(projectId: string, tenantId: string): Promise<FederatedTenantRecord | null>
  findByIssuerTenant(issuer: string, externalTenantId: string): Promise<{ id: string } | null>
  insert(input: CreateFederatedTenantInput, timestamp: string): Promise<FederatedTenantRecord>
  update(
    projectId: string,
    tenantId: string,
    fields: UpdateFederatedTenantFields,
    updatedAt: string,
  ): Promise<FederatedTenantRecord>
  delete(projectId: string, tenantId: string): Promise<void>
}

// --- runners, work items, leases (self-hosted runner queue) ---

// Field-keyed validation error for runner registration orchestration (secret
// material, OIDC binding, credential/environment references). The http layer
// maps it to a 400.
export class RunnerValidationError extends Error {
  readonly fields: Record<string, string> | undefined
  constructor(message: string, fields?: Record<string, string>) {
    super(message)
    this.name = 'RunnerValidationError'
    this.fields = fields
  }
}

// Thrown when a runner/lease operation conflicts with current state (runner not
// active, at capacity, work item unavailable, lease no longer active, secret
// resolution failure). `status` selects the http mapping: a missing referenced
// resource is 404, everything else is 409.
export class RunnerConflictError extends Error {
  readonly status: 404 | 409
  constructor(message: string, status: 404 | 409 = 409) {
    super(message)
    this.name = 'RunnerConflictError'
    this.status = status
  }
}

export interface RuntimeUsageWindow {
  label: string
  utilization: number
  resetsAt: string
}

export interface RuntimeUsage {
  runtime: string
  windows: RuntimeUsageWindow[]
}

export interface RuntimeInventoryEntry {
  runtime: string
  version?: string
  state: string
  detail?: string
}

export interface RunnerRecord {
  id: string
  projectId: string
  name: string
  capabilities: string[]
  environmentId: string | null
  secretRef: string | null
  authMode: RunnerAuthMode
  state: string
  currentLoad: number
  maxConcurrent: number
  runtimeUsage: RuntimeUsage[]
  runtimeInventory: RuntimeInventoryEntry[]
  metadata: Record<string, unknown>
  lastHeartbeatAt: string | null
  archivedAt: string | null
  createdAt: string
  updatedAt: string
}

// The full row including tenancy + OIDC binding columns the http layer needs
// for runner-token authorization. Kept distinct from the wire-facing
// RunnerRecord so authz claims never leak into a serialized response.
export interface RunnerAuthRecord extends RunnerRecord {
  organizationId: string
  oidcSubject: string | null
  oidcClientId: string | null
}

export interface RunnerListQuery {
  projectId: string
  archived: boolean
  state?: string
  environmentId?: string
  search?: string
  createdFrom?: string
  createdTo?: string
  // Runner-token scoping: a runner token only sees its own runner(s).
  runnerId?: string
  oidcSubject?: string
  oidcClientId?: string
  limit: number
  cursor: { createdAt: string; id: string } | null
}

export interface CreateRunnerInput {
  organizationId: string
  projectId: string
  name: string
  capabilities: string[]
  environmentId: string | null
  secretRef: string | null
  authMode: RunnerAuthMode
  oidcSubject: string | null
  oidcClientId: string | null
  maxConcurrent: number
  metadata: Record<string, unknown>
}

export interface UpdateRunnerFields {
  name: string
  capabilities: string[]
  state: string
  maxConcurrent: number
  metadata: Record<string, unknown>
  archivedAt: string | null
}

export interface RunnerHeartbeatFields {
  state: string
  capabilities: string[]
  runtimeUsage: RuntimeUsage[]
  runtimeInventory: RuntimeInventoryEntry[]
  metadata: Record<string, unknown>
}

// DB boundary for self-hosted runners. The only implementation lives in
// adapters/repos. Repos return parsed records; the auth-bearing find returns the
// row's OIDC binding columns so the http layer can authorize runner tokens.
export interface RunnerRepo {
  list(query: RunnerListQuery): Promise<ListPageResult<RunnerAuthRecord>>
  find(projectId: string, runnerId: string): Promise<RunnerAuthRecord | null>
  // Looks up a reusable federated/oidc runner row by machine id for
  // re-registration; null when no machine binding applies.
  findForMachineRegistration(
    projectId: string,
    authMode: string,
    oidcSubject: string,
    environmentId: string | null,
    machineId: string | null,
  ): Promise<RunnerAuthRecord | null>
  insert(input: CreateRunnerInput, timestamp: string): Promise<RunnerAuthRecord>
  // Federated re-registration: rewrites the existing row and returns it.
  reregister(
    projectId: string,
    runnerId: string,
    input: CreateRunnerInput,
    timestamp: string,
  ): Promise<RunnerAuthRecord>
  update(projectId: string, runnerId: string, fields: UpdateRunnerFields, timestamp: string): Promise<RunnerAuthRecord>
  heartbeat(
    projectId: string,
    runnerId: string,
    fields: RunnerHeartbeatFields,
    timestamp: string,
  ): Promise<RunnerAuthRecord>

  // Reference validation against sibling resources.
  environmentUsable(projectId: string, environmentId: string): Promise<boolean>
  secretRefUsable(
    organizationId: string,
    projectId: string,
    secretRef: string,
  ): Promise<{ credentialMissing: boolean; versionMissing: boolean }>
}

export interface WorkItemRecord {
  id: string
  organizationId: string
  projectId: string
  sessionId: string | null
  environmentId: string | null
  runnerId: string | null
  leaseId: string | null
  type: string
  state: string
  priority: number
  attempts: number
  maxAttempts: number
  // Redacted payload (token-like values stripped). The raw payload is only
  // materialized for the lease-holding runner via `materializePayload`.
  payload: Record<string, unknown>
  result: Record<string, unknown> | null
  error: Record<string, unknown> | null
  availableAt: string
  createdAt: string
  updatedAt: string
}

export interface WorkItemListQuery {
  projectId: string
  state?: string
  sessionId?: string
  runnerId?: string
  search?: string
  createdFrom?: string
  createdTo?: string
  limit: number
  cursor: { createdAt: string; id: string } | null
}

// DB boundary for the self-hosted work-item queue (read-only view). The only
// implementation lives in adapters/repos. `rawPayload` returns the payload the
// lease-holding runner needs (the materialize usecase resolves runtime inputs).
// `activeLeaseRunnerId` returns the
// runner currently holding a still-active lease on the work item, or null.
export interface WorkItemRepo {
  list(query: WorkItemListQuery): Promise<ListPageResult<WorkItemRecord>>
  find(projectId: string, workItemId: string): Promise<WorkItemRecord | null>
  rawPayload(projectId: string, workItemId: string): Promise<Record<string, unknown> | null>
  activeLeaseRunnerId(projectId: string, workItemId: string): Promise<string | null>
}

// The claim-relevant projection of a work item: state machine fields plus the
// raw payload the eligibility gate reads.
export interface WorkItemClaimCandidate {
  state: string
  availableAt: string
  environmentId: string | null
  sessionId: string | null
  rawPayload: Record<string, unknown>
}

export interface LeaseRecord {
  id: string
  workItemId: string
  runnerId: string
  state: string
  expiresAt: string
  renewedAt: string | null
  resumeToken: string | null
  createdAt: string
  updatedAt: string
}

export interface LeaseListQuery {
  projectId: string
  runnerId?: string
  state?: string
  limit: number
  cursor: { createdAt: string; id: string } | null
}

export interface ClaimLeaseInput {
  organizationId: string
  projectId: string
  workItemId: string
  runnerId: string
  leaseDurationSeconds: number
}

export interface FinishLeaseInput {
  organizationId: string
  projectId: string
  leaseId: string
  // 'active' renews; 'interrupted' requeues for recovery; the rest are terminal.
  state: 'active' | 'completed' | 'failed' | 'cancelled' | 'interrupted'
  expiresAt?: string
  leaseDurationSeconds?: number
  resumeToken?: string
  result?: Record<string, unknown>
  error?: Record<string, unknown>
}

// DB boundary for runner work leases. The atomic work-item state transitions,
// runner load accounting, session-state-machine updates, and recovery requeue
// all live in the repo (they are pure cross-table SQL orchestration). The
// usecase owns the eligibility gate and claim-time secret resolution.
// Claim/finish return null when an optimistic guard lost the race so the
// usecase can map it to a 409.
export interface LeaseRepo {
  list(query: LeaseListQuery): Promise<ListPageResult<LeaseRecord>>
  find(projectId: string, leaseId: string): Promise<LeaseRecord | null>
  // The claim-relevant projection of a work item (state machine + raw payload).
  claimCandidate(projectId: string, workItemId: string): Promise<WorkItemClaimCandidate | null>
  // Expires leases whose deadline has passed and recovers their work items.
  // Called opportunistically before queue reads/writes.
  expireStale(projectId: string): Promise<void>
  // Atomically reserves a runner slot and flips the work item to leased.
  // Returns the created lease + claimed work item's session id, or a marker for
  // each lost-race outcome: 'at_capacity' (the runner slot reservation lost) or
  // 'work_item_lost' (another runner claimed the work item, slot released).
  claim(
    input: ClaimLeaseInput,
    timestamp: string,
  ): Promise<{ lease: LeaseRecord; sessionId: string | null } | 'at_capacity' | 'work_item_lost'>
  // Fails an already-claimed lease + work item (claim-time secret failure).
  failClaim(input: {
    projectId: string
    leaseId: string
    workItemId: string
    runnerId: string
    sessionId: string | null
    reason: string
  }): Promise<void>
  // Renews / completes / fails / cancels / interrupts a lease, transitioning the
  // work item and session. Returns the updated lease or null on a lost guard.
  finish(input: FinishLeaseInput, timestamp: string): Promise<LeaseRecord | null>

  // Channel acceptance: validates the lease still owns a self-hosted session
  // waiting for a runner channel, supersedes any active channel, creates the new
  // channel row, flips the session to running, and records the accepted event.
  // Returns the channel descriptor on success or a conflict marker the http
  // layer maps to a status. Runner authorization happens in the http layer
  // before this is called.
  prepareSessionChannel(
    scope: { organizationId: string; projectId: string },
    leaseId: string,
    timestamp: string,
  ): Promise<LeaseChannelPrepared | LeaseChannelConflict>
  // Rolls the channel + session back when the DO upgrade fails after preparation.
  rollbackSessionChannel(projectId: string, channelId: string, sessionId: string, timestamp: string): Promise<void>
}

export interface LeaseChannelPrepared {
  ok: true
  channelId: string
  sessionId: string
  workItemId: string
  runnerId: string
}

export interface LeaseChannelConflict {
  ok: false
  status: 404 | 409
  message: string
}

// Runtime secret boundary: resolves secret refs into runtime-only projections.
// Plain values are never persisted, logged, audited, or surfaced in events.
export interface RuntimeSecretGateway {
  resolveEnv(
    scope: { organizationId: string; projectId: string },
    items: EnvFromEntry[],
  ): Promise<Record<string, string>>
  resolveWorkspaceManifest(
    scope: { organizationId: string; projectId: string },
    volumes: Volume[],
    volumeMounts: VolumeMount[],
  ): Promise<WorkspaceManifest>
}

// --- cloud turn queue (usecase ↔ queue worker contract) ---

// Cloud session work runs from a queue consumer instead of HTTP waitUntil:
// a turn that shells out (installs, builds, sleeps) or a sandbox cold boot
// outlives the request lifetime cap and was silently killed mid-flight,
// stranding the session. The consumer invocation owns the wall-clock budget.
export type CloudTurnQueueTurnMessage = {
  type: 'session.turn'
  sessionId: string
  organizationId: string
  projectId: string
  prompt: string
  auditAction: 'session.prompt' | 'session.command'
}

// Continuation of a paused turn: the transcript is rebuilt from persisted
// events and the loop continues from the trailing tool results. Chaining
// steps lifts the per-invocation wall-clock cap from total turn duration.
// Carries the turnId so the step renews the SAME lease the paused turn holds —
// the continuation chain is one logical turn, so a concurrent prompt that
// arrives mid-chain loses the lease and is deferred until the chain ends.
export type CloudTurnQueueStepMessage = {
  type: 'session.step'
  sessionId: string
  organizationId: string
  projectId: string
  // Present for a budget continuation (renew the held lease); absent for an
  // approval-resume step, which acquires a fresh lease in the consumer.
  turnId?: string
  auditAction: 'session.prompt' | 'session.command'
}

export type CloudTurnQueueStartMessage = {
  type: 'session.start'
  sessionId: string
  organizationId: string
  projectId: string
  runtime: string
  runtimeConfig: Record<string, unknown>
  env: Record<string, string>
  envFrom: EnvFromEntry[]
  volumes: Volume[]
  volumeMounts: VolumeMount[]
  prompt?: string
}

export type CloudTurnQueueMessage = CloudTurnQueueTurnMessage | CloudTurnQueueStepMessage | CloudTurnQueueStartMessage

// Cloud-turn queue boundary. The runtime enqueues start/step/turn work onto the
// CLOUD_TURNS queue (the consumer owns the wall-clock budget). `runsInline`
// reports the test/no-binding mode where turns run synchronously inline so
// existing assertions keep working. The only implementation lives in adapters.
export interface CloudTurnQueue {
  enqueue(message: CloudTurnQueueMessage, opts?: { delaySeconds?: number }): Promise<void>
  runsInline(): boolean
}

// --- runner session channel (self-hosted runner DO) ---

// Self-hosted runner session channels live in a per-session Durable Object.
// This gateway talks to that DO over its internal fetch protocol and never
// touches control-plane tables. The only implementation lives in adapters.
export interface RunnerChannel {
  assignWork(input: {
    organizationId: string
    projectId: string
    environmentId: string
    workItemId: string
  }): Promise<boolean>
  // Whether the session's runner channel DO has an accepted (active) runner.
  isAccepted(sessionId: string): Promise<boolean>
  // Dispatches a command to the runner over the channel; true when accepted.
  dispatch(sessionId: string, command: Record<string, unknown>): Promise<boolean>
  // Executes one sandbox tool against the runner-owned workspace for AMA cloud-loop sessions.
  executeSandboxTool(input: ToolExecutionInput): Promise<ToolExecutionResult>
  // Stops a runner-owned sandbox workspace for AMA cloud-loop sessions.
  stopSandbox(sessionId: string): Promise<void>
  // Reads writable memory-store files from a runner-owned sandbox workspace.
  readMemoryStoreMemories(input: {
    sessionId: string
    volumes: MemoryVolume[]
    volumeMounts: VolumeMount[]
  }): Promise<Array<{ memoryRef: string; memories: Array<{ path: string; content: string }> }>>
}

// --- sandbox runtime host (cloud session execution) ---

// ports.ts may name the AMA cloud-loop execution contract. The engine lives
// under usecases/runtime because it is server-owned business execution, while
// stable tool/event shapes come from packages/runtime-contracts.
import type { AgentMessage } from '@earendil-works/pi-agent-core'
import type {
  RuntimeToolPolicyDecision,
  RuntimeToolPolicyInput,
  ToolExecutionInput,
  ToolExecutionResult,
} from './runtime/engine/ports'

export type { RuntimeToolPolicyDecision, RuntimeToolPolicyInput, ToolExecutionInput, ToolExecutionResult }

// Start input for the cloud sandbox runtime host. Plain data — no drizzle rows.
export interface SandboxRuntimeStartInput {
  sessionId: string
  sandboxId: string
  runtime?: string
  provider: string
  model: string | null
  agentSnapshot: Record<string, unknown>
  environmentSnapshot: Record<string, unknown> | null
  mcpServers?: Record<string, unknown>
  volumes?: Volume[]
  volumeMounts?: VolumeMount[]
  workspaceManifest?: WorkspaceManifest
  // Already materialized execution environment: direct env merged with resolved
  // secret refs before crossing into the runtime host.
  env?: Record<string, string>
}

export interface SandboxRuntimeStartResult {
  sandboxId: string
  metadata: Record<string, unknown>
}

export interface SandboxRuntimeToolCall {
  id?: string
  name?: string
  input?: Record<string, unknown>
  output?: Record<string, unknown>
  error?: Record<string, unknown>
  durationMs?: number
}

export interface SandboxRuntimeCommandBody {
  type?: string
  message?: string
  response?: string
  simulateError?: boolean
  errorMessage?: string
  toolCalls?: SandboxRuntimeToolCall[]
}

export interface SandboxRuntimeTurnResult {
  // 'paused': the run still wants more model turns but yielded its execution
  // budget; the caller re-enters with `continuation` to pick up the transcript.
  status: 'idle' | 'aborted' | 'paused'
}

// One model turn's outcome. 'paused' means the run wants more turns but yielded
// its execution budget; the caller re-enters with `continuation` to resume from
// the persisted transcript (whose last message is a tool result).
export type SessionTurnResult = {
  status: 'idle' | 'aborted' | 'paused'
}

// One model turn's input: the resolved provider/model, the agent snapshot, the
// prompt or continuation, and the callback bundle the turn driver supplies
// (liveness, event sink, tool-result resolver, tool-call approval, pause check).
export type SessionTurnInput = {
  sessionId: string
  sandboxId: string
  provider: string
  model: string | null
  agentSnapshot: Record<string, unknown>
  // Required unless `continuation` is set: a continuation resumes from the
  // persisted transcript whose last message is a tool result.
  prompt?: string
  continuation?: boolean
  messages?: AgentMessage[]
  // Checked before each model call after the first; returning true pauses the run.
  shouldPause?: () => boolean
  ensureActive?: () => Promise<void>
  onEvent: (event: AmaEvent) => Promise<void>
  approveToolCall?: (input: RuntimeToolPolicyInput) => Promise<RuntimeToolPolicyDecision>
  // Supplies a caller-provided tool result (e.g. an approved custom tool
  // outcome) instead of executing the tool in the sandbox.
  resolveToolResult?: (input: RuntimeToolPolicyInput) => Promise<Record<string, unknown> | null>
}

// Starts and tears down cloud-owned AMA session sandboxes. Runner-owned
// sandboxes are closed through RunnerChannel because their lifecycle is owned
// by the self-hosted runner channel.
export interface CloudRuntimeLifecycle {
  startCloudSession(input: SandboxRuntimeStartInput): Promise<SandboxRuntimeStartResult>
  stopCloudSession(sandboxId: string): Promise<void>
}

// Reads writable runtime workspace resources before a session is closed.
export interface RuntimeWorkspaceReader {
  readMemoryStoreMemories(input: {
    sessionId: string
    sandboxId: string
    volumes: MemoryVolume[]
    volumeMounts: VolumeMount[]
  }): Promise<Array<{ memoryRef: string; memories: Array<{ path: string; content: string }> }>>
}

// Executes tools inside the session sandbox. The sandbox may be cloud-owned or
// runner-owned; the adapter resolves the concrete backend per session.
export interface SessionSandboxExecutor {
  executeToolCalls(input: { sessionId: string; sandboxId: string; body: unknown }): Promise<unknown[]>
  // Executes a single sandbox tool — the approval-decision continuation runs the
  // approved tool here instead of through the model-turn loop.
  executeTool(input: ToolExecutionInput): Promise<ToolExecutionResult>
}

// Runs one AMA cloud-loop model turn. This is server-owned runtime behavior:
// runner AMA mode only supplies the sandbox where tools execute.
export interface AmaTurnExecutor {
  runTurn(input: SessionTurnInput): Promise<SessionTurnResult>
}

// --- runtime orchestration store (runtime-internal persistence boundary) ---

import type {
  AgentRow,
  AgentVersionRow,
  EnvironmentRow,
  EnvironmentVersionRow,
  SessionApprovalInsert,
  SessionInsert,
  SessionRow,
  SessionUpdate,
  WorkItemInsert,
  WorkItemRow,
} from '@shared/runtime-rows'

export type {
  AgentRow,
  AgentVersionRow,
  EnvironmentRow,
  EnvironmentVersionRow,
  SessionRow,
  SessionUpdate,
  WorkItemInsert,
} from '@shared/runtime-rows'

// Runtime-internal persistence boundary. The env-bound session execution engine
// (server/runtime/*) routes every drizzle read/write through this store so the
// runtime layer itself stays drizzle-free. It is intentionally runtime-shaped
// (raw session rows, work-item/lease/channel mechanics, snapshot reads) —
// distinct from the REST-facing SessionRepo, which serializes DTOs. The only
// implementation lives in adapters/repos/runtime-orchestration. The raw `db`
// handle is intentionally NOT on this interface: persistence stays behind the
// port surface.
export interface SessionOrchestrationStore {
  // ── session reads ──
  findSession(projectId: string, sessionId: string): Promise<SessionRow | null>
  sessionState(projectId: string, sessionId: string): Promise<{ state: string } | null>
  sessionMetadata(projectId: string, sessionId: string): Promise<{ metadata: string | null } | null>

  // ── session writes ──
  insertSession(row: SessionInsert): Promise<void>
  updateSession(projectId: string, sessionId: string, fields: SessionUpdate): Promise<void>
  updateSessionWhenState(
    projectId: string,
    sessionId: string,
    expected: string | string[],
    fields: SessionUpdate,
  ): Promise<boolean>
  queueSessionWorkWhenState(
    projectId: string,
    sessionId: string,
    expected: string | string[],
    fields: SessionUpdate,
    workItem: WorkItemInsert,
  ): Promise<boolean>

  // ── per-session turn lease ──
  acquireTurnLease(
    projectId: string,
    sessionId: string,
    turnId: string,
    leaseExpiresAt: string,
    now: string,
  ): Promise<boolean>
  renewTurnLease(projectId: string, sessionId: string, turnId: string, leaseExpiresAt: string): Promise<boolean>
  releaseTurnLease(projectId: string, sessionId: string, turnId: string, fields: SessionUpdate): Promise<boolean>
  incrementContinuationDepth(projectId: string, sessionId: string, turnId: string): Promise<number>

  // ── snapshot reads ──
  findAgent(projectId: string, agentId: string): Promise<AgentRow | null>
  findAgentVersion(agentId: string, versionId: string): Promise<AgentVersionRow | null>
  findActiveMemoryStoreResource(
    projectId: string,
    storeId: string,
    access: MemoryStoreAccess,
  ): Promise<ResolvedMemoryStoreResource | null>
  replaceMemoryStoreMemories(
    projectId: string,
    storeId: string,
    memories: Array<{ path: string; content: string }>,
    updatedAt: string,
  ): Promise<void>
  findEnvironment(projectId: string, environmentId: string): Promise<EnvironmentRow | null>
  findEnvironmentVersion(projectId: string, versionId: string): Promise<EnvironmentVersionRow | null>

  // ── runtime/runner capability validation ──
  activeRunnerCapabilities(projectId: string, environmentId: string): Promise<string[]>
  // Resolves an environment whose active runner can serve the runtime (and,
  // when possible, the provider/model), for sessions created without a pinned
  // environment. Returns null when none exists — e.g. a cloud runtime with no
  // runner — so the caller can require an explicit environmentId. Prefers a
  // model-declaring runner, then one with spare capacity.
  resolveEnvironmentForRuntime(
    projectId: string,
    runtime: RuntimeName,
    providerId: string,
    model: string | null,
  ): Promise<string | null>

  // ── MCP manifest resolution ──
  mcpCatalogEntries(connectorIds: string[]): Promise<ConnectorRecord[]>

  // ── credential validation ──
  activeCredentialVersionExists(organizationId: string, projectId: string, versionId: string): Promise<boolean>
  activeCredentialExists(organizationId: string, projectId: string, credentialId: string): Promise<boolean>
  secretVersionForResolution(
    organizationId: string,
    projectId: string,
    secretRef: string,
  ): Promise<{ state: string; metadata: string; secretRef: string } | null>
  vaultVersionsForResolution(
    organizationId: string,
    projectId: string,
    secretRef: string,
  ): Promise<{ name: string; state: string; metadata: string; secretRef: string }[] | null>

  // ── work-item enqueue + resume ──
  insertWorkItem(row: WorkItemInsert): Promise<void>
  recentSessionWorkItems(
    projectId: string,
    sessionId: string,
    limit: number,
  ): Promise<{ state: string; payload: string; result: string | null }[]>

  // ── self-hosted close: active work items + lease/runner accounting ──
  activeSessionWorkItems(
    projectId: string,
    sessionId: string,
  ): Promise<{ id: string; runnerId: string | null; leaseId: string | null }[]>
  cancelWorkItems(projectId: string, workItemIds: string[], errorJson: string, timestamp: string): Promise<void>
  cancelLeases(projectId: string, leaseIds: string[], timestamp: string): Promise<void>
  decrementRunnerLoad(projectId: string, runnerId: string, timestamp: string): Promise<void>

  // ── turn execution reads ──
  sessionEventStream(sessionId: string): Promise<{ type: string; payload: string }[]>

  // ── pending session sweep ──
  markExpiredPendingSessions(projectId: string, expiredBefore: string, timestamp: string): Promise<void>

  // ── approval decision ──
  findApproval(projectId: string, sessionId: string, approvalId: string): Promise<unknown>
  upsertApproval(row: SessionApprovalInsert, decidedAt: string): Promise<void>

  // ── watchdog: stalled cloud sessions + leaked sandboxes ──
  markStalledCloudSessions(threshold: string, timestamp: string): Promise<void>
  leakedSandboxSessions(
    terminalStates: string[],
    limit: number,
  ): Promise<{ id: string; sandboxId: string | null; metadata: string | null }[]>
  stampSandboxDestroyed(sessionId: string, metadataJson: string): Promise<void>

  // ── runner session channel (durable object) ──
  channelSession(
    projectId: string,
    sessionId: string,
  ): Promise<{ id: string; agentSnapshot: string | null; environmentSnapshot: string | null } | null>
  channelSessionState(
    projectId: string,
    sessionId: string,
  ): Promise<{ state: string; stateReason: string | null } | null>
  channelWorkItem(projectId: string, workItemId: string): Promise<WorkItemRow | null>
  channelActiveLease(state: {
    leaseId: string
    workItemId: string
    runnerId: string
    projectId: string
  }): Promise<{ expiresAt: string } | null>
  channelActiveChannel(state: {
    channelId: string
    sessionId: string
    workItemId: string
    leaseId: string
    runnerId: string
    projectId: string
  }): Promise<{ id: string } | null>
  touchChannel(channelId: string, timestamp: string): Promise<void>
  closeChannel(channelId: string, channelState: 'closed' | 'stale', reason: string, timestamp: string): Promise<void>
  requeueSessionForRunnerRecovery(projectId: string, sessionId: string, timestamp: string): Promise<void>
}

// --- sessions ---

export interface SessionListQuery {
  projectId: string
  archived: boolean
  state?: string
  search?: string
  labelSelector?: string
  createdFrom?: string
  createdTo?: string
  limit: number
  cursor: { createdAt: string; id: string } | null
}

export interface EventQuery {
  type?: string
  createdFrom?: string
  createdTo?: string
  order: 'asc' | 'desc'
  cursor?: number
  limit: number
}

export interface EventPage {
  rows: SessionEvent[]
  hasMore: boolean
}

// "Storage follows the loop": the canonical event store that routes cloud-loop
// (ama) sessions to the per-session Session DO (SQLite hot + R2 cold) and leaves
// pre-migration cloud + self-hosted CLI sessions on D1. One contract over both
// backends; the read shape (SessionEvent/Page) is identical either way.
export interface EventStore {
  appendEvent(scope: { organizationId: string; projectId: string; sessionId: string }, event: AmaEvent): Promise<string>
  // Batch ingest (the POST /events endpoint). Returns the count.
  insertEvents(
    scope: { organizationId: string; projectId: string; sessionId: string },
    events: AmaEvent[],
  ): Promise<number>
  queryEvents(sessionId: string, query: EventQuery): Promise<EventPage>
  eventStream(sessionId: string): Promise<{ type: string; payload: string }[]>
  archive(scope: { organizationId: string; projectId: string; sessionId: string }): Promise<void>
}

export interface SessionMessageListQuery {
  projectId: string
  sessionId: string
  limit: number
  cursor: { createdAt: string; id: string } | null
}

export interface SessionMessageListPage {
  rows: SessionMessage[]
  hasMore: boolean
}

export interface SessionListPage {
  rows: Session[]
  hasMore: boolean
}

// Minimal internal handle for runtime/write usecases. It is not the public
// Session resource; it carries only the ownership/state/runtime columns needed
// before mutating or dispatching work.
export interface RuntimeSessionHandle {
  id: string
  projectId: string | null
  organizationId: string | null
  state: SessionState
  archivedAt: string | null
  sandboxId: string | null
  metadata: Record<string, unknown>
}

// DB boundary for the sessions resource. The only place sessions,
// sessionEvents, sessionMessages, and sessionApprovals tables are read for the
// REST surface. Returns DTO records with internal columns stripped.
export interface SessionRepo {
  list(query: SessionListQuery): Promise<SessionListPage>
  find(projectId: string, sessionId: string): Promise<Session | null>
  findByOrganization(organizationId: string, sessionId: string): Promise<Session | null>
  findActiveHttpTriggerSession(
    projectId: string,
    triggerId: string,
    keyHash: string,
  ): Promise<RuntimeSessionHandle | null>
  // The raw row (with internal columns) for runtime operations. Used by write
  // paths that hand the session to the runtime gateway.
  findRuntimeRow(projectId: string, sessionId: string): Promise<RuntimeSessionHandle | null>
  resolveRunnerEnvironmentId(sessionId: string): Promise<string | null>
  // The sandbox executor backend for a cloud-loop session. Null means the
  // default Cloudflare Sandbox backend.
  resolveSandboxBackend(sessionId: string): Promise<string | null>

  updateFields(
    projectId: string,
    sessionId: string,
    fields: { title?: string; metadata?: Record<string, unknown> },
    updatedAt: string,
  ): Promise<Session | null>

  listMessages(query: SessionMessageListQuery): Promise<SessionMessageListPage>
  findMessage(projectId: string, sessionId: string, messageId: string): Promise<SessionMessage | null>
  insertMessage(record: {
    organizationId: string
    projectId: string
    sessionId: string
    content: string
    delivery: MessageDelivery
    state: MessageState
    createdAt: string
  }): Promise<SessionMessage>

  queryEvents(sessionId: string, query: EventQuery): Promise<EventPage>
  insertEvents(
    scope: { organizationId: string; projectId: string; sessionId: string },
    events: AmaEvent[],
  ): Promise<number>

  listApprovals(projectId: string, sessionId: string): Promise<SessionApproval[]>
  findApproval(projectId: string, sessionId: string, approvalId: string): Promise<SessionApproval | null>

  // Event-ingest runner gate: resolves the active, unexpired lease a runner
  // identity holds for this session (work item leased to the same runner), or
  // null. The returned metadata (runner/lease/work-item ids, runtime, provider,
  // model) is stamped onto ingested events. Returns null when the runner holds
  // no qualifying lease.
  activeSessionLeaseForRunner(
    projectId: string,
    sessionId: string,
    runner: { runnerId: string | null; subject: string },
  ): Promise<{
    runnerId: string
    leaseId: string
    workItemId: string
    runtime?: string
    provider?: string
    model?: string
  } | null>
}

// Field-keyed validation error for session orchestration. The http layer maps
// it to a 400 with the same shape governance/agents produce.
export class SessionValidationError extends Error {
  readonly fields: Record<string, string>
  constructor(message: string, fields: Record<string, string>) {
    super(message)
    this.name = 'SessionValidationError'
    this.fields = fields
  }
}

// Error crossing the runtime-usecase boundary. The http layer maps status →
// response and echoes detail/fields. Mirrors the runtime layer's outcome shape
// so the runtime session usecases forward it without re-mapping.
export interface SessionRuntimeError {
  status: 400 | 403 | 404 | 409 | 500
  code: string
  message: string
  fields?: Record<string, string>
  detail?: Record<string, unknown>
}

export type SessionRuntimeOutcome<T> = { ok: true; value: T } | { ok: false; error: SessionRuntimeError }

export type PromptDispatchResult =
  | { ok: false; status: 409 | 500; message: string; runtimeError?: Record<string, unknown> }
  | { ok: true; delivery: MessageDelivery; state: MessageState }

export interface SessionCreateOptions {
  name?: string
  metadata?: Record<string, unknown>
  volumes?: Volume[]
  volumeMounts?: VolumeMount[]
  runtime: RuntimeName
  runtimeConfig?: Record<string, unknown>
  env?: Record<string, string>
  envFrom?: EnvFromEntry[]
  prompt: string
}

export type { ConnectorCatalogTool, SecretMaterial }
