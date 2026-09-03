import { z } from 'zod'
import { ENBOR_ORCHESTRATION_TOOL_NAMES, ENBOR_SANDBOX_TOOL_NAMES } from './agent-tools'

export const EnborSandboxToolNameSchema = z.enum(ENBOR_SANDBOX_TOOL_NAMES)
export const EnborOrchestrationToolNameSchema = z.enum(ENBOR_ORCHESTRATION_TOOL_NAMES)

const NonNegativeIntegerSchema = z.number().int().min(0)
const PositiveNumberSchema = z.number().positive()

export const BashToolInputSchema = z
  .object({
    command: z.string().min(1),
    timeout: PositiveNumberSchema.optional(),
  })
  .strict()

export const BashToolOutputSchema = z
  .object({
    stdout: z.string(),
    stderr: z.string(),
    exitCode: z.number().int(),
  })
  .strict()

export const ReadToolInputSchema = z
  .object({
    path: z.string().min(1),
    offset: NonNegativeIntegerSchema.optional(),
    limit: NonNegativeIntegerSchema.optional(),
  })
  .strict()

export const ReadToolOutputSchema = z
  .object({
    content: z.string(),
    path: z.string().optional(),
  })
  .strict()

export const WriteToolInputSchema = z
  .object({
    path: z.string().min(1),
    content: z.string(),
  })
  .strict()

export const WriteToolOutputSchema = z
  .object({
    ok: z.literal(true),
    path: z.string().optional(),
    bytes: NonNegativeIntegerSchema.optional(),
  })
  .strict()

export const EditToolInputSchema = z
  .object({
    path: z.string().min(1),
    edits: z
      .array(
        z
          .object({
            oldText: z.string().min(1),
            newText: z.string(),
          })
          .strict(),
      )
      .min(1),
  })
  .strict()

export const EditToolOutputSchema = z
  .object({
    ok: z.literal(true),
    path: z.string(),
  })
  .strict()

export const GrepToolInputSchema = z
  .object({
    pattern: z.string().min(1),
    path: z.string().min(1).optional(),
    glob: z.string().min(1).optional(),
    ignoreCase: z.boolean().optional(),
    literal: z.boolean().optional(),
    context: NonNegativeIntegerSchema.optional(),
    limit: NonNegativeIntegerSchema.optional(),
  })
  .strict()

export const FindToolInputSchema = z
  .object({
    pattern: z.string().min(1).optional(),
    glob: z.string().min(1).optional(),
    path: z.string().min(1).optional(),
    limit: NonNegativeIntegerSchema.optional(),
  })
  .refine((input) => input.pattern !== undefined || input.glob !== undefined, {
    message: 'find requires pattern or glob',
  })
  .strict()

export const LsToolInputSchema = z
  .object({
    path: z.string().min(1).optional(),
    limit: NonNegativeIntegerSchema.optional(),
  })
  .strict()

