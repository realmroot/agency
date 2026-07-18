import {
  type Agent,
  type AgentSpec,
  type AgentSubagent,
  validateAllowedTools,
  validateSkills,
  validateSubagents,
} from '@server/domain/agent'
import type { Deps } from './deps'
import { AgentArchivedError, AgentValidationError, type AuthScope } from './ports'

// Validates the agent spec against sibling resources and secret-material rules.
// Throws AgentValidationError on the first failure.
async function validateConfig(deps: Deps, auth: AuthScope, config: AgentSpec) {
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
  input: { name: string; description: string | null; spec: AgentSpec },
): Promise<Agent> {
  await validateConfig(deps, auth, input.spec)
  const createdAt = new Date().toISOString()
  const agent = await deps.agents.insert(
    { projectId: auth.project.id, name: input.name, description: input.description, spec: input.spec },
    createdAt,
  )
  const version = await deps.agents.insertVersion(agent, input.spec, createdAt)
  await deps.agents.setCurrentVersion(agent.metadata.uid, version.metadata.uid)
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
] as const

export interface UpdateAgentPatch {
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

  const next: AgentSpec = {
    systemPrompt: fields.systemPrompt !== undefined ? fields.systemPrompt : agent.spec.systemPrompt,
    provider: fields.provider !== undefined ? fields.provider : agent.spec.provider,
    model: fields.model !== undefined ? fields.model : agent.spec.model,
    skills: fields.skills ?? agent.spec.skills,
    subagents: fields.subagents ?? agent.spec.subagents,
    allowedTools: fields.allowedTools ?? agent.spec.allowedTools,
    mcpConnectors: fields.mcpConnectors ?? agent.spec.mcpConnectors,
  }
  await validateConfig(deps, auth, next)

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
    { name, description, spec: next, archivedAt, currentVersionId },
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
