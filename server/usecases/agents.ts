import {
  type Agent,
  type AgentSpec,
  type AgentSubagentReference,
  validateAllowedTools,
  validateSkills,
  validateSubagents,
} from '@server/domain/agent'
import { runtimeNameForIdentity } from '@server/domain/runtime/driver'
import { creationDigest, creationFingerprint } from './creation-idempotency'
import type { Deps } from './deps'
import {
  AgentValidationError,
  type AuthScope,
  CreationIdempotencyConflictError,
  IdentityAlreadyBoundError,
} from './ports'

// Validates the agent spec against sibling resources and secret-material rules.
// Throws AgentValidationError on the first failure.
async function validateConfig(deps: Deps, auth: AuthScope, config: AgentSpec, parentAgentId?: string) {
  if (!config.systemPrompt.trim()) {
    throw new AgentValidationError('Invalid agent configuration', { systemPrompt: 'System prompt is required.' })
  }
  const providerError = await validateProviderRef(deps, auth.project.id, config.provider)
  if (providerError) {
    throw new AgentValidationError('Invalid agent configuration', providerError)
  }
  const skillsError = validateSkills(config.skills)
  if (skillsError) {
    throw new AgentValidationError('Invalid agent configuration', skillsError)
  }
  const subagentsError = validateSubagents(config.subagents, parentAgentId)
  if (subagentsError) {
    throw new AgentValidationError('Invalid agent configuration', subagentsError)
  }
  const toolsError = validateAllowedTools(config.allowedTools)
  if (toolsError) {
    throw new AgentValidationError('Invalid agent configuration', toolsError)
  }
  const connectorError = await validateMcpConnectors(deps, auth.project.id, config.mcpConnectors)
  if (connectorError) {
    throw new AgentValidationError('Invalid agent configuration', connectorError)
  }
  for (const subagent of config.subagents) {
    const referenced = await deps.agents.find(auth.project.id, subagent.agentId)
    if (!referenced || referenced.metadata.deletedAt) {
      throw new AgentValidationError('Invalid agent configuration', {
        subagents: `Sub-agent must reference an active Agent in the selected project: ${subagent.agentId}`,
      })
    }
  }
}

async function selectedIdentity(deps: Deps, auth: AuthScope, identityRef: string | null, agentId?: string) {
  if (!identityRef) return null
  if (!deps.identities) throw new Error('Identity dependencies are not configured')
  const identity = await deps.identities.find(auth.project.id, identityRef)
  if (!identity || identity.metadata.deletedAt || identity.status.state !== 'active' || !identity.status.descriptor) {
    throw new AgentValidationError('Invalid agent configuration', {
      identityRef: 'Identity must be active in the selected project.',
    })
  }
  if (identity.status.boundAgentId && identity.status.boundAgentId !== agentId) {
    throw new IdentityAlreadyBoundError()
  }
  runtimeNameForIdentity(identity.status.descriptor.runtime)
  return identity.status.descriptor
}

// A null provider defers project-default resolution to session start, so it
// needs no validation here. The model is NOT checked against the catalog here:
// an agent is environment-agnostic at creation, so the hosting mode is unknown,
// and a self-hosted agent legitimately pins a runner-native model id (e.g.
// `opus`) that never appears in the global catalog. Model validity is therefore
// resolved at session creation, where the environment — and thus whether the
// catalog (cloud) or the runner's runtime declarations (self-hosted) is authoritative —
// is known.
async function validateProviderRef(deps: Deps, projectId: string, provider: string | null) {
  if (!provider) {
    return null
  }
  if (!(await deps.agents.providerEnabled(projectId, provider))) {
    return { provider: 'Provider is disabled or unavailable for this project.' }
  }
  return null
}

async function validateMcpConnectors(deps: Deps, _projectId: string, connectorIds: string[]) {
  for (const connectorId of connectorIds) {
    if (!(await deps.agents.connectorAvailable(connectorId))) {
      return { mcpConnectors: `MCP connector is not available in the platform catalog: ${connectorId}` }
    }
  }
  return null
}

