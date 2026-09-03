import type { EnborSandboxToolName } from './agent-tools'
import type { EnborSandboxToolInputByName, EnborSandboxToolOutputByName } from './tool-contracts'

export type ToolExecutionInput<TName extends EnborSandboxToolName = EnborSandboxToolName> = {
  sessionId: string
  sandboxId: string
  toolCallId: string
  toolName: TName
  input: EnborSandboxToolInputByName[TName]
  cwd?: string
}

export type ToolExecutionResult<TName extends EnborSandboxToolName = EnborSandboxToolName> = {
  toolCallId: string
  toolName: TName
  output: EnborSandboxToolOutputByName[TName]
  error: Record<string, unknown> | null
  durationMs: number
}
