import { describe, expect, it } from 'vitest'
import { amaMemoryRef, memoryStoreIdFromRef, memoryStoreMountPath, normalizeMemoryPath } from './memory-store'

describe('[spec: sessions/memory-store-resources] memory store domain helpers', () => {
  it('builds managed mount paths under the AMA memory root', () => {
    expect(memoryStoreMountPath('memstore_1')).toBe('/workspace/.ama/memory-stores/memstore_1')
  })

  it('round-trips AMA memory references', () => {
    expect(amaMemoryRef('memstore_1')).toBe('ama://memories/memstore_1')
    expect(memoryStoreIdFromRef('ama://memories/memstore_1')).toBe('memstore_1')
    expect(memoryStoreIdFromRef('ama://vaults/memstore_1')).toBeNull()
    expect(memoryStoreIdFromRef('ama://memories/memstore_1/extra')).toBeNull()
  })

  it('normalizes clean relative memory paths', () => {
    expect(normalizeMemoryPath(' guides/review-notes.md ')).toBe('guides/review-notes.md')
  })

  it('rejects unsafe memory paths', () => {
    expect(() => normalizeMemoryPath('')).toThrow('Memory path is required.')
    expect(() => normalizeMemoryPath('/absolute.md')).toThrow('Memory path must be relative.')
    expect(() => normalizeMemoryPath('guides/../secret.md')).toThrow('clean relative segments')
    expect(() => normalizeMemoryPath('.ama/system.md')).toThrow('clean relative segments')
    expect(() => normalizeMemoryPath('bad path.md')).toThrow('letters, numbers, dots, underscores, and hyphens')
    expect(() => normalizeMemoryPath('bad\\path.md')).toThrow('invalid characters')
  })
})
