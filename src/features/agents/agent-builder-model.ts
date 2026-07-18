import { AMA_SANDBOX_TOOL_NAMES } from '@ama/runtime-contracts/agent-tools'
import { parseTools, providerPatch } from '@/console/format'
import { type Agent, type AgentInput, ApiError } from '@/lib/amarpc'

const DEFAULT_ALLOWED_TOOLS = AMA_SANDBOX_TOOL_NAMES.join('\n')

export const BUILDER_STEPS = ['start', 'core', 'tools', 'sandbox', 'test', 'done'] as const
export type BuilderStep = (typeof BUILDER_STEPS)[number]

export const BUILDER_STEP_TITLES: Record<BuilderStep, string> = {
  start: 'Goal',
  core: 'Core settings',
  tools: 'Tools and approvals',
  sandbox: 'Sandbox access',
  test: 'Test and publish',
  done: 'API examples',
}

export interface AgentBuilderDraft {
  name: string
  description: string
  systemPrompt: string
  provider: string
  model: string
  allowedTools: string
  mcpConnectors: string[]
  sandboxEnabled: boolean
  skills: string
}

export const DEFAULT_BUILDER_PROVIDER = 'workers-ai'

export const emptyBuilderDraft: AgentBuilderDraft = {
  name: '',
  description: '',
  systemPrompt: '',
  provider: DEFAULT_BUILDER_PROVIDER,
  model: '',
  allowedTools: '',
  mcpConnectors: [],
  sandboxEnabled: false,
  skills: '',
}

export interface AgentTemplate {
  id: string
  name: string
  summary: string
  draft: AgentBuilderDraft
}

export const AGENT_TEMPLATES: AgentTemplate[] = [
  {
    id: 'coding',
    name: 'Coding agent',
    summary: 'Implements changes and runs checks inside a managed sandbox.',
    draft: {
      ...emptyBuilderDraft,
      name: 'Coding agent',
      description: 'Executes development work in a managed sandbox.',
      systemPrompt: 'You are a focused coding agent. Make changes, run checks, and report the result.',
      allowedTools: DEFAULT_ALLOWED_TOOLS,
      sandboxEnabled: true,
      skills: 'ama@coding-agent',
    },
  },
  {
    id: 'research',
    name: 'Research assistant',
    summary: 'Investigates questions and answers with citations.',
    draft: {
      ...emptyBuilderDraft,
      name: 'Research assistant',
      description: 'Investigates questions and reports findings with sources.',
      systemPrompt:
        'You are a research assistant. Investigate the question, verify sources, and answer with citations.',
      allowedTools: 'fetch\nweb_search',
    },
  },
  {
    id: 'triage',
    name: 'Operations triage',
    summary: 'Reviews incoming work and summarizes the next action.',
    draft: {
      ...emptyBuilderDraft,
      name: 'Operations triage',
      description: 'Classifies incoming work and summarizes the next action.',
      systemPrompt:
        'You are a triage agent. Classify incoming work, summarize the decision, and report the next action.',
      allowedTools: 'read',
    },
  },
]

export function draftFromGoal(goal: string): AgentBuilderDraft {
  const trimmed = goal.trim().replaceAll(/\s+/g, ' ')
  const headline = trimmed.split(' ').slice(0, 6).join(' ')
  return {
    ...emptyBuilderDraft,
    name: `${headline.charAt(0).toUpperCase()}${headline.slice(1)} agent`.slice(0, 120),
    description: trimmed.slice(0, 1000),
    systemPrompt: `You are a managed agent.\nGoal: ${trimmed}\nWork in small verifiable steps and report what you did.`,
    allowedTools: DEFAULT_ALLOWED_TOOLS,
  }
}

export type BuilderFieldErrors = Partial<Record<keyof AgentBuilderDraft, string>>