export async function createAgent(
  deps: Deps,
  auth: AuthScope,
  input: {
    name: string
    description: string | null
    spec: Omit<AgentSpec, 'identity'>
    identityRef?: string | null
    idempotencyKey?: string
  },
): Promise<Agent> {
  const requestFingerprint = input.idempotencyKey
    ? await creationFingerprint({
        name: input.name,
        description: input.description,
        spec: input.spec,
        identityRef: input.identityRef ?? null,
      })
    : undefined
  const keyHash = input.idempotencyKey ? await creationDigest(input.idempotencyKey) : undefined
  if (keyHash && requestFingerprint) {
    const replay = await deps.agents.findCreation(auth.project.id, keyHash)
    if (replay) {
      if (replay.fingerprint !== requestFingerprint) throw new CreationIdempotencyConflictError()
      return replay.agent
    }
  }
  let identity: AgentSpec['identity']
  try {
    identity = await selectedIdentity(deps, auth, input.identityRef ?? null)
  } catch (error) {
    if (error instanceof IdentityAlreadyBoundError && keyHash && requestFingerprint) {
      const replay = await deps.agents.findCreation(auth.project.id, keyHash)
      if (replay) {
        if (replay.fingerprint !== requestFingerprint) throw new CreationIdempotencyConflictError()
        return replay.agent
      }
    }
    throw error
  }
  const spec: AgentSpec = { ...input.spec, identity }
  await validateConfig(deps, auth, spec)
  const createdAt = new Date().toISOString()
  const { agent, version } = await deps.agents.insertWithVersion(
    {
      projectId: auth.project.id,
      name: input.name,
      description: input.description,
      spec,
      ...(keyHash && requestFingerprint ? { creationKeyHash: keyHash, creationFingerprint: requestFingerprint } : {}),
    },
    createdAt,
  )
  return {
    ...agent,
    status: { ...agent.status, currentVersionId: version.metadata.uid, version: version.status.version },
  }
}

// The runtime config fields whose presence in a PATCH body forces a new version
// snapshot. (name/description are not runtime config — they never version.)
const RUNTIME_CONFIG_FIELDS = [
  'systemPrompt',
  'provider',
  'model',
  'skills',
  'subagents',
  'allowedTools',
  'mcpConnectors',
  'identityRef',
] as const

export interface UpdateAgentPatch {
  name?: string
  description?: string | null
  systemPrompt?: string
  provider?: string | null
  model?: string | null
  skills?: string[]
  subagents?: AgentSubagentReference[]
  allowedTools?: string[]
  mcpConnectors?: string[]
  identityRef?: string | null
}

export interface UpdateAgentResult {
  agent: Agent
}

// Orchestrates a PATCH: field merge, config validation, and version snapshots.
export async function updateAgent(
  deps: Deps,
  auth: AuthScope,
  agent: Agent,
  patch: UpdateAgentPatch,
): Promise<UpdateAgentResult> {
  const fields = patch
  const hasFieldUpdates = Object.keys(fields).length > 0

  const nextIdentity =
    fields.identityRef !== undefined
      ? await selectedIdentity(deps, auth, fields.identityRef, agent.metadata.uid)
      : agent.spec.identity
  const next: AgentSpec = {
    systemPrompt: fields.systemPrompt !== undefined ? fields.systemPrompt : agent.spec.systemPrompt,
    provider: fields.provider !== undefined ? fields.provider : agent.spec.provider,
    model: fields.model !== undefined ? fields.model : agent.spec.model,
    skills: fields.skills ?? agent.spec.skills,
    subagents: fields.subagents ?? agent.spec.subagents,
    allowedTools: fields.allowedTools ?? agent.spec.allowedTools,
    mcpConnectors: fields.mcpConnectors ?? agent.spec.mcpConnectors,
    identity: nextIdentity,
  }
  if (hasFieldUpdates) {
    await validateConfig(deps, auth, next, agent.metadata.uid)
  }

  const updatedAt = new Date().toISOString()
  const runtimeChanged = RUNTIME_CONFIG_FIELDS.some((field) => fields[field] !== undefined)
  // A runtime change snapshots a new immutable version; otherwise the current
  // version (id + number) is retained.
  const name = fields.name ?? agent.metadata.name
  const description = fields.description !== undefined ? fields.description : agent.metadata.description
  const version = runtimeChanged
    ? await deps.agents.updateWithVersion(auth.project.id, agent, { name, description, spec: next }, updatedAt)
    : null
  const currentVersionId = version?.metadata.uid ?? agent.status.currentVersionId

  if (!runtimeChanged) {
    await deps.agents.update(
      auth.project.id,
      agent.metadata.uid,
      { name, description, spec: next, currentVersionId },
      updatedAt,
    )
  }

  const updated: Agent = {
    ...agent,
    metadata: { ...agent.metadata, name, description, updatedAt },
    spec: next,
    status: {
      ...agent.status,
      phase: 'active',
      currentVersionId,
      version: version?.status.version ?? agent.status.version,
    },
  }
  return { agent: updated }
}

export async function deleteAgent(deps: Deps, auth: AuthScope, agentId: string): Promise<boolean> {
  return deps.agents.delete(auth.project.id, agentId, new Date().toISOString())
}