export const FetchToolInputSchema = z
  .object({
    url: z
      .string()
      .url()
      .regex(/^https?:\/\//),
  })
  .strict()

export const WebSearchToolInputSchema = z
  .object({
    query: z.string().min(1),
    limit: NonNegativeIntegerSchema.optional(),
  })
  .strict()

export const AgentToolInputSchema = z
  .object({
    prompt: z.string().min(1),
    description: z.string().min(1).optional(),
    subagentName: z.string().min(1).optional(),
  })
  .strict()

export const CommandToolOutputSchema = BashToolOutputSchema

export const EnborSandboxToolInputSchemas = {
  bash: BashToolInputSchema,
  read: ReadToolInputSchema,
  write: WriteToolInputSchema,
  edit: EditToolInputSchema,
  grep: GrepToolInputSchema,
  find: FindToolInputSchema,
  ls: LsToolInputSchema,
  fetch: FetchToolInputSchema,
  web_search: WebSearchToolInputSchema,
} as const

export const EnborOrchestrationToolInputSchemas = {
  agent: AgentToolInputSchema,
} as const

export const EnborSandboxToolOutputSchemas = {
  bash: BashToolOutputSchema,
  read: ReadToolOutputSchema,
  write: WriteToolOutputSchema,
  edit: EditToolOutputSchema,
  grep: CommandToolOutputSchema,
  find: CommandToolOutputSchema,
  ls: CommandToolOutputSchema,
  fetch: CommandToolOutputSchema,
  web_search: CommandToolOutputSchema,
} as const

export const EnborSandboxToolCallSchema = z.discriminatedUnion('name', [
  z.object({ id: z.string().min(1), name: z.literal('bash'), input: BashToolInputSchema }).strict(),
  z.object({ id: z.string().min(1), name: z.literal('read'), input: ReadToolInputSchema }).strict(),
  z.object({ id: z.string().min(1), name: z.literal('write'), input: WriteToolInputSchema }).strict(),
  z.object({ id: z.string().min(1), name: z.literal('edit'), input: EditToolInputSchema }).strict(),
  z.object({ id: z.string().min(1), name: z.literal('grep'), input: GrepToolInputSchema }).strict(),
  z.object({ id: z.string().min(1), name: z.literal('find'), input: FindToolInputSchema }).strict(),
  z.object({ id: z.string().min(1), name: z.literal('ls'), input: LsToolInputSchema }).strict(),
  z.object({ id: z.string().min(1), name: z.literal('fetch'), input: FetchToolInputSchema }).strict(),
  z.object({ id: z.string().min(1), name: z.literal('web_search'), input: WebSearchToolInputSchema }).strict(),
])

export const EnborOrchestrationToolCallSchema = z.discriminatedUnion('name', [
  z.object({ id: z.string().min(1), name: z.literal('agent'), input: AgentToolInputSchema }).strict(),
])

export type BashToolInput = z.infer<typeof BashToolInputSchema>
export type BashToolOutput = z.infer<typeof BashToolOutputSchema>
export type ReadToolInput = z.infer<typeof ReadToolInputSchema>
export type ReadToolOutput = z.infer<typeof ReadToolOutputSchema>
export type WriteToolInput = z.infer<typeof WriteToolInputSchema>
export type WriteToolOutput = z.infer<typeof WriteToolOutputSchema>
export type EditToolInput = z.infer<typeof EditToolInputSchema>
export type EditToolOutput = z.infer<typeof EditToolOutputSchema>
export type GrepToolInput = z.infer<typeof GrepToolInputSchema>
export type FindToolInput = z.infer<typeof FindToolInputSchema>
export type LsToolInput = z.infer<typeof LsToolInputSchema>
export type FetchToolInput = z.infer<typeof FetchToolInputSchema>
export type WebSearchToolInput = z.infer<typeof WebSearchToolInputSchema>
export type AgentToolInput = z.infer<typeof AgentToolInputSchema>
export type CommandToolOutput = z.infer<typeof CommandToolOutputSchema>
export type EnborSandboxToolCall = z.infer<typeof EnborSandboxToolCallSchema>
export type EnborOrchestrationToolCall = z.infer<typeof EnborOrchestrationToolCallSchema>

export type EnborSandboxToolInputByName = {
  bash: BashToolInput
  read: ReadToolInput
  write: WriteToolInput
  edit: EditToolInput
  grep: GrepToolInput
  find: FindToolInput
  ls: LsToolInput
  fetch: FetchToolInput
  web_search: WebSearchToolInput
}

export type EnborOrchestrationToolInputByName = {
  agent: AgentToolInput
}

export type EnborSandboxToolOutputByName = {
  bash: BashToolOutput
  read: ReadToolOutput
  write: WriteToolOutput
  edit: EditToolOutput
  grep: CommandToolOutput
  find: CommandToolOutput
  ls: CommandToolOutput
  fetch: CommandToolOutput
  web_search: CommandToolOutput
}

export function parseEnborSandboxToolInput<TName extends keyof EnborSandboxToolInputByName>(
  name: TName,
  input: unknown,
): EnborSandboxToolInputByName[TName] {
  return EnborSandboxToolInputSchemas[name].parse(input) as EnborSandboxToolInputByName[TName]
}

export function parseEnborOrchestrationToolInput<TName extends keyof EnborOrchestrationToolInputByName>(
  name: TName,
  input: unknown,
): EnborOrchestrationToolInputByName[TName] {
  return EnborOrchestrationToolInputSchemas[name].parse(input) as EnborOrchestrationToolInputByName[TName]
}

export function parseEnborSandboxToolOutput<TName extends keyof EnborSandboxToolOutputByName>(
  name: TName,
  output: unknown,
): EnborSandboxToolOutputByName[TName] {
  return EnborSandboxToolOutputSchemas[name].parse(output) as EnborSandboxToolOutputByName[TName]
}

export function enborSandboxToolInputJsonSchema<TName extends keyof EnborSandboxToolInputByName>(name: TName) {
  return z.toJSONSchema(EnborSandboxToolInputSchemas[name])
}

export function enborOrchestrationToolInputJsonSchema<TName extends keyof EnborOrchestrationToolInputByName>(
  name: TName,
) {
  return z.toJSONSchema(EnborOrchestrationToolInputSchemas[name])
}
