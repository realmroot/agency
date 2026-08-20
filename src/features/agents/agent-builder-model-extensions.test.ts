import { describe, expect, it } from 'vitest'
import { ApiError } from '@/lib/amarpc'
import { agent as resourceAgent } from '@/test/resource-fixtures'
import {
  agentApiExamples,
  apiErrorToBuilder,
  BUILDER_STEPS,
  emptyBuilderDraft,
  stepErrors,
  toAgentInput,
} from './agent-builder-model'

describe('agent builder model extensions', () => {
  it('does not include the removed roles step', () => {
    expect(BUILDER_STEPS).toEqual(['start', 'core', 'tools', 'sandbox', 'test', 'done'])
    expect(stepErrors('tools', emptyBuilderDraft)).toEqual({})
  })

  it('keeps omitted allowed tools as an empty request array from the draft', () => {
    expect(toAgentInput({ ...emptyBuilderDraft, name: 'A', systemPrompt: 'B' }).spec.allowedTools).toEqual([])
  })

  it('keeps explicit allowed tools as strings', () => {
    expect(
      toAgentInput({ ...emptyBuilderDraft, name: 'A', systemPrompt: 'B', allowedTools: 'read\nbash' }).spec,
    ).toMatchObject({
      allowedTools: ['read', 'bash'],
    })
  })

  it('maps server fields to the right builder step', () => {
    const error = new ApiError('Bad request', 400, { error: { details: { fields: { allowedTools: 'Nope' } } } })
    expect(apiErrorToBuilder(error)).toEqual({ errors: { allowedTools: 'Nope' }, step: 'tools' })
  })

  it('omits description when absent in API examples', () => {
    const examples = agentApiExamples(resourceAgent({ description: null }))
    expect(examples.realmroot).not.toContain('"description"')
  })
})
