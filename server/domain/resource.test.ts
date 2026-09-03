import { describe, expect, it } from 'vitest'
import { resourceMetadata, resourcePhase } from './resource'

describe('resourceMetadata', () => {
  it('builds standard metadata with explicit values', () => {
    expect(
      resourceMetadata({
        uid: 'agent_1',
        pid: 'project_1',
        name: 'Coding agent',
        description: 'Runs work',
        labels: { tier: 'default' },
        annotations: { owner: 'platform' },
        createdBy: 'user_1',
        createdAt: '2026-05-23T00:00:00.000Z',
        updatedAt: '2026-05-24T00:00:00.000Z',
        deletedAt: '2026-05-25T00:00:00.000Z',
      }),
    ).toEqual({
      uid: 'agent_1',
      pid: 'project_1',
      name: 'Coding agent',
      description: 'Runs work',
      labels: { tier: 'default' },
      annotations: { owner: 'platform' },
      createdBy: 'user_1',
      createdAt: '2026-05-23T00:00:00.000Z',
      updatedAt: '2026-05-24T00:00:00.000Z',
      deletedAt: '2026-05-25T00:00:00.000Z',
    })
  })

  it('defaults nullable and map fields without changing required identity fields', () => {
    expect(
      resourceMetadata({
        uid: 'memstore_1',
        pid: null,
        name: 'Memory',
        createdAt: '2026-05-23T00:00:00.000Z',
        updatedAt: '2026-05-23T00:00:00.000Z',
      }),
    ).toEqual({
      uid: 'memstore_1',
      pid: null,
      name: 'Memory',
      description: null,
      labels: {},
      annotations: {},
      createdBy: null,
      createdAt: '2026-05-23T00:00:00.000Z',
      updatedAt: '2026-05-23T00:00:00.000Z',
      deletedAt: null,
    })
  })
})

describe('resourcePhase', () => {
  it('keeps product-visible resources active regardless of persistence metadata', () => {
    expect(resourcePhase(null)).toBe('active')
    expect(resourcePhase('2026-05-25T00:00:00.000Z')).toBe('active')
  })
})
