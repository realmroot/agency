import { describe, expect, it } from 'vitest'
import { agent as resourceAgent } from '@/test/resource-fixtures'
import {
  agentApiExamples,
  apiErrorToBuilder,
  builderClientErrors,
  coreStepErrors,
  draftFromGoal,
  emptyBuilderDraft,
  stepErrors,
  toAgentInput,
} from './agent-builder-model'

const validDraft = {
  ...emptyBuilderDraft,
  name: 'Reviewer',
  systemPrompt: 'Review changes carefully.',
  model: 'gpt-4',
  provider: 'workers-ai',
}

describe('agent builder model', () => {
  it('creates a draft from a goal', () => {
    const draft = draftFromGoal('Review incoming pull requests')
    expect(draft.name).toContain('Review incoming pull requests')
    expect(draft.systemPrompt).toContain('Review incoming pull requests')
    expect(draft.allowedTools).toBe('read\nbash\nedit\nwrite\ngrep\nfind\nls\nfetch\nweb_search')
  })

  it('validates core required fields', () => {
    expect(coreStepErrors(emptyBuilderDraft)).toMatchObject({
      name: expect.any(String),
      systemPrompt: expect.any(String),
    })
    expect(builderClientErrors(validDraft)).toEqual({})
    expect(stepErrors('core', emptyBuilderDraft)).toHaveProperty('name')
  })

  it('builds an agent input with allowed tools and subagents', () => {
    const input = toAgentInput({
      ...validDraft,
      description: 'Reviews code.',
      allowedTools: 'read\nbash',
      skills: 'ama@code-review',
      sandboxEnabled: true,
      mcpConnectors: ['github'],
    })
    expect(input).toMatchObject({
      metadata: { name: 'Reviewer', description: 'Reviews code.' },
      spec: {
        systemPrompt: 'Review changes carefully.',
        model: 'gpt-4',
        skills: ['ama@code-review'],
        allowedTools: ['read', 'bash'],
        subagents: [],
        mcpConnectors: ['github'],
      },
    })
    expect(input.spec).not.toHaveProperty('provider')
  })

  it('keeps an unselected model null', () => {
    expect(toAgentInput({ ...validDraft, model: '' }).spec.model).toBeNull()
  })

  it('maps API validation errors to builder fields', () => {
    const error = {
      details: {
        error: {
          details: { fields: { allowedTools: 'Unsupported tool', name: 'Name is required.' } },
        },
      },
    }
    Object.setPrototypeOf(error, Error.prototype)
    expect(apiErrorToBuilder(error)).toEqual({ errors: {}, step: null })
  })

  it('renders API examples with allowed tools [spec: agents/builder-examples]', () => {
    const examples = agentApiExamples(resourceAgent({ systemPrompt: 'Do the work', allowedTools: ['read'] }))
    expect(examples.realmroot).toContain('"allowedTools":["read"]')
    expect(examples.realmroot).toContain('--scope agents:write')
  })
})
