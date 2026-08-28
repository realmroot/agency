import { AMA_SANDBOX_TOOL_NAMES, isAmaSandboxToolName } from '@shared/agent-tools'
import type { ResourceMetadata, ResourcePhase } from './resource'
import type { RuntimeName } from './runtime-catalog'

export interface AgentSpec {
  runtime: RuntimeName
  systemPrompt: string
  provider: string | null
  model: string | null
  skills: string[]
  subagents: AgentSubagent[]
  allowedTools: string[]
  mcpConnectors: string[]
}

export interface RealmrootAgentIdentity {
  issuer: string
  subject: string
  username: string
  runtime: RuntimeName
  credentialRef: string
}

export interface LegacyRealmrootAgentBinding {
  agentId: string
  origin: string
  credentialRef: string
}

export const REALMROOT_AGENT_USERNAME = /^[a-z0-9_.-]{3,64}$/

export function validateAgentUsername(username: string): FieldErrors | null {
  if (!REALMROOT_AGENT_USERNAME.test(username)) {
    return { username: 'Username must contain 3 to 64 lowercase letters, numbers, underscores, periods, or hyphens.' }
  }
  return null
}

function loopbackHttpIssuer(url: URL) {
  const hostname = url.hostname.toLowerCase()
  return url.protocol === 'http:' && (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]')
}

export function validateRealmrootIdentity(
  identity: RealmrootAgentIdentity,
  options: { allowLoopbackRealmrootHttp?: boolean } = {},
): FieldErrors | null {
  if (!identity.subject.trim() || identity.subject.length > 200) {
    return { identity: 'Realmroot Agent subject is required.' }
  }
  if (validateAgentUsername(identity.username)) {
    return { identity: 'Realmroot Agent username is invalid.' }
  }
  let issuer: URL
  try {
    issuer = new URL(identity.issuer)
  } catch {
    return { identity: 'Realmroot issuer must be an absolute HTTPS URL.' }
  }
  const allowedProtocol =
    issuer.protocol === 'https:' || (options.allowLoopbackRealmrootHttp === true && loopbackHttpIssuer(issuer))
  if (!allowedProtocol || issuer.username || issuer.password || issuer.search || issuer.hash) {
    return { identity: 'Realmroot issuer must be an absolute HTTPS URL without credentials, query, or fragment.' }
  }
  if (!identity.credentialRef.startsWith('ama://vaults/')) {
    return { identity: 'Realmroot state must use an AMA Vault credential reference.' }
  }
  return null
}

export interface AgentSubagent {
  name: string
  description: string
  systemPrompt: string
  model: string | null
  allowedTools: string[]
  skills: string[]
  mcpConnectors: string[]
}

export interface Agent {
  metadata: ResourceMetadata
  identity: RealmrootAgentIdentity | null
  spec: AgentSpec
  status: AgentStatus
}

export interface AgentStatus {
  phase: ResourcePhase
  ready: boolean
  currentVersionId: string | null
  version: number
}

export interface AgentVersion {
  metadata: ResourceMetadata
  spec: AgentSpec
  status: AgentVersionStatus
}

export interface AgentVersionStatus {
  agentId: string
  version: number
}

// Validation failures are keyed by the field that caused them; the http layer
// maps a non-null result to a 400 validation error envelope.
export type FieldErrors = Record<string, string>

function secretKey(key: string) {
  const normalized = key.toLowerCase().replaceAll(/[^a-z0-9]/g, '')
  return (
    normalized.includes('secret') ||
    normalized.includes('token') ||
    normalized.includes('apikey') ||
    normalized.includes('password') ||
    normalized.includes('privatekey')
  )
}

function secretString(value: string) {
  return (
    /-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(value) ||
    /\b(?:sk|ghp|github_pat|glpat|xox[baprs])_[A-Za-z0-9_-]{16,}\b/.test(value) ||
    /\b[A-Za-z0-9_-]{32,}\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}\b/.test(value) ||
    value.toLowerCase().includes('raw-secret')
  )
}

export function hasSecretMaterial(value: unknown): boolean {
  if (typeof value === 'string') {
    return secretString(value)
  }
  if (!value || typeof value !== 'object') {
    return false
  }
  if (Array.isArray(value)) {
    return value.some(hasSecretMaterial)
  }
  return Object.entries(value).some(([key, child]) => {
    return secretKey(key) || hasSecretMaterial(child)
  })
}

export function defaultAllowedTools() {
  return [...AMA_SANDBOX_TOOL_NAMES]
}

export function validateAllowedTools(tools: string[]): FieldErrors | null {
  const names = new Set<string>()
  for (const tool of tools) {
    if (names.has(tool)) {
      return { allowedTools: `Tool is listed more than once: ${tool}` }
    }
    names.add(tool)
    if (!isAmaSandboxToolName(tool)) {
      return { allowedTools: `Tool is not supported by the AMA runtime: ${tool}` }
    }
  }
  return null
}

export function validateSkills(skills: string[]): FieldErrors | null {
  for (const skill of skills) {
    if (
      !/^[A-Za-z0-9][A-Za-z0-9._/-]{0,127}(?:#[A-Za-z0-9][A-Za-z0-9._/-]{0,127})?@[A-Za-z0-9][A-Za-z0-9._/-]{0,127}$/.test(
        skill,
      ) ||
      /[\s?{}"'\\]/.test(skill)
    ) {
      return { skills: `Skill must be a stable <source>@<skill> reference: ${skill}` }
    }
    if (secretString(skill)) {
      return { skills: 'Secret material must be stored in a vault.' }
    }
  }
  return null
}

export function validateSubagents(subagents: AgentSubagent[]): FieldErrors | null {
  const names = new Set<string>()
  for (const subagent of subagents) {
    if (!/^[A-Za-z0-9][A-Za-z0-9._/-]{0,79}$/.test(subagent.name)) {
      return { subagents: `Sub-agent name must be a stable identifier: ${subagent.name}` }
    }
    if (names.has(subagent.name)) {
      return { subagents: `Sub-agent is configured more than once: ${subagent.name}` }
    }
    names.add(subagent.name)
    if (!subagent.description.trim()) {
      return { subagents: `Sub-agent description is required: ${subagent.name}` }
    }
    if (!subagent.systemPrompt.trim()) {
      return { subagents: `Sub-agent system prompt is required: ${subagent.name}` }
    }
    const toolsError = validateAllowedTools(subagent.allowedTools)
    if (toolsError) {
      return { subagents: Object.values(toolsError)[0] ?? 'Sub-agent allowed tools are invalid.' }
    }
    const skillsError = validateSkills(subagent.skills)
    if (skillsError) {
      return { subagents: Object.values(skillsError)[0] ?? 'Sub-agent skills are invalid.' }
    }
    if (hasSecretMaterial(subagent)) {
      return { subagents: 'Secret material must be stored in a vault.' }
    }
  }
  return null
}

export function nextVersionNumber(latestVersion: number | null) {
  return (latestVersion ?? 0) + 1
}
