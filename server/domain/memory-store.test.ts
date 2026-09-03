import { describe, expect, it } from 'vitest'
import { enborMemoryRef, memoryStoreIdFromRef, memoryStoreMountPath, normalizeMemoryPath } from './memory-store'

describe('[spec: sessions/memory-store-resources] memory store domain helpers', () => {
  it('builds managed mount paths under the Enbor memory root', () => {
    expect(memoryStoreMountPath('memstore_1')).toBe('/workspace/.enbor/memory-stores/memstore_1')
  })

  it('round-trips Enbor memory references', () => {
    expect(enborMemoryRef('memstore_1')).toBe('enbor://memories/memstore_1')
    expect(memoryStoreIdFromRef('enbor://memories/memstore_1')).toBe('memstore_1')
    expect(memoryStoreIdFromRef('enbor://vaults/memstore_1')).toBeNull()
    expect(memoryStoreIdFromRef('enbor://memories/memstore_1/extra')).toBeNull()
  })

  it('normalizes clean relative memory paths', () => {
    expect(normalizeMemoryPath(' guides/review-notes.md ')).toBe('guides/review-notes.md')
  })

  it('rejects unsafe memory paths', () => {
    expect(() => normalizeMemoryPath('')).toThrow('Memory path is required.')
    expect(() => normalizeMemoryPath('/absolute.md')).toThrow('Memory path must be relative.')
    expect(() => normalizeMemoryPath('guides/../secret.md')).toThrow('clean relative segments')
    expect(() => normalizeMemoryPath('.enbor/system.md')).toThrow('clean relative segments')
    expect(() => normalizeMemoryPath('bad path.md')).toThrow('letters, numbers, dots, underscores, and hyphens')
    expect(() => normalizeMemoryPath('bad\\path.md')).toThrow('invalid characters')
  })
})
