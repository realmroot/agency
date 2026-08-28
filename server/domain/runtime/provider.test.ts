import { describe, expect, it } from 'vitest'
import { PLATFORM_DEFAULT_MODEL, resolveAgentExecutionProfile } from './provider'

describe('[spec: agents/create] resolveAgentExecutionProfile', () => {
  it('resolves an unpinned AMA Agent to the platform model and its vendor', () => {
    expect(resolveAgentExecutionProfile('ama', null, null)).toEqual({
      provider: 'moonshotai',
      model: PLATFORM_DEFAULT_MODEL,
      policyManaged: true,
    })
  })

  it.each([
    ['claude-code', 'anthropic'],
    ['codex', 'openai'],
    ['copilot', 'github-copilot'],
  ] as const)('resolves an unpinned %s Agent to its host execution provider', (runtime, provider) => {
    expect(resolveAgentExecutionProfile(runtime, null, null)).toEqual({
      provider,
      model: null,
      policyManaged: false,
    })
  })

  it('treats the legacy workers-ai alias as unpinned for a self-hosted Codex Agent', () => {
    expect(resolveAgentExecutionProfile('codex', 'workers-ai', null)).toEqual({
      provider: 'openai',
      model: null,
      policyManaged: false,
    })
  })

  it.each([
    [null, PLATFORM_DEFAULT_MODEL, 'moonshotai'],
    ['@cf/openai/gpt-oss-120b', '@cf/openai/gpt-oss-120b', 'openai'],
  ] as const)('treats the legacy workers-ai transport alias as the vendor derived from model %s', (configuredModel, expectedModel, provider) => {
    expect(resolveAgentExecutionProfile('ama', 'workers-ai', configuredModel)).toEqual({
      provider,
      model: expectedModel,
      policyManaged: true,
    })
  })

  it.each([
    'ama',
    'claude-code',
    'codex',
    'copilot',
  ] as const)('keeps an explicitly configured %s provider under platform policy', (runtime) => {
    expect(resolveAgentExecutionProfile(runtime, 'configured-provider', 'configured-model')).toEqual({
      provider: 'configured-provider',
      model: 'configured-model',
      policyManaged: true,
    })
  })
})
