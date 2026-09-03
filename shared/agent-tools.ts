export const PI_CODING_AGENT_TOOL_NAMES = ['read', 'bash', 'edit', 'write', 'grep', 'find', 'ls'] as const

export const ENBOR_SANDBOX_TOOL_NAMES = [...PI_CODING_AGENT_TOOL_NAMES, 'fetch', 'web_search'] as const

export const ENBOR_ORCHESTRATION_TOOL_NAMES = ['agent'] as const

export const ENBOR_RUNTIME_TOOL_NAMES = [...ENBOR_SANDBOX_TOOL_NAMES, ...ENBOR_ORCHESTRATION_TOOL_NAMES] as const

export type EnborSandboxToolName = (typeof ENBOR_SANDBOX_TOOL_NAMES)[number]
export type EnborOrchestrationToolName = (typeof ENBOR_ORCHESTRATION_TOOL_NAMES)[number]
export type EnborRuntimeToolName = EnborSandboxToolName | EnborOrchestrationToolName

export function isEnborSandboxToolName(value: string): value is EnborSandboxToolName {
  return (ENBOR_SANDBOX_TOOL_NAMES as readonly string[]).includes(value)
}

export function isEnborRuntimeToolName(value: string): value is EnborRuntimeToolName {
  return (ENBOR_RUNTIME_TOOL_NAMES as readonly string[]).includes(value)
}

// Reference vocabularies from the external agent runtimes Enbor bridges today.
// These are not all implemented by Enbor's first-party runtime; they document
// provider-native names so adapters can translate intentionally.
export const CLAUDE_CODE_BUILTIN_TOOL_NAMES = [
  'Agent',
  'Bash',
  'Edit',
  'ExitPlanMode',
  'Glob',
  'Grep',
  'ListMcpResources',
  'NotebookEdit',
  'Read',
  'ReadMcpResource',
  'Task',
  'TodoWrite',
  'WebFetch',
  'WebSearch',
  'Write',
] as const

export const CODEX_RUNTIME_TOOL_EVENTS = ['command_execution', 'mcp_tool_call', 'web_search'] as const

export const COPILOT_PERMISSION_TOOL_KINDS = [
  'shell',
  'write',
  'read',
  'mcp',
  'url',
  'custom-tool',
  'memory',
  'hook',
] as const

export const MCP_AGENT_TOOL_PREFIX = 'mcp__'

export function agentToolNameForMcp(connectorId: string, toolName: string) {
  return `${MCP_AGENT_TOOL_PREFIX}${toolNamePart(connectorId)}__${toolNamePart(toolName)}`
}

export function mcpConnectorToolWildcard(connectorId: string) {
  return `${MCP_AGENT_TOOL_PREFIX}${toolNamePart(connectorId)}__*`
}

export function isMcpAgentToolName(value: string) {
  return new RegExp(`^${MCP_AGENT_TOOL_PREFIX}[A-Za-z0-9_-]+__[A-Za-z0-9_*.-]+$`).test(value)
}

function toolNamePart(value: string) {
  return value
    .trim()
    .replaceAll(/[^A-Za-z0-9_-]+/g, '_')
    .replaceAll(/^_+|_+$/g, '')
}
