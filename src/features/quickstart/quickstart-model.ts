import { AMA_SANDBOX_TOOL_NAMES } from '@ama/runtime-contracts/agent-tools'
import { isArchived } from '@/console/format'
import type { Agent, AgentInput, Environment, EnvironmentInput, Provider, Session } from '@/lib/amarpc'

export const QUICKSTART_STEPS = ['provider', 'environment', 'agent', 'session', 'integration'] as const
export type QuickstartStep = (typeof QUICKSTART_STEPS)[number]

export const QUICKSTART_STEP_TITLES: Record<QuickstartStep, string> = {
  provider: 'Provider',
  environment: 'Environment',
  agent: 'Agent',
  session: 'Session',
  integration: 'Integration',
}

export const QUICKSTART_STEP_CALLS: Record<QuickstartStep, string> = {
  provider: 'GET /api/v1/providers',
  environment: 'POST /api/v1/environments',
  agent: 'POST /api/v1/agents',
  session: 'POST /api/v1/sessions',
  integration: 'GET /api/v1/openapi.json',
}

// Keep this prompt free of runtime trigger words such as "command", "status",
// or "inspect": it must stay a safe, read-only first task in every runtime.
export const SAFE_EXAMPLE_PROMPT =
  'Introduce yourself and confirm this session is ready. Stay read-only and do not modify the workspace.'

export interface QuickstartResources {
  providers: Provider[]
  environments: Environment[]
  agents: Agent[]
  sessions: Session[]
}

export type QuickstartCompletion = Record<QuickstartStep, boolean>

export function quickstartCompletion(resources: QuickstartResources): QuickstartCompletion {
  return {
    provider: resources.providers.some((provider) => provider.enabled),
    environment: resources.environments.some((environment) => !isArchived(environment)),
    agent: resources.agents.some((agent) => !isArchived(agent)),
    session: resources.sessions.length > 0,
    integration: resources.sessions.some(
      (session) => session.status.phase === 'idle' || session.status.phase === 'running',
    ),
  }
}

export function firstIncompleteStep(completion: QuickstartCompletion): QuickstartStep {
  return QUICKSTART_STEPS.find((step) => !completion[step]) ?? 'integration'
}

// Completed steps stay revisitable; the only reachable incomplete step is the
// next one in sequence, so the guided flow cannot skip prerequisites.
export function isStepUnlocked(step: QuickstartStep, completion: QuickstartCompletion) {
  return completion[step] || step === firstIncompleteStep(completion)
}

export function resolveQuickstartStep(requested: string | null, completion: QuickstartCompletion): QuickstartStep {
  const candidate = QUICKSTART_STEPS.find((step) => step === requested)
  if (candidate && isStepUnlocked(candidate, completion)) {
    return candidate
  }
  return firstIncompleteStep(completion)
}

// ─── Environment step ───

export interface QuickstartEnvironmentForm {
  name: string
  networkChoice: 'unrestricted' | 'restricted'
  allowedHosts: string
  mcpAccess: boolean
  packageManagerAccess: boolean
}

export const defaultQuickstartEnvironmentForm: QuickstartEnvironmentForm = {
  name: 'Quickstart environment',
  networkChoice: 'unrestricted',
  allowedHosts: 'registry.npmjs.org',
  mcpAccess: true,
  packageManagerAccess: true,
}

export function quickstartEnvironmentInput(form: QuickstartEnvironmentForm): EnvironmentInput {
  const base: EnvironmentInput = {
    metadata: {
      name: form.name.trim(),
      description: 'Reusable sandbox template created in quickstart.',
    },
    spec: {
      type: 'cloud',
      packages: { type: 'packages', apt: [], cargo: [], gem: [], go: [], npm: [], pip: [] },
    },
  }
  if (form.networkChoice === 'unrestricted') {
    return {
      ...base,
      spec: {
        ...base.spec,
        networking: {
          type: 'open',
          allowMcpServers: form.mcpAccess,
          allowPackageManagers: form.packageManagerAccess,
        },
      },
    }
  }
  return {
    ...base,
    spec: {
      ...base.spec,
      networking: {
        type: 'limited',
        allowMcpServers: form.mcpAccess,
        allowPackageManagers: form.packageManagerAccess,
        allowedHosts: form.allowedHosts
          .split(/\r?\n/)
          .map((host) => host.trim())
          .filter(Boolean),
      },
    },
  }
}

// ─── Sandbox add-on ───

export const SANDBOX_TOOLS = AMA_SANDBOX_TOOL_NAMES
export const DEFAULT_SANDBOX_SKILL = 'ama@coding-agent'

export function agentHasSandboxExecution(agent: Agent) {
  return agent.spec.allowedTools.includes('bash')
}

export function sandboxAgentInput(agent: Agent): Partial<AgentInput> {
  const existing = agent.spec.allowedTools
  const merged = [...new Set([...existing, ...SANDBOX_TOOLS])]
  return {
    spec: {
      systemPrompt: agent.spec.systemPrompt,
      allowedTools: merged,
      skills: agent.spec.skills.length > 0 ? agent.spec.skills : [DEFAULT_SANDBOX_SKILL],
    },
  }
}

// ─── Integration step ───

export interface QuickstartIntegrationInput {
  agentId: string
  environmentId: string | null
  sessionId: string
}

export function quickstartIntegrationExamples(input: QuickstartIntegrationInput) {
  const sessionBody = JSON.stringify({
    spec: {
      agentId: input.agentId,
      environmentId: input.environmentId,
      runtime: 'ama',
    },
    prompt: SAFE_EXAMPLE_PROMPT,
  })
  const realmroot = [
    'realmroot toolbox sync any-managed-agents',
    `realmroot toolbox post any-managed-agents/api/v1/sessions '${sessionBody}' --scope sessions:write`,
    `realmroot toolbox get any-managed-agents/api/v1/sessions/${input.sessionId} --scope sessions:read`,
    `realmroot toolbox get any-managed-agents/api/v1/sessions/${input.sessionId}/events --scope sessions:read`,
  ].join('\n')
  return { realmroot }
}
