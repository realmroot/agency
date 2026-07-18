import { AMA_SANDBOX_TOOL_NAMES } from '@ama/runtime-contracts/agent-tools'
import type { AgentFormState, EnvironmentFormState, SessionFormState, VaultFormState } from './types'

const DEFAULT_ALLOWED_TOOLS = AMA_SANDBOX_TOOL_NAMES.join('\n')

export const emptyEnvironment: EnvironmentFormState = {
  name: 'Node workspace',
  description: 'Default workspace for Pi-backed coding sessions.',
  type: 'cloud',
  networkingType: 'limited',
  allowMcpServers: false,
  allowPackageManagers: true,
  allowedHosts: 'registry.npmjs.org',
  packages: [
    { id: 'pkg-default-tsx', manager: 'npm', name: 'tsx@latest' },
    { id: 'pkg-default-typescript', manager: 'npm', name: 'typescript@latest' },
  ],
  variables: 'NODE_ENV=development',
}

export const emptyAgent: AgentFormState = {
  name: 'Coding agent',
  description: 'Executes development work in a managed sandbox.',
  systemPrompt: 'You are a focused coding agent. Make changes, run checks, and report the result.',
  provider: 'workers-ai',
  model: '',
  skills: 'ama@coding-agent',
  allowedTools: DEFAULT_ALLOWED_TOOLS,
  mcpConnectors: '',
}

export const emptySession: SessionFormState = {
  agentId: '',
  environmentId: '',
  runtime: 'ama',
  prompt: '',
  credentialVaultIds: [],
  resources: [],
}

export const emptyVault: VaultFormState = {
  name: 'Provider credentials',
  description: 'Credential references used by runtime sessions.',
  scope: 'project',
}
