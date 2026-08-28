import {
  type Agent,
  type AgentSpec,
  type AgentSubagent,
  type RealmrootAgentIdentity,
  validateAllowedTools,
  validateRealmrootIdentity,
  validateSkills,
  validateSubagents,
} from '@server/domain/agent'
import { secretRefIdentity } from '@server/domain/vault'
import type { Deps } from './deps'
import { AgentArchivedError, AgentValidationError, type AuthScope } from './ports'

export function normalizeAgentSpec(spec: AgentSpec): AgentSpec {
  return spec.provider === 'workers-ai' ? { ...spec, provider: null } : spec
}

// Validates the agent spec against sibling resources and secret-material rules.
// Throws AgentValidationError on the first failure.
export async function validateAgentConfig(deps: Deps, auth: AuthScope, config: AgentSpec) {
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
  const subagentsError = validateSubagents(config.subagents)
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
  const subagentConnectorError = await validateSubagentMcpConnectors(deps, auth.project.id, config.subagents)
  if (subagentConnectorError) {
    throw new AgentValidationError('Invalid agent configuration', subagentConnectorError)
  }
}

async function realmrootCredentialActive(deps: Deps, auth: AuthScope, reference: string) {
  const identity = secretRefIdentity(reference)
  if (!identity?.credentialId || identity.versionId) return false
  const vault = await deps.vaults.find(identity.vaultId, {
    organizationId: auth.organization.id,
    projectId: auth.project.id,
  })
  if (vault?.status.phase !== 'active') return false
  const credential = await deps.vaults.findCredential(identity.vaultId, identity.credentialId)
  return (
    credential?.spec.vaultId === identity.vaultId &&
    credential.spec.type === 'ama.dev/realmroot-agent-state' &&
    credential.status.phase === 'active'
  )
}

