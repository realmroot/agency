import type { Agent, AgentSpec, RealmrootAgentIdentity } from '@server/domain/agent'
import { validateAgentUsername } from '@server/domain/agent'
import { credentialScopedSecretRef } from '@server/domain/vault'
import type { WorkspaceManifestMount } from '@server/domain/workspace'
import { validateAgentConfig, validateAgentCreation } from './agents'
import type { Deps } from './deps'
import type { AuthScope, RealmrootEnrollmentCheckpoint, RealmrootManagementCredential, VaultVisibility } from './ports'
import { createCredential } from './vaults'

export interface AgentCreationRequest {
  username: string
  name: string
  description: string | null
  spec: AgentSpec
}

export class AgentCreationConflict extends Error {}
export class AgentCreationUpstreamError extends Error {}
export class AgentCreationValidation extends Error {
  constructor(readonly fields: Record<string, string>) {
    super('Invalid Agent creation request')
  }
}

type StableIds = {
  agentId: string
  versionId: string
  vaultId: string
  initializationCredentialId: string
  initializationVersionId: string
  stateCredentialId: string
  stateVersionId: string
}

function hex(bytes: ArrayBuffer) {
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

async function digest(value: string) {
  return hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))
}

async function stableIds(projectId: string, idempotencyKey: string): Promise<StableIds> {
  const value = await digest(`${projectId}\0${idempotencyKey}`)
  return {
    agentId: `agent_${value.slice(0, 32)}`,
    versionId: `agentver_${value.slice(0, 32)}`,
    vaultId: `vault_${value.slice(0, 32)}`,
    initializationCredentialId: `vaultcred_${value.slice(0, 30)}i1`,
    initializationVersionId: `vaultver_${value.slice(0, 30)}i1`,
    stateCredentialId: `vaultcred_${value.slice(0, 30)}s1`,
    stateVersionId: `vaultver_${value.slice(0, 30)}s1`,
  }
}

async function requestFingerprint(request: AgentCreationRequest, auth: AuthScope) {
  return await digest(
    JSON.stringify({
      request,
      managementPrincipal: {
        subject: auth.user.id,
        clientId: auth.oidc?.clientId ?? null,
      },
    }),
  )
}

function sameRequest(agent: Agent, request: AgentCreationRequest) {
  return (
    agent.identity.username === request.username &&
    agent.metadata.name === request.name &&
    agent.metadata.description === request.description &&
    JSON.stringify(agent.spec) === JSON.stringify(request.spec)
  )
}

function realmrootOrigin(auth: AuthScope, checkpoint?: RealmrootEnrollmentCheckpoint) {
  const checkpointOrigin = checkpoint && typeof checkpoint.state.origin === 'string' ? checkpoint.state.origin : null
  if (checkpointOrigin) return new URL(checkpointOrigin).origin
  if (auth.oidc?.issuer) return new URL(auth.oidc.issuer).origin
  throw new AgentCreationUpstreamError('Realmroot origin is unavailable')
}

async function ensureVault(deps: Deps, auth: AuthScope, ids: StableIds, username: string) {
  const visibility = { organizationId: auth.organization.id, projectId: auth.project.id }
  const existing = await deps.vaults.find(ids.vaultId, visibility)
  if (existing) return existing
  try {
    return await deps.vaults.insert(
      {
        id: ids.vaultId,
        organizationId: auth.organization.id,
        projectId: auth.project.id,
        name: `Agent ${username}`,
        description: 'AMA-managed Realmroot Agent identity state.',
        scope: 'project',
      },
      new Date().toISOString(),
    )
  } catch (cause) {
    const concurrent = await deps.vaults.find(ids.vaultId, visibility)
    if (concurrent) return concurrent
    throw new AgentCreationUpstreamError('Could not persist the managed Agent Vault', { cause })
  }
}

