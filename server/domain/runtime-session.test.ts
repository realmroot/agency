import { describe, expect, it } from 'vitest'
import { environmentHostingMode, sessionRuntimeConfig, sessionRuntimeFromMetadata } from './runtime-session'

describe('runtime-session domain rules [spec: sessions/runtime-metadata]', () => {
  it('reads the runtime from session metadata', () => {
    expect(sessionRuntimeFromMetadata({ runtime: 'enbor' })).toBe('enbor')
    expect(sessionRuntimeFromMetadata({ runtime: 'claude-code' })).toBe('claude-code')
  })

  it('throws when the runtime metadata is missing or not a string', () => {
    expect(() => sessionRuntimeFromMetadata({})).toThrow('Session runtime metadata is required')
    expect(() => sessionRuntimeFromMetadata({ runtime: 42 })).toThrow('Session runtime metadata is required')
  })

  it('returns the runtime config object, defaulting to empty', () => {
    expect(sessionRuntimeConfig({ runtimeConfig: { image: 'x' } })).toEqual({ image: 'x' })
    expect(sessionRuntimeConfig({})).toEqual({})
    expect(sessionRuntimeConfig({ runtimeConfig: 'not-an-object' })).toEqual({})
    expect(sessionRuntimeConfig({ runtimeConfig: ['array'] })).toEqual({})
  })

  it('derives the hosting mode from the environment snapshot', () => {
    expect(environmentHostingMode({ type: 'self_hosted' })).toBe('self_hosted')
    expect(environmentHostingMode({ type: 'cloud' })).toBe('cloud')
    expect(environmentHostingMode({})).toBe('cloud')
    expect(environmentHostingMode(null)).toBe('cloud')
  })
})