// A null provider defers project-default resolution to session start. The
// legacy `workers-ai` transport alias does the same; session creation resolves
// it to the model's real vendor or the selected host runtime. The model is NOT
// checked against the catalog here:
// an agent is environment-agnostic at creation, so the hosting mode is unknown,
// and a self-hosted agent legitimately pins a runner-native model id (e.g.
// `opus`) that never appears in the global catalog. Model validity is therefore
// resolved at session creation, where the environment — and thus whether the
// catalog (cloud) or the runner's runtime declarations (self-hosted) is authoritative —
// is known.
async function validateProviderRef(deps: Deps, projectId: string, provider: string | null) {
  if (!provider || provider === 'workers-ai') {
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

async function validateSubagentMcpConnectors(deps: Deps, projectId: string, subagents: AgentSpec['subagents']) {
  for (const subagent of subagents) {
    const connectorError = await validateMcpConnectors(deps, projectId, subagent.mcpConnectors)
    if (connectorError) {
      return { subagents: `Sub-agent MCP connector is not available: ${subagent.name}` }
    }
  }
  return null
}

export async function createAgent(
  deps: Deps,
  auth: AuthScope,
  input: {
    id?: string
    username: string
    name: string
    description: string | null
    identity: RealmrootAgentIdentity
    spec: AgentSpec
  },
): Promise<Agent> {
  const spec = normalizeAgentSpec(input.spec)
  await validateAgentCreation(deps, auth, { ...input, spec })
  const createdAt = new Date().toISOString()
  const agent = await deps.agents.insert(
    {
      projectId: auth.project.id,
      ...(input.id ? { id: input.id } : {}),
      username: input.username,
      name: input.name,
      description: input.description,
      spec,
      identity: input.identity,
    },
    createdAt,
  )
  const version = await deps.agents.insertVersion(agent, spec, createdAt)
  await deps.agents.setCurrentVersion(agent.metadata.uid, version.metadata.uid)
  return {
    ...agent,
    status: { ...agent.status, currentVersionId: version.metadata.uid, version: version.status.version },
  }
}

export async function validateAgentCreation(
  deps: Deps,
  auth: AuthScope,
  input: { identity: RealmrootAgentIdentity; spec: AgentSpec },
) {
  await validateAgentConfig(deps, auth, input.spec)
  const identityError = validateRealmrootIdentity(input.identity, {
    allowLoopbackRealmrootHttp: deps.allowLoopbackRealmrootHttp === true,
  })
  if (identityError) throw new AgentValidationError('Invalid agent identity', identityError)
  if (!(await realmrootCredentialActive(deps, auth, input.identity.credentialRef))) {
    throw new AgentValidationError('Invalid agent identity', {
      identity: 'Realmroot state must reference an active credential in a visible AMA Vault.',
    })
  }
}

// The runtime config fields whose presence in a PATCH body forces a new version
// snapshot. (name/description are not runtime config — they never version.)
const RUNTIME_CONFIG_FIELDS = [
  'runtime',
  'systemPrompt',
  'provider',
  'model',
  'skills',
  'subagents',
  'allowedTools',
  'mcpConnectors',
] as const

export interface UpdateAgentPatch {
  runtime?: AgentSpec['runtime']
  name?: string
  description?: string | null
  systemPrompt?: string
  provider?: string | null
  model?: string | null
  skills?: string[]
  subagents?: AgentSubagent[]
  allowedTools?: string[]
  mcpConnectors?: string[]
  archived?: boolean
}

export interface UpdateAgentResult {
  agent: Agent
  archived: boolean
}

// Orchestrates a PATCH: archive lifecycle transitions, field merge, config
// validation, and version snapshot creation. Returns the updated record plus
// whether an archive transition happened (so the route can audit). Throws
// AgentArchivedError when field updates target an archived agent.
export async function updateAgent(
  deps: Deps,
  auth: AuthScope,
  agent: Agent,
  patch: UpdateAgentPatch,
): Promise<UpdateAgentResult> {
  const { archived, ...fields } = patch
  const hasFieldUpdates = Object.keys(fields).length > 0

  if (agent.metadata.archivedAt) {
    if (hasFieldUpdates) {
      throw new AgentArchivedError()
    }
    if (archived === false) {
      const updatedAt = new Date().toISOString()
      await deps.agents.unarchive(auth.project.id, agent.metadata.uid, updatedAt)
      return {
        agent: {
          ...agent,
          metadata: { ...agent.metadata, archivedAt: null, updatedAt },
          status: { ...agent.status, phase: 'active' },
        },
        archived: false,
      }
    }
    // archived: true (idempotent) or empty patch — no change.
    return { agent, archived: false }
  }

  const next = normalizeAgentSpec({
    runtime: fields.runtime ?? agent.spec.runtime,
    systemPrompt: fields.systemPrompt !== undefined ? fields.systemPrompt : agent.spec.systemPrompt,
    provider: fields.provider !== undefined ? fields.provider : agent.spec.provider,
    model: fields.model !== undefined ? fields.model : agent.spec.model,
    skills: fields.skills ?? agent.spec.skills,
    subagents: fields.subagents ?? agent.spec.subagents,
    allowedTools: fields.allowedTools ?? agent.spec.allowedTools,
    mcpConnectors: fields.mcpConnectors ?? agent.spec.mcpConnectors,
  })
  await validateAgentConfig(deps, auth, next)

  const updatedAt = new Date().toISOString()
  const runtimeChanged = RUNTIME_CONFIG_FIELDS.some((field) => fields[field] !== undefined)
  // A runtime change snapshots a new immutable version; otherwise the current
  // version (id + number) is retained.
  const version = runtimeChanged ? await deps.agents.insertVersion(agent, next, updatedAt) : null
  const archivedAt = archived === true ? updatedAt : agent.metadata.archivedAt
  const name = fields.name ?? agent.metadata.name
  const description = fields.description !== undefined ? fields.description : agent.metadata.description
  const currentVersionId = version?.metadata.uid ?? agent.status.currentVersionId

  await deps.agents.update(
    auth.project.id,
    agent.metadata.uid,
    {
      name,
      description,
      spec: next,
      archivedAt,
      currentVersionId,
    },
    updatedAt,
  )

  const updated: Agent = {
    ...agent,
    metadata: { ...agent.metadata, name, description, archivedAt, updatedAt },
    spec: next,
    status: {
      ...agent.status,
      phase: archivedAt ? 'archived' : 'active',
      currentVersionId,
      version: version?.status.version ?? agent.status.version,
    },
  }
  return { agent: updated, archived: archived === true }
}
