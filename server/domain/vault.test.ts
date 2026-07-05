import { describe, expect, it } from 'vitest'
import {
  amaSecretRef,
  credentialDataKeys,
  credentialScopedSecretRef,
  credentialVersionSecretRef,
  secretReference,
  secretRefIdentity,
  stripStoredSecretMetadata,
  validateSecretData,
  vaultIdFromRef,
} from './vault'

describe('[spec: vaults/secret-reference] secretReference', () => {
  it('builds a managed reference and derives a reference name', () => {
    const ref = secretReference(
      { vaultId: 'vault_abc', credentialId: 'vaultcred_abc', versionId: 'vaultver_abc' },
      1,
      'opaque',
      { stringData: { value: 'token' } },
    )
    expect(ref).toMatchObject({
      provider: 'ama',
      referenceName: 'AMA_VAULTCRED_ABC_V1',
      secretRef: 'ama://vaults/vault_abc/credentials/vaultcred_abc/versions/vaultver_abc',
      hasSecret: true,
    })
  })

  it('honours an explicit reference name and version number', () => {
    const ref = secretReference(
      { vaultId: 'vault_abc', credentialId: 'vaultcred_abc', versionId: 'vaultver_3' },
      3,
      'opaque',
      {
        stringData: { value: 'token' },
        referenceName: 'CUSTOM',
      },
    )
    expect(ref.referenceName).toBe('CUSTOM')
    expect(ref.secretRef).toBe('ama://vaults/vault_abc/credentials/vaultcred_abc/versions/vaultver_3')
  })

  it('requires string data', () => {
    expect(() => secretReference({ vaultId: 'vault_abc', credentialId: 'c', versionId: 'v' }, 1, 'opaque', {})).toThrow(
      /At least one data key is required/,
    )
  })

  it('preserves user metadata and sorted data keys', () => {
    const ref = secretReference(
      { vaultId: 'vault spaced', credentialId: 'cred/slash', versionId: 'ver#1' },
      2,
      'opaque',
      { stringData: { z: 'last', a: 'first' }, metadata: { owner: 'ops' } },
    )
    expect(ref.secretRef).toBe('ama://vaults/vault%20spaced/credentials/cred%2Fslash/versions/ver%231')
    expect(ref.metadata).toEqual({ owner: 'ops', dataKeys: ['a', 'z'] })
  })
})

describe('[spec: vaults/credential-create] validateSecretData', () => {
  it('accepts the supported credential data shapes', () => {
    expect(validateSecretData('ama.dev/basic-auth', { username: 'u', password: 'p' })).toBeNull()
    expect(validateSecretData('ama.dev/ssh-auth', { 'ssh-privatekey': 'key' })).toBeNull()
    expect(validateSecretData('ama.dev/tls', { 'tls.crt': 'crt', 'tls.key': 'key' })).toBeNull()
    expect(validateSecretData('ama.dev/oauth-token', { 'access-token': 'a', scopes: 'repo' })).toBeNull()
    expect(validateSecretData('ama.dev/private-key-jwk', { jwk: '{"kty":"oct"}' })).toBeNull()
    expect(validateSecretData('opaque', { any: 'thing', token: 'ok' })).toBeNull()
  })

  it('rejects missing, unsafe, empty, and extra data keys', () => {
    expect(validateSecretData('ama.dev/basic-auth', { username: 'u' })).toEqual({
      'stringData.password': 'Credential type ama.dev/basic-auth requires password.',
    })
    expect(validateSecretData('ama.dev/basic-auth', { username: 'u', password: 'p', token: 'x' })).toEqual({
      'stringData.token': 'Credential type ama.dev/basic-auth does not define token.',
    })
    expect(validateSecretData('opaque', { 'bad/key': 'x' })).toEqual({
      'stringData.bad/key': 'Use a safe Secret data key.',
    })
    expect(validateSecretData('opaque', { empty: '' })).toEqual({
      'stringData.empty': 'Secret data values must not be empty.',
    })
    expect(validateSecretData('opaque', { '': 'x' })).toEqual({ 'stringData.<empty>': 'Use a safe Secret data key.' })
  })

  it('validates JWK JSON object material', () => {
    expect(validateSecretData('ama.dev/private-key-jwk', { jwk: '' })).toEqual({
      'stringData.jwk': 'Secret data values must not be empty.',
    })
    expect(validateSecretData('ama.dev/private-key-jwk', { jwk: 'not-json' })).toEqual({
      'stringData.jwk': 'JWK must be valid JSON.',
    })
    expect(validateSecretData('ama.dev/private-key-jwk', { jwk: '[]' })).toEqual({
      'stringData.jwk': 'JWK must be a JSON object.',
    })
  })
})

describe('[spec: vaults/secret-reference] stripStoredSecretMetadata', () => {
  it('removes stored secret material from version metadata', () => {
    expect(
      stripStoredSecretMetadata({
        encryptedSecretValue: 'x',
        encryptedSecretData: { value: 'x' },
        localSecretValue: 'y',
        rotatedBy: 'op',
      }),
    ).toEqual({ rotatedBy: 'op' })
  })
})

describe('[spec: vaults/secret-reference] credentialDataKeys', () => {
  it('returns sorted declared or stored data keys without leaking values', () => {
    expect(credentialDataKeys({ dataKeys: ['z', 'a'] })).toEqual(['a', 'z'])
    expect(credentialDataKeys({ encryptedSecretData: { token: 'cipher', alpha: 'cipher' } })).toEqual([
      'alpha',
      'token',
    ])
    expect(credentialDataKeys({ dataKeys: ['ok', 1], encryptedSecretData: null })).toEqual([])
  })
})

describe('[spec: vaults/secret-reference] secretRefIdentity', () => {
  it('parses vault, credential, and credential-version refs', () => {
    expect(secretRefIdentity('ama://vaults/vault_1')).toEqual({ vaultId: 'vault_1' })
    expect(secretRefIdentity(credentialScopedSecretRef({ vaultId: 'vault_1', credentialId: 'cred_1' }))).toEqual({
      vaultId: 'vault_1',
      credentialId: 'cred_1',
    })
    expect(secretRefIdentity('ama://vaults/vault_1/credentials/cred_1/versions/ver_1')).toEqual({
      vaultId: 'vault_1',
      credentialId: 'cred_1',
      versionId: 'ver_1',
    })
  })

  it('rejects malformed secret refs and extracts vault ids', () => {
    expect(amaSecretRef('vault 1')).toBe('ama://vaults/vault%201')
    expect(credentialVersionSecretRef({ vaultId: 'vault_1', credentialId: 'cred_1', versionId: 'ver_1' })).toBe(
      'ama://vaults/vault_1/credentials/cred_1/versions/ver_1',
    )
    expect(vaultIdFromRef('ama://vaults/vault_1')).toBe('vault_1')
    expect(vaultIdFromRef('not a url')).toBeNull()
    expect(vaultIdFromRef('ama://vaults/vault_1/credentials/cred_1')).toBeNull()
    expect(secretRefIdentity('not a url')).toBeNull()
    expect(secretRefIdentity('https://vaults/vault_1')).toBeNull()
    expect(secretRefIdentity('ama://vaults/vault_1/bad')).toBeNull()
  })
})