async function ensureCredential(
  deps: Deps,
  vault: Awaited<ReturnType<typeof ensureVault>>,
  values: {
    credentialId: string
    versionId: string
    name: string
    type: 'opaque' | 'ama.dev/realmroot-agent-state'
    key: 'initialization.json' | 'state.json'
    state: Record<string, unknown>
    agentId: string
    fingerprint: string
  },
) {
  const metadata = {
    managedBy: 'agent-creation',
    agentId: values.agentId,
    requestFingerprint: values.fingerprint,
  }
  const matches = (credential: NonNullable<Awaited<ReturnType<typeof deps.vaults.findCredential>>>) =>
    credential.spec.type === values.type &&
    credential.metadata.name === values.name &&
    JSON.stringify(credential.spec.metadata) === JSON.stringify(metadata) &&
    Boolean(credential.status.activeVersionId)
  const existing = await deps.vaults.findCredential(vault.metadata.uid, values.credentialId)
  if (existing) {
    if (!matches(existing)) {
      throw new AgentCreationConflict('Idempotency-Key conflicts with existing managed Agent state')
    }
    const version = await deps.vaults.activeVersion(existing)
    if (!version) throw new AgentCreationUpstreamError('Managed Agent Vault credential has no active version')
    return { credential: existing, version }
  }
  try {
    return await createCredential(
      deps,
      vault,
      {
        name: values.name,
        type: values.type,
        metadata,
        secret: { stringData: { [values.key]: JSON.stringify(values.state) } },
      },
      { credentialId: values.credentialId, versionId: values.versionId },
    )
  } catch (cause) {
    const concurrent = await deps.vaults.findCredential(vault.metadata.uid, values.credentialId)
    if (concurrent && matches(concurrent)) {
      const version = await deps.vaults.activeVersion(concurrent)
      if (version) return { credential: concurrent, version }
    }
    if (concurrent) throw new AgentCreationConflict('Idempotency-Key conflicts with existing managed Agent state')
    throw new AgentCreationUpstreamError('Could not persist managed Agent identity state', { cause })
  }
}

async function readCheckpoint(
  deps: Deps,
  visibility: VaultVisibility,
  vaultId: string,
  credentialId: string,
  key: 'initialization.json' | 'state.json',
  stage: RealmrootEnrollmentCheckpoint['stage'],
) {
  const manifest = await deps.runtimeSecrets.resolveWorkspaceManifest(
    visibility,
    [
      {
        name: 'agent-creation-state',
        type: 'secret',
        secretRef: credentialScopedSecretRef({ vaultId, credentialId }),
        items: [{ key, path: 'checkpoint.json' }],
      },
    ],
    [{ name: 'agent-creation-state', mountPath: '/workspace/.ama/agent-creation-state', readOnly: true }],
  )
  const mount = manifest.mounts.find(
    (candidate): candidate is Extract<WorkspaceManifestMount, { type: 'secret' }> =>
      candidate.type === 'secret' && candidate.name === 'agent-creation-state',
  )
  const content = mount?.files.find((file) => file.path === 'checkpoint.json')?.content
  if (!content) throw new AgentCreationUpstreamError('Managed Agent identity state is unavailable')
  const state = JSON.parse(content) as Record<string, unknown>
  const identity = state.identity as RealmrootEnrollmentCheckpoint['identity'] | undefined
  return { stage, state, ...(identity ? { identity } : {}) }
}

