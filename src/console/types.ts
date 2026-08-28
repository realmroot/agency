export const ENVIRONMENT_PACKAGE_MANAGERS = ['apt', 'cargo', 'gem', 'go', 'npm', 'pip'] as const

export type EnvironmentPackageManager = (typeof ENVIRONMENT_PACKAGE_MANAGERS)[number]

export interface EnvironmentPackageFormEntry {
  id: string
  manager: EnvironmentPackageManager
  name: string
}

export interface EnvironmentFormState {
  name: string
  description: string
  type: 'cloud' | 'self_hosted'
  networkingType: 'open' | 'limited' | 'closed'
  allowMcpServers: boolean
  allowPackageManagers: boolean
  allowedHosts: string
  packages: EnvironmentPackageFormEntry[]
  variables: string
}

export type AgentRuntime = 'ama' | 'claude-code' | 'codex' | 'copilot'

interface AgentFormFields {
  username: string
  name: string
  description: string
  systemPrompt: string
  provider: string
  model: string
  skills: string
  allowedTools: string
  mcpConnectors: string
}

export interface AgentFormState extends AgentFormFields {
  runtime: AgentRuntime
}

export interface CreateAgentFormState extends AgentFormFields {
  runtime: AgentRuntime | ''
}

export interface SessionFormState {
  agentId: string
  environmentId: string
  runtime: 'ama' | 'claude-code' | 'codex' | 'copilot'
  prompt: string
  credentialVaultIds: string[]
  resources: SessionResourceFormEntry[]
}

export type SessionResourceFormEntry =
  | {
      id: string
      type: 'git_repository'
      url: string
      ref: string
    }
  | {
      id: string
      type: 'memory'
      memoryStoreId: string
      readOnly: boolean
    }

export interface VaultFormState {
  name: string
  description: string
  scope: 'project' | 'organization'
}
