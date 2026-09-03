export const RUNTIME_NAMES = ['enbor', 'claude-code', 'codex', 'copilot'] as const
export type RuntimeName = (typeof RUNTIME_NAMES)[number]

export const EXTERNAL_RUNTIME_NAMES = ['claude-code', 'codex', 'copilot'] as const
export type ExternalRuntimeName = (typeof EXTERNAL_RUNTIME_NAMES)[number]

const RUNTIME_NAME_SET = new Set<string>(RUNTIME_NAMES)
const EXTERNAL_RUNTIME_NAME_SET = new Set<string>(EXTERNAL_RUNTIME_NAMES)

export function isRuntimeName(value: unknown): value is RuntimeName {
  return typeof value === 'string' && RUNTIME_NAME_SET.has(value)
}

export function isExternalRuntimeName(value: unknown): value is ExternalRuntimeName {
  return typeof value === 'string' && EXTERNAL_RUNTIME_NAME_SET.has(value)
}