export async function createManagedAgent(
  deps: Deps,
  auth: AuthScope,
  idempotencyKey: string,
  request: AgentCreationRequest,
  authorize: () => Promise<RealmrootManagementCredential>,
): Promise<Agent> {
  if (!idempotencyKey.trim() || idempotencyKey.length > 200) {
    throw new AgentCreationValidation({ idempotencyKey: 'Idempotency-Key must contain 1 to 200 characters.' })
  }
  const usernameError = validateAgentUsername(request.username)
  if (usernameError) throw new AgentCreationValidation(usernameError)
  await validateAgentConfig(deps, auth, request.spec)
  const ids = await stableIds(auth.project.id, idempotencyKey)
  const fingerprint = await requestFingerprint(request, auth)
  const existingAgent = await deps.agents.find(auth.project.id, ids.agentId)
  if (existingAgent) {
    if (!sameRequest(existingAgent, request)) {
      throw new AgentCreationConflict('Idempotency-Key was already used with a different request')
    }
    return existingAgent
  }
  const enrollmentGateway = deps.realmrootEnrollment
  if (!enrollmentGateway) {
    throw new AgentCreationUpstreamError('Realmroot Agent creation dependencies are unavailable')
  }
  let authority: RealmrootManagementCredential
  try {
    authority = await authorize()
  } catch (cause) {
    throw new AgentCreationUpstreamError(
      cause instanceof Error ? cause.message : 'Realmroot authority is unavailable',
      {
        cause,
      },
    )
  }
  const visibility = { organizationId: auth.organization.id, projectId: auth.project.id }
  const vault = await ensureVault(deps, auth, ids, request.username)
  let checkpoint: RealmrootEnrollmentCheckpoint
  const finalCredential = await deps.vaults.findCredential(ids.vaultId, ids.stateCredentialId)
  if (finalCredential) {
    if (finalCredential.spec.metadata.requestFingerprint !== fingerprint) {
      throw new AgentCreationConflict('Idempotency-Key was already used with a different request')
    }
    checkpoint = await readCheckpoint(deps, visibility, ids.vaultId, ids.stateCredentialId, 'state.json', 'enrolled')
  } else {
    const initializationCredential = await deps.vaults.findCredential(ids.vaultId, ids.initializationCredentialId)
    if (initializationCredential?.spec.metadata.requestFingerprint !== undefined) {
      if (initializationCredential.spec.metadata.requestFingerprint !== fingerprint) {
        throw new AgentCreationConflict('Idempotency-Key was already used with a different request')
      }
      checkpoint = await readCheckpoint(
        deps,
        visibility,
        ids.vaultId,
        ids.initializationCredentialId,
        'initialization.json',
        'initialized',
      )
    } else {
      checkpoint = await enrollmentGateway.initialize({
        origin: realmrootOrigin(auth),
        nickname: request.name,
        idempotencyKey: `ama:${auth.project.id}:${ids.agentId}`,
      })
      await ensureCredential(deps, vault, {
        credentialId: ids.initializationCredentialId,
        versionId: ids.initializationVersionId,
        name: `${request.username} Realmroot initialization`,
        type: 'opaque',
        key: 'initialization.json',
        state: checkpoint.state,
        agentId: ids.agentId,
        fingerprint,
      })
      checkpoint = await readCheckpoint(
        deps,
        visibility,
        ids.vaultId,
        ids.initializationCredentialId,
        'initialization.json',
        'initialized',
      )
    }
    try {
      checkpoint = await enrollmentGateway.prepare({
        origin: realmrootOrigin(auth, checkpoint),
        username: request.username,
        nickname: request.name,
        idempotencyKey: `ama:${auth.project.id}:${ids.agentId}`,
        managementCredential: authority,
        checkpoint,
        onCheckpoint: async (enrolled) => {
          await ensureCredential(deps, vault, {
            credentialId: ids.stateCredentialId,
            versionId: ids.stateVersionId,
            name: `${request.username} Realmroot state`,
            type: 'ama.dev/realmroot-agent-state',
            key: 'state.json',
            state: enrolled.state,
            agentId: ids.agentId,
            fingerprint,
          })
        },
      })
    } catch (cause) {
      if (cause instanceof AgentCreationConflict || cause instanceof AgentCreationUpstreamError) throw cause
      throw new AgentCreationUpstreamError(
        cause instanceof Error ? cause.message : 'Realmroot Agent identity creation failed',
        { cause },
      )
    }
  }
  const completed = await enrollmentGateway.complete({
    origin: realmrootOrigin(auth, checkpoint),
    username: request.username,
    nickname: request.name,
    idempotencyKey: `ama:${auth.project.id}:${ids.agentId}`,
    checkpoint,
    async onCheckpoint() {},
  })
  const identity: RealmrootAgentIdentity = {
    issuer: completed.identity.issuer,
    subject: completed.identity.subject,
    username: completed.identity.username,
    runtime: 'ama',
    credentialRef: credentialScopedSecretRef({ vaultId: ids.vaultId, credentialId: ids.stateCredentialId }),
  }
  await validateAgentCreation(deps, auth, { identity, spec: request.spec })
  try {
    return await deps.agents.createWithInitialVersion(
      {
        id: ids.agentId,
        projectId: auth.project.id,
        username: request.username,
        name: request.name,
        description: request.description,
        identity,
        spec: request.spec,
      },
      ids.versionId,
      new Date().toISOString(),
    )
  } catch (cause) {
    const concurrent = await deps.agents.find(auth.project.id, ids.agentId)
    if (concurrent && sameRequest(concurrent, request)) return concurrent
    if (concurrent) throw new AgentCreationConflict('Idempotency-Key was already used with a different request')
    throw cause
  }
}
