import { describe, expect, it } from 'vitest'
import { creationFingerprint } from './creation-idempotency'

describe('creationFingerprint', () => {
  it('is stable when Environment variables are declared in a different key order', async () => {
    const first = {
      name: 'Build environment',
      description: null,
      config: {
        variables: {
          NODE_ENV: { description: 'Runtime mode', required: true },
          LOG_LEVEL: { description: 'Logging level', required: false },
        },
      },
    }
    const reordered = {
      config: {
        variables: {
          LOG_LEVEL: { required: false, description: 'Logging level' },
          NODE_ENV: { required: true, description: 'Runtime mode' },
        },
      },
      description: null,
      name: 'Build environment',
    }

    await expect(creationFingerprint(first)).resolves.toBe(await creationFingerprint(reordered))
  })

  it('is stable for locale-sensitive non-ASCII keys inserted in a different order', async () => {
    const first = {
      variables: {
        ä: { description: 'Umlaut variable' },
        z: { description: 'ASCII variable' },
      },
    }
    const reordered = {
      variables: {
        z: { description: 'ASCII variable' },
        ä: { description: 'Umlaut variable' },
      },
    }

    await expect(creationFingerprint(first)).resolves.toBe(await creationFingerprint(reordered))
  })

  it('canonicalizes objects nested in arrays without changing array order', async () => {
    const first = [
      { z: 1, a: 2 },
      { second: true, first: false },
    ]
    const reorderedKeys = [
      { a: 2, z: 1 },
      { first: false, second: true },
    ]
    const reorderedValues = [
      { first: false, second: true },
      { a: 2, z: 1 },
    ]

    const fingerprint = await creationFingerprint(first)
    expect(await creationFingerprint(reorderedKeys)).toBe(fingerprint)
    expect(await creationFingerprint(reorderedValues)).not.toBe(fingerprint)
  })
})
