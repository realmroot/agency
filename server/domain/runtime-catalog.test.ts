import { describe, expect, it } from 'vitest'
import {
  RUNTIME_CATALOG,
  RUNTIME_PROVIDER_MODEL_CAPABILITY_PREFIX,
  runnerSupportsRuntimeProviderModel,
  runtimeCatalogSupportsProviderModel,
  runtimeProviderModelCapability,
  runtimeRequiredRunnerCapability,
  runtimeSupportsHostingMode,
  runtimeSupportsLivePrompts,
  transitionalRuntimeLevelRuntimes,
} from './runtime-catalog'

describe('runtimeSupportsLivePrompts', () => {
  it('returns true for all runtimes with bridge-level prompt injection', () => {
    expect(runtimeSupportsLivePrompts('ama')).toBe(true)
    expect(runtimeSupportsLivePrompts('claude-code')).toBe(true)
    expect(runtimeSupportsLivePrompts('copilot')).toBe(true)
    expect(runtimeSupportsLivePrompts('codex')).toBe(true)
  })
})

describe('runtimeProviderModelCapability', () => {
  it('constructs a capability string from runtime, provider, and model', () => {
    expect(runtimeProviderModelCapability('ama', 'workers-ai', '@cf/moonshotai/kimi-k2.6')).toBe(
      `${RUNTIME_PROVIDER_MODEL_CAPABILITY_PREFIX}:ama:workers-ai:@cf/moonshotai/kimi-k2.6`,
    )
  })

  it('constructs a wildcard capability for self-hosted runtimes', () => {
    expect(runtimeProviderModelCapability('claude-code', '*', '*')).toBe(
      `${RUNTIME_PROVIDER_MODEL_CAPABILITY_PREFIX}:claude-code:*:*`,
    )
  })
})

describe('runtimeRequiredRunnerCapability', () => {
  it('requires the ama runtime capability regardless of model', () => {
    expect(runtimeRequiredRunnerCapability('ama', 'workers-ai', null)).toBe('ama')
    expect(runtimeRequiredRunnerCapability('ama', 'workers-ai', undefined)).toBe('ama')
    expect(runtimeRequiredRunnerCapability('ama', 'moonshotai', '@cf/moonshotai/kimi-k2.6')).toBe('ama')
  })

  it('requires the bare runtime capability for non-ama runtimes when no model is pinned', () => {
    expect(runtimeRequiredRunnerCapability('codex', 'openai', null)).toBe('codex')
    expect(runtimeRequiredRunnerCapability('copilot', 'github')).toBe('copilot')
  })

  it('normalizes provider to wildcard for wildcard-provider catalog entries', () => {
    // claude-code has providerModels with provider: '*', so capability uses '*' as provider
    expect(runtimeRequiredRunnerCapability('claude-code', 'anthropic', 'claude-opus-4')).toBe(
      runtimeProviderModelCapability('claude-code', '*', 'claude-opus-4'),
    )
  })

  it('normalizes provider to wildcard for wildcard-model catalog entries', () => {
    // codex and copilot also have provider:'*' and model:'*'
    expect(runtimeRequiredRunnerCapability('codex', 'openai', 'gpt-4o')).toBe(
      runtimeProviderModelCapability('codex', '*', 'gpt-4o'),
    )
  })

  it('uses the concrete provider when no catalog entry matches', () => {
    // @ts-expect-error testing unknown runtime
    expect(runtimeRequiredRunnerCapability('unknown-runtime', 'some-provider', 'some-model')).toBe(
      `${RUNTIME_PROVIDER_MODEL_CAPABILITY_PREFIX}:unknown-runtime:some-provider:some-model`,
    )
  })
})

describe('transitionalRuntimeLevelRuntimes', () => {
  it('returns all runtimes whose catalog entry uses a wildcard model', () => {
    const names = transitionalRuntimeLevelRuntimes()
    // Every runtime now declares a wildcard model (ama validates against the
    // global catalog instead of a pinned list), so all of them appear.
    expect(names).toContain('ama')
    expect(names).toContain('claude-code')
    expect(names).toContain('codex')
    expect(names).toContain('copilot')
  })
})

describe('runnerSupportsRuntimeProviderModel', () => {
  const CLAUDE_CAP = runtimeProviderModelCapability('claude-code', '*', 'claude-opus-4')
  const AMA_CAP = runtimeProviderModelCapability('ama', 'workers-ai', '@cf/moonshotai/kimi-k2.6')

  it('returns true when no model given and runner declares the bare runtime name', () => {
    expect(runnerSupportsRuntimeProviderModel(['claude-code'], 'claude-code', 'anthropic')).toBe(true)
  })

  it('returns true when no model given and runner declares a matching runtime-provider-model capability', () => {
    expect(runnerSupportsRuntimeProviderModel([CLAUDE_CAP], 'claude-code', 'anthropic')).toBe(true)
  })

  it('returns false when no model given and runner has no matching capability', () => {
    expect(runnerSupportsRuntimeProviderModel([AMA_CAP], 'claude-code', 'anthropic')).toBe(false)
  })

  it('returns true when runner capabilities include the exact model capability', () => {
    expect(runnerSupportsRuntimeProviderModel([CLAUDE_CAP], 'claude-code', '*', 'claude-opus-4')).toBe(true)
  })

  it('returns true when runner capabilities include a wildcard-provider model capability', () => {
    const wildcard = runtimeProviderModelCapability('claude-code', '*', 'claude-opus-4')
    expect(runnerSupportsRuntimeProviderModel([wildcard], 'claude-code', 'anthropic', 'claude-opus-4')).toBe(true)
  })

  it('uses transitional bare-runtime fallback for wildcard-model runtimes', () => {
    // claude-code is a wildcard-model runtime, so bare capability counts
    expect(runnerSupportsRuntimeProviderModel(['claude-code'], 'claude-code', 'anthropic', 'claude-opus-4')).toBe(true)
  })

  it('requires the ama runtime capability for ama', () => {
    expect(runnerSupportsRuntimeProviderModel(['ama'], 'ama', 'workers-ai', '@cf/moonshotai/kimi-k2.6')).toBe(true)
    expect(runnerSupportsRuntimeProviderModel(['codex'], 'ama', 'workers-ai', '@cf/moonshotai/kimi-k2.6')).toBe(false)
  })

  it('returns false when model is given but runner has no matching capability', () => {
    expect(runnerSupportsRuntimeProviderModel([AMA_CAP], 'claude-code', 'anthropic', 'claude-opus-4')).toBe(false)
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
