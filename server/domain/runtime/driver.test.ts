import { describe, expect, it } from 'vitest'
import { runtimeDriver, runtimeDriverName, runtimeNameForIdentity, runtimePlacement } from './driver'

describe('[spec: runtime/driver-select] runtime drivers', () => {
  it('selects supported runtime drivers and rejects unknown names', () => {
    expect(runtimeDriver('enbor')).toMatchObject({
      runtime: 'enbor',
      cloudBackend: 'enbor-cloud',
      cloudProtocol: 'enbor-runtime-rpc',
    })
    expect(runtimeDriver('codex')).toMatchObject({
      runtime: 'codex',
      cloudBackend: null,
      cloudProtocol: null,
    })
    expect(() => runtimeDriver('unknown' as never)).toThrow('Unsupported runtime driver: unknown')
  })

  it('rejects an Identity runtime that has no registered driver', () => {
    expect(() => runtimeNameForIdentity('hermes')).toThrow(
      'Identity runtime is not supported by this Enbor deployment: hermes.',
    )
  })

  it('names cloud and self-hosted runtime drivers canonically', () => {
    expect(runtimeDriverName('enbor', 'cloud')).toBe('enbor-cloud')
    expect(runtimeDriverName('enbor', 'self_hosted')).toBe('enbor-cloud')
    expect(runtimeDriverName('claude-code', 'self_hosted')).toBe('claude-code-self-hosted')
    expect(runtimeDriverName('codex', 'self_hosted')).toBe('codex-self-hosted')
    expect(runtimeDriverName('copilot', 'self_hosted')).toBe('copilot-self-hosted')
  })

  it('builds canonical cloud runtime metadata', () => {
    expect(
      runtimePlacement({
        hostingMode: 'cloud',
        runtime: 'enbor',
        runtimeConfig: { image: 'enbor-tool-executor' },
        provider: 'workers-ai',
        model: '@cf/moonshotai/kimi-k2.6',
      }),
    ).toEqual({
      hostingMode: 'cloud',
      runtime: 'enbor',
      runtimeConfig: { image: 'enbor-tool-executor' },
      provider: 'workers-ai',
      model: '@cf/moonshotai/kimi-k2.6',
      driver: 'enbor-cloud',
      backend: 'enbor-cloud',
      protocol: 'enbor-runtime-rpc',
    })
  })

  it('builds canonical self-hosted runtime metadata from runner protocol state', () => {
    expect(
      runtimePlacement({
        hostingMode: 'self_hosted',
        runtime: 'codex',
        runtimeConfig: { mode: 'sdk-bridge' },
        provider: 'provider_codex',
        model: 'gpt-5.3-codex',
        metadata: { runnerProtocol: 'enbor-runner-work' },
      }),
    ).toEqual({
      hostingMode: 'self_hosted',
      runtime: 'codex',
      runtimeConfig: { mode: 'sdk-bridge' },
      provider: 'provider_codex',
      model: 'gpt-5.3-codex',
      driver: 'codex-self-hosted',
      backend: null,
      protocol: 'enbor-runner-work',
    })
  })

  it('preserves persisted runtime driver metadata over defaults', () => {
    expect(
      runtimePlacement({
        hostingMode: 'cloud',
        runtime: 'enbor',
        runtimeConfig: {},
        provider: 'workers-ai',
        model: '@cf/moonshotai/kimi-k2.6',
        metadata: {
          runtimeDriver: 'custom-enbor-cloud',
          runtimeBackend: 'custom-backend',
          runtimeProtocol: 'custom-protocol',
        },
      }),
    ).toMatchObject({
      driver: 'custom-enbor-cloud',
      backend: 'custom-backend',
      protocol: 'custom-protocol',
    })
  })
})
