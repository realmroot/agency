import { describe, expect, it } from 'vitest'
import {
  RUNTIME_CATALOG,
  type RuntimeSupport,
  runtimeCatalogSupportsProviderModel,
  runtimeRequirement,
  runtimeSupportsHostingMode,
  runtimeSupportsLivePrompts,
  runtimesSupport,
} from './runtime-catalog'

describe('runtimeSupportsLivePrompts', () => {
  it('returns true for all runtimes with bridge-level prompt injection', () => {
    expect(runtimeSupportsLivePrompts('ama')).toBe(true)
    expect(runtimeSupportsLivePrompts('claude-code')).toBe(true)
    expect(runtimeSupportsLivePrompts('copilot')).toBe(true)
    expect(runtimeSupportsLivePrompts('codex')).toBe(true)
  })
})

describe('runtimeRequirement', () => {
  it('keeps an explicit CLI runtime model as structured data', () => {
    expect(runtimeRequirement('copilot', 'gpt-4.1')).toEqual({ runtime: 'copilot', model: 'gpt-4.1' })
  })

  it('does not invent a model when none is selected', () => {
    expect(runtimeRequirement('copilot', null)).toEqual({ runtime: 'copilot' })
  })

  it('leaves AMA model routing to the control plane catalog', () => {
    expect(runtimeRequirement('ama', '@cf/moonshotai/kimi-k2.6')).toEqual({ runtime: 'ama' })
  })
})

describe('runtimesSupport', () => {
  const runtimes = [{ runtime: 'copilot', state: 'ready', models: ['auto', 'gpt-4.1'] }] satisfies RuntimeSupport

  it('matches a ready runtime and exact selected model', () => {
    expect(runtimesSupport(runtimes, 'copilot', 'gpt-4.1')).toBe(true)
    expect(runtimesSupport(runtimes, 'copilot', 'unsupported-model')).toBe(false)
  })

  it('requires only the ready runtime when model is null', () => {
    expect(runtimesSupport(runtimes, 'copilot', null)).toBe(true)
  })
})

describe('runtimeCatalogSupportsProviderModel', () => {
  it('returns false when the runtime does not support the requested hosting mode', () => {
    // claude-code only supports self_hosted, not cloud
    expect(runtimeCatalogSupportsProviderModel('cloud', 'claude-code', 'anthropic', 'claude-opus-4')).toBe(false)
  })

  it('accepts any provider/model on ama cloud (catalog is wildcard; the global catalog validates)', () => {
    // ama no longer pins models here — the loose catalog filter accepts anything,
    // and provisioning validates cloud provider/model against the global catalog.
    expect(runtimeCatalogSupportsProviderModel('cloud', 'ama', 'workers-ai', '@cf/moonshotai/kimi-k2.6')).toBe(true)
    expect(runtimeCatalogSupportsProviderModel('cloud', 'ama', 'anthropic', 'anthropic/claude-opus-4')).toBe(true)
  })

  it('returns true for any provider/model on a wildcard-model self-hosted runtime', () => {
    expect(runtimeCatalogSupportsProviderModel('self_hosted', 'claude-code', 'anthropic', 'claude-opus-4')).toBe(true)
    expect(runtimeCatalogSupportsProviderModel('self_hosted', 'codex', 'openai', 'gpt-4o')).toBe(true)
    expect(runtimeCatalogSupportsProviderModel('self_hosted', 'copilot', 'azure', 'gpt-4.1')).toBe(true)
  })

  it('accepts any provider on a wildcard runtime even when no model is given', () => {
    expect(runtimeCatalogSupportsProviderModel('cloud', 'ama', 'anthropic')).toBe(true)
    expect(runtimeCatalogSupportsProviderModel('self_hosted', 'claude-code', 'anthropic')).toBe(true)
  })

  it('returns false for an unknown runtime', () => {
    // @ts-expect-error testing unknown runtime
    expect(runtimeCatalogSupportsProviderModel('cloud', 'unknown', 'any', 'any')).toBe(false)
  })
})

describe('runtimeSupportsHostingMode', () => {
  it('returns true when the runtime supports the hosting mode', () => {
    expect(runtimeSupportsHostingMode('cloud', 'ama')).toBe(true)
    expect(runtimeSupportsHostingMode('self_hosted', 'ama')).toBe(true)
    expect(runtimeSupportsHostingMode('self_hosted', 'claude-code')).toBe(true)
  })

  it('returns false when the runtime does not support the hosting mode', () => {
    expect(runtimeSupportsHostingMode('cloud', 'claude-code')).toBe(false)
    expect(runtimeSupportsHostingMode('cloud', 'codex')).toBe(false)
    expect(runtimeSupportsHostingMode('cloud', 'copilot')).toBe(false)
  })

  it('returns false for unknown runtimes', () => {
    // @ts-expect-error testing unknown runtime
    expect(runtimeSupportsHostingMode('cloud', 'unknown')).toBe(false)
  })
})

describe('RUNTIME_CATALOG integrity', () => {
  it('contains the expected four runtimes', () => {
    const runtimes = RUNTIME_CATALOG.map((entry) => entry.runtime)
    expect(runtimes).toContain('ama')
    expect(runtimes).toContain('claude-code')
    expect(runtimes).toContain('codex')
    expect(runtimes).toContain('copilot')
  })
})
