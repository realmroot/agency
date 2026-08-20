import { describe, expect, it } from 'vitest'
import type { Provider } from '@/lib/amarpc'
import { agent as resourceAgent, environment as resourceEnvironment } from '@/test/resource-fixtures'
import { buildTestSession } from '@/testing/session'
import {
  agentHasSandboxExecution,
  defaultQuickstartEnvironmentForm,
  firstIncompleteStep,
  isStepUnlocked,
  quickstartCompletion,
  quickstartEnvironmentInput,
  quickstartIntegrationExamples,
  resolveQuickstartStep,
  sandboxAgentInput,
} from './quickstart-model'

const activeProvider = { enabled: true } as Provider
const activeEnvironment = resourceEnvironment()
const activeAgent = resourceAgent()
const cloudSession = buildTestSession({ phase: 'idle' })

const emptyResources = { providers: [], environments: [], agents: [], sessions: [] }

describe('quickstart step sequencing [spec: quickstart/step-sequencing]', () => {
  it('detects completion from real resource state', () => {
    expect(quickstartCompletion(emptyResources)).toEqual({
      provider: false,
      environment: false,
      agent: false,
      session: false,
      integration: false,
    })
    expect(
      quickstartCompletion({
        providers: [activeProvider],
        environments: [activeEnvironment],
        agents: [activeAgent],
        sessions: [cloudSession],
      }),
    ).toEqual({ provider: true, environment: true, agent: true, session: true, integration: true })
  })

  it('unlocks completed steps and the next incomplete step only', () => {
    const completion = quickstartCompletion({
      providers: [activeProvider],
      environments: [],
      agents: [activeAgent],
      sessions: [],
    })
    expect(firstIncompleteStep(completion)).toBe('environment')
    expect(isStepUnlocked('provider', completion)).toBe(true)
    expect(isStepUnlocked('environment', completion)).toBe(true)
    expect(isStepUnlocked('agent', completion)).toBe(true)
    expect(isStepUnlocked('session', completion)).toBe(false)
    expect(isStepUnlocked('integration', completion)).toBe(false)
  })

  it('resolves the requested step only when it is unlocked', () => {
    const completion = quickstartCompletion({ providers: [activeProvider], environments: [], agents: [], sessions: [] })
    expect(resolveQuickstartStep(null, completion)).toBe('environment')
    expect(resolveQuickstartStep('provider', completion)).toBe('provider')
    expect(resolveQuickstartStep('session', completion)).toBe('environment')
    expect(resolveQuickstartStep('nonsense', completion)).toBe('environment')
  })
})

describe('quickstart step sequencing — all-complete fallback [spec: quickstart/step-sequencing]', () => {
  it('returns integration when all steps are complete (firstIncompleteStep fallback)', () => {
    const completion = quickstartCompletion({
      providers: [{ enabled: true } as import('@/lib/amarpc').Provider],
      environments: [resourceEnvironment()],
      agents: [resourceAgent()],
      sessions: [buildTestSession({ phase: 'idle' })],
    })
    expect(firstIncompleteStep(completion)).toBe('integration')
    // resolveQuickstartStep with null falls to firstIncompleteStep → 'integration'
    expect(resolveQuickstartStep(null, completion)).toBe('integration')
  })
})

describe('quickstart environment input [spec: quickstart/environment-input]', () => {
  it('creates an unrestricted cloud environment', () => {
    expect(quickstartEnvironmentInput({ ...defaultQuickstartEnvironmentForm, name: ' Env ' })).toMatchObject({
      metadata: { name: 'Env' },
      spec: {
        type: 'cloud',
        networking: { type: 'open', allowMcpServers: true, allowPackageManagers: true },
        packages: { type: 'packages', apt: [], cargo: [], gem: [], go: [], npm: [], pip: [] },
      },
    })
  })

  it('blocks package-manager registry access when packageManagerAccess is false', () => {
    const input = quickstartEnvironmentInput({
      name: 'Blocked env',
      networkChoice: 'restricted',
      allowedHosts: '',
      mcpAccess: true,
      packageManagerAccess: false,
    })
    expect(input.spec.networking).toEqual({
      type: 'limited',
      allowMcpServers: true,
      allowPackageManagers: false,
      allowedHosts: [],
    })
  })

  it('captures allowed hosts, MCP access, and package-manager access for limited networking', () => {
    const input = quickstartEnvironmentInput({
      name: 'Limited env',
      networkChoice: 'restricted',
      allowedHosts: 'registry.npmjs.org\n  api.github.com  \n',
      mcpAccess: false,
      packageManagerAccess: true,
    })
    expect(input.spec.networking).toEqual({
      type: 'limited',
      allowMcpServers: false,
      allowPackageManagers: true,
      allowedHosts: ['registry.npmjs.org', 'api.github.com'],
    })
  })
})

describe('quickstart sandbox add-on [spec: quickstart/sandbox-addon]', () => {
  it('adds sandbox tools and carries skills consistent with the agent schema', () => {
    const agent = resourceAgent({
      allowedTools: ['read', 'bash'],
      skills: [],
    })
    expect(agentHasSandboxExecution(agent)).toBe(true)
    expect(
      agentHasSandboxExecution(
        resourceAgent({
          allowedTools: ['read'],
          skills: [],
        }),
      ),
    ).toBe(false)
    expect(sandboxAgentInput(agent)).toEqual({
      spec: {
        systemPrompt: 'Do the work',
        allowedTools: ['read', 'bash', 'edit', 'write', 'grep', 'find', 'ls', 'fetch', 'web_search'],
        skills: ['ama@coding-agent'],
      },
    })
    expect(sandboxAgentInput(resourceAgent({ allowedTools: [], skills: ['team@skill'] })).spec?.skills).toEqual([
      'team@skill',
    ])
  })
})

describe('quickstart integration examples [spec: quickstart/integration-examples]', () => {
  const examples = quickstartIntegrationExamples({
    agentId: 'agent_123',
    environmentId: 'env_456',
    sessionId: 'sess_789',
  })

  it('targets the Realmroot toolbox resource with the created resource ids', () => {
    expect(examples.realmroot).toContain('any-managed-agents/api/v1/sessions')
    expect(examples.realmroot).toContain('sess_789')
    expect(examples.realmroot).toContain('agent_123')
    expect(examples.realmroot).toContain('env_456')
  })

  it('requests exact scopes and never embeds tokens or vendor URLs', () => {
    expect(examples.realmroot).toContain('--scope sessions:write')
    expect(examples.realmroot).toContain('--scope sessions:read')
    expect(examples.realmroot).not.toMatch(/(?:Bearer|DPoP)\s+[A-Za-z0-9]/)
    expect(examples.realmroot).not.toMatch(/\b(?:api\.)?(?:openai|anthropic)\.com\b/)
  })

  it('includes the session events URL for history', () => {
    expect(examples.realmroot).toContain('/api/v1/sessions/sess_789/events')
    expect(examples.realmroot).not.toContain('/runtime/')
  })
})
