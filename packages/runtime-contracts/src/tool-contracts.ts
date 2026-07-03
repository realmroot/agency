import { z } from 'zod'
import { AMA_ORCHESTRATION_TOOL_NAMES, AMA_SANDBOX_TOOL_NAMES } from './agent-tools'

export const AmaSandboxToolNameSchema = z.enum(AMA_SANDBOX_TOOL_NAMES)
export const AmaOrchestrationToolNameSchema = z.enum(AMA_ORCHESTRATION_TOOL_NAMES)

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

export const AmaSandboxToolInputSchemas = {
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

export const AmaOrchestrationToolInputSchemas = {
  agent: AgentToolInputSchema,
} as const

export const AmaSandboxToolOutputSchemas = {
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

export const AmaSandboxToolCallSchema = z.discriminatedUnion('name', [
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

export const AmaOrchestrationToolCallSchema = z.discriminatedUnion('name', [
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
export type AmaSandboxToolCall = z.infer<typeof AmaSandboxToolCallSchema>
export type AmaOrchestrationToolCall = z.infer<typeof AmaOrchestrationToolCallSchema>

export type AmaSandboxToolInputByName = {
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

export type AmaOrchestrationToolInputByName = {
  agent: AgentToolInput
}

export type AmaSandboxToolOutputByName = {
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

export function parseAmaSandboxToolInput<TName extends keyof AmaSandboxToolInputByName>(
  name: TName,
  input: unknown,
): AmaSandboxToolInputByName[TName] {
  return AmaSandboxToolInputSchemas[name].parse(input) as AmaSandboxToolInputByName[TName]
}

export function parseAmaOrchestrationToolInput<TName extends keyof AmaOrchestrationToolInputByName>(
  name: TName,
  input: unknown,
): AmaOrchestrationToolInputByName[TName] {
  return AmaOrchestrationToolInputSchemas[name].parse(input) as AmaOrchestrationToolInputByName[TName]
}

export function parseAmaSandboxToolOutput<TName extends keyof AmaSandboxToolOutputByName>(
  name: TName,
  output: unknown,
): AmaSandboxToolOutputByName[TName] {
  return AmaSandboxToolOutputSchemas[name].parse(output) as AmaSandboxToolOutputByName[TName]
}

export function amaSandboxToolInputJsonSchema<TName extends keyof AmaSandboxToolInputByName>(name: TName) {
  return z.toJSONSchema(AmaSandboxToolInputSchemas[name])
}

export function amaOrchestrationToolInputJsonSchema<TName extends keyof AmaOrchestrationToolInputByName>(name: TName) {
  return z.toJSONSchema(AmaOrchestrationToolInputSchemas[name])
}