export function coreStepErrors(draft: AgentBuilderDraft): BuilderFieldErrors {
  const errors: BuilderFieldErrors = {}
  if (!draft.name.trim()) errors.name = 'Name is required.'
  else if (draft.name.trim().length > 120) errors.name = 'Name must be 120 characters or fewer.'
  if (!draft.systemPrompt.trim()) errors.systemPrompt = 'System prompt is required.'
  if (!draft.provider.trim()) errors.provider = 'Provider is required.'
  return errors
}

export function builderClientErrors(draft: AgentBuilderDraft): BuilderFieldErrors {
  return coreStepErrors(draft)
}

export function stepErrors(step: BuilderStep, draft: AgentBuilderDraft): BuilderFieldErrors {
  if (step === 'core') return coreStepErrors(draft)
  return {}
}

export function toAgentInput(draft: AgentBuilderDraft): AgentInput {
  const description = draft.description.trim()
  return {
    metadata: {
      name: draft.name.trim(),
      ...(description ? { description } : {}),
    },
    spec: {
      systemPrompt: draft.systemPrompt.trim(),
      ...providerPatch(draft.provider),
      model: draft.model.trim() || null,
      skills: draft.sandboxEnabled ? parseTools(draft.skills) : [],
      allowedTools: parseTools(draft.allowedTools),
      mcpConnectors: draft.mcpConnectors,
      subagents: [],
    },
  }
}

const SERVER_FIELD_MAP: Record<string, { field: keyof AgentBuilderDraft; step: BuilderStep }> = {
  name: { field: 'name', step: 'core' },
  description: { field: 'description', step: 'core' },
  systemPrompt: { field: 'systemPrompt', step: 'core' },
  provider: { field: 'provider', step: 'core' },
  model: { field: 'model', step: 'core' },
  allowedTools: { field: 'allowedTools', step: 'tools' },
  mcpConnectors: { field: 'mcpConnectors', step: 'tools' },
  skills: { field: 'skills', step: 'sandbox' },
}

export function apiErrorToBuilder(error: unknown): { errors: BuilderFieldErrors; step: BuilderStep | null } {
  if (!(error instanceof ApiError) || !error.details || typeof error.details !== 'object') {
    return { errors: {}, step: null }
  }
  const body = error.details as { error?: { details?: { fields?: Record<string, unknown> } } }
  const fields = body.error?.details?.fields
  if (!fields || typeof fields !== 'object') {
    return { errors: {}, step: null }
  }
  const errors: BuilderFieldErrors = {}
  const steps = new Set<BuilderStep>()
  for (const [serverField, message] of Object.entries(fields)) {
    const mapped = SERVER_FIELD_MAP[serverField]
    if (mapped && typeof message === 'string') {
      errors[mapped.field] = message
      steps.add(mapped.step)
    }
  }
  return { errors, step: BUILDER_STEPS.find((step) => steps.has(step)) ?? null }
}

export function agentApiExamples(origin: string, agent: Agent) {
  const body = JSON.stringify({
    metadata: {
      name: agent.metadata.name,
      ...(agent.metadata.description ? { description: agent.metadata.description } : {}),
    },
    spec: {
      ...(agent.spec.systemPrompt ? { systemPrompt: agent.spec.systemPrompt } : {}),
      provider: agent.spec.provider,
      model: agent.spec.model,
      skills: agent.spec.skills,
      allowedTools: agent.spec.allowedTools,
      mcpConnectors: agent.spec.mcpConnectors,
      subagents: agent.spec.subagents,
    },
  })
  const curl = [
    `curl -X POST "${origin}/api/v1/agents" \\`,
    '  -H "Authorization: Bearer $AMA_ACCESS_TOKEN" \\',
    '  -H "Content-Type: application/json" \\',
    `  -d '${body}'`,
  ].join('\n')
  const restish = [
    `printf '%s\\n' '${body}' | restish post ${origin}/api/v1/agents -H "Authorization: Bearer $AMA_ACCESS_TOKEN"`,
    `restish get ${origin}/api/v1/agents/${agent.metadata.uid} -H "Authorization: Bearer $AMA_ACCESS_TOKEN"`,
  ].join('\n')
  return { curl, restish }
}
