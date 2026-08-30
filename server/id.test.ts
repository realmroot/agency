import { describe, expect, it } from 'vitest'
import { newPrimaryKey } from './id'

const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

describe('newPrimaryKey', () => {
  it('[spec: api-contracts/resource-identifiers] generates a standard UUIDv7 without a semantic prefix', () => {
    const id = newPrimaryKey()

    expect(id).toMatch(UUID_V7)
    expect(id.split('-')).toHaveLength(5)
    expect(id).not.toMatch(/^[a-z]+_/)
  })
})
