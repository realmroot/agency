import { describe, expect, it } from 'vitest'
import {
  hasEmbeddedCredentialUrl,
  hasSecretMaterial,
  hostingModeFromSandbox,
  hostingModeFromSnapshot,
  mergeSessionUserMetadata,
  sessionAcceptsPrompts,
  sessionIsTerminal,
  sessionUserMetadata,
} from './session'

describe('[spec: sessions/state-rules] session state rules', () => {
  it('accepts prompts only while the runtime is live', () => {
    expect(sessionAcceptsPrompts('idle')).toBe(true)
    expect(sessionAcceptsPrompts('running')).toBe(true)
    expect(sessionAcceptsPrompts('pending')).toBe(false)
    expect(sessionAcceptsPrompts('closed')).toBe(false)
    expect(sessionAcceptsPrompts('error')).toBe(false)
  })

  it('marks only error as terminal', () => {
    expect(sessionIsTerminal('pending')).toBe(false)
    expect(sessionIsTerminal('running')).toBe(false)
    expect(sessionIsTerminal('closed')).toBe(false)
    expect(sessionIsTerminal('error')).toBe(true)
    expect(sessionIsTerminal('idle')).toBe(false)
  })
})

describe('hosting mode derivation', () => {
  it('derives cloud from a sandbox id and self-hosted from its absence', () => {
    expect(hostingModeFromSandbox('sandbox_1')).toBe('cloud')
    expect(hostingModeFromSandbox(null)).toBe('self_hosted')
  })

  it('derives self-hosted only for an explicit snapshot hosting mode', () => {
    expect(hostingModeFromSnapshot('self_hosted')).toBe('self_hosted')
    expect(hostingModeFromSnapshot('cloud')).toBe('cloud')
    expect(hostingModeFromSnapshot(undefined)).toBe('cloud')
  })
})

describe('[spec: sessions/workspace-safety] secret material detection', () => {
  it('flags secret-looking keys at any depth', () => {
    expect(hasSecretMaterial({ apiKey: 'x' })).toBe(true)
    expect(hasSecretMaterial({ nested: [{ password: 'x' }] })).toBe(true)
    expect(hasSecretMaterial({ plain: 'value' })).toBe(false)
    expect(hasSecretMaterial({ secretRef: 'enbor://vaults/vault_1/credentials/token/versions/ver_1' })).toBe(false)
  })

  it('flags urls carrying embedded credentials', () => {
    expect(hasEmbeddedCredentialUrl('https://user:pass@example.com')).toBe(true)
    expect(hasEmbeddedCredentialUrl('https://example.com')).toBe(false)
    expect(hasEmbeddedCredentialUrl({ url: 'https://u:p@h' })).toBe(true)
  })
})

describe('mergeSessionUserMetadata', () => {
  it('merges labels and annotations without disturbing runtime metadata', () => {
    expect(
      mergeSessionUserMetadata(
        { runtime: 'enbor', labels: { lane: 'old' }, annotations: { keep: 'yes', remove: 'old' } },
        { labels: { lane: 'new' }, annotations: { remove: null, ticket: 'Enbor-1' } },
      ),
    ).toEqual({
      runtime: 'enbor',
      labels: { lane: 'new' },
      annotations: { keep: 'yes', ticket: 'Enbor-1' },
    })
  })

  it('handles direct labels, annotations, deletes, and ignored non-strings', () => {
    expect(
      sessionUserMetadata({
        labels: { team: 'runtime', ignored: 1 },
        annotations: { note: 'keep', ignored: false },
        ticket: 'Enbor-1',
        count: 2,
        nullable: null,
      }),
    ).toEqual({ labels: { team: 'runtime' }, annotations: { note: 'keep' } })

    expect(
      mergeSessionUserMetadata(
        { labels: { keep: 'yes', remove: 'old' }, annotations: { keep: 'yes', remove: 'old' } },
        { labels: { remove: null, add: 'new' }, annotations: { remove: null, add: 'new' } },
      ),
    ).toEqual({ labels: { keep: 'yes', add: 'new' }, annotations: { keep: 'yes', add: 'new' } })
  })

  it('applies delete patches when current labels or annotations are absent', () => {
    expect(
      mergeSessionUserMetadata({}, { labels: { missing: null }, annotations: { missing: null }, ticket: null }),
    ).toEqual({ labels: {}, annotations: {} })
  })

  it('ignores non-string metadata patch values', () => {
    expect(
      mergeSessionUserMetadata(
        { labels: { keep: 'yes' }, annotations: { keep: 'yes' } },
        { labels: { ignored: 1 }, annotations: { ignored: false }, ignored: 2 },
      ),
    ).toEqual({ labels: { keep: 'yes' }, annotations: { keep: 'yes' } })
  })
})

describe('[spec: sessions/workspace-safety] hasEmbeddedCredentialUrl additional branches', () => {
  it('returns false for an invalid URL string (parse error)', () => {
    expect(hasEmbeddedCredentialUrl('not-a-url::bad')).toBe(false)
  })

  it('returns false for null and non-object primitives', () => {
    expect(hasEmbeddedCredentialUrl(null)).toBe(false)
    expect(hasEmbeddedCredentialUrl(42)).toBe(false)
    expect(hasEmbeddedCredentialUrl(false)).toBe(false)
  })

  it('recurses through arrays of values', () => {
    expect(hasEmbeddedCredentialUrl(['https://u:p@host', 'https://ok.com'])).toBe(true)
    expect(hasEmbeddedCredentialUrl(['https://ok.com', 'plain'])).toBe(false)
  })
})
