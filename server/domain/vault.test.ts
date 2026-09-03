import { describe, expect, it } from 'vitest'
import {
  amaSecretRef,
  credentialDataKeys,
  credentialScopedSecretRef,
  credentialVersionSecretRef,
  parseRealmrootAgentState,
  secretReference,
  secretRefIdentity,
  stripStoredSecretMetadata,
  validateSecretData,
  vaultIdFromRef,
} from './vault'

const REALMROOT_PRIVATE_KEY = 'BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBw'
const DPOP_PRIVATE_KEY = 'AgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgI'

function realmrootState(overrides: Record<string, unknown> = {}) {
  return {
    version: 18,
    agent_id: 'rr_agent_1',
    origin: 'https://realmroot.example.com',
    issuer: 'https://realmroot.example.com/api/auth',
    runtime: 'ama',
    host_id: 'host_1',
    agent_key_id: 'key_1',
    agent_private_key: REALMROOT_PRIVATE_KEY,
    enrollment_idempotency_key: 'enroll_1',
    ...overrides,
  }
}

function protocolCredential(overrides: Record<string, unknown> = {}) {
  return {
    resource_indicator: 'https://resource.example.com/',
    authorization_details: [],
    credential_endpoint: 'https://realmroot.example.com/api/credentials',
    proof_target: 'https://resource.example.com/',
    private_key: DPOP_PRIVATE_KEY,
    scopes: ['resource:read'],
    ...overrides,
  }
}

function credentialSource(overrides: Record<string, unknown> = {}) {
  return {
    resource_indicator: 'https://resource.example.com/',
    authorization_details: [],
    credential: protocolCredential({ private_key: undefined }),
    ...overrides,
  }
}

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

  it.each([
    'ama',
    'codex',
    'claude-code',
    'copilot',
    'hermes',
    'antigravity',
  ] as const)('[spec: identities/provision] accepts a Realmroot state object enrolled with AGENT=%s', (runtime) => {
    const state = JSON.stringify({
      version: 18,
      agent_id: 'rr_agent_1',
      origin: 'https://realmroot.example.com',
      issuer: 'https://realmroot.example.com/api/auth',
      runtime,
      host_id: 'host_1',
      agent_key_id: 'key_1',
      agent_private_key: 'BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBw',
      enrollment_idempotency_key: 'enroll_1',
    })
    expect(validateSecretData('ama.dev/realmroot-agent-state', { 'state.json': state })).toBeNull()
    expect(validateSecretData('ama.dev/realmroot-agent-state', { 'state.json': state, extra: 'no' })).toEqual({
      'stringData.extra': 'Credential type ama.dev/realmroot-agent-state does not define extra.',
    })
    expect(validateSecretData('ama.dev/realmroot-agent-state', { 'state.json': '{bad' })).toEqual({
      'stringData.state.json': 'Realmroot Agent state must be valid JSON.',
    })
  })

  it('[spec: identities/provision] rejects invalid Realmroot runtime identifiers', () => {
    expect(
      validateSecretData('ama.dev/realmroot-agent-state', {
        'state.json': JSON.stringify(realmrootState({ runtime: '../invalid' })),
      }),
    ).toEqual({ 'stringData.state.json': 'Realmroot Agent state contains an invalid runtime.' })
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

describe('[spec: identities/provision] strict Realmroot v0.4.2 state parsing', () => {
  it('rejects unknown top-level and malformed nested structures', () => {
    expect(() => parseRealmrootAgentState(JSON.stringify(realmrootState({ future_field: true })))).toThrow(
      'fields unknown to v0.4.2',
    )
    expect(() => parseRealmrootAgentState(JSON.stringify(realmrootState({ name: 42 })))).toThrow('invalid name')
    expect(() =>
      parseRealmrootAgentState(
        JSON.stringify(
          realmrootState({
            registration_approval: {
              verification_uri_complete: 'https://realmroot.example.com/approve',
              expires_at: 'September 1, 2026',
              interval_seconds: 1.5,
            },
          }),
        ),
      ),
    ).toThrow('approval interval is invalid')
    expect(() =>
      parseRealmrootAgentState(
        JSON.stringify(
          realmrootState({
            registration_approval: {
              verification_uri_complete: 'https://realmroot.example.com/approve',
              expires_at: 'September 1, 2026',
              interval_seconds: 5,
            },
          }),
        ),
      ),
    ).toThrow('approval expiry is invalid')
    expect(() =>
      parseRealmrootAgentState(
        JSON.stringify(
          realmrootState({
            registration_approval: {
              verification_uri_complete: 'https://realmroot.example.com/approve',
              expires_at: '2026-02-30T00:00:00Z',
              interval_seconds: 5,
            },
          }),
        ),
      ),
    ).toThrow('approval expiry is invalid')
    expect(() => parseRealmrootAgentState(JSON.stringify(realmrootState({ identity: { id: 'identity_1' } })))).toThrow(
      'identity is incomplete',
    )
    expect(() =>
      parseRealmrootAgentState(
        JSON.stringify(
          realmrootState({
            credential_sources: {
              bad_reference: {
                resource_indicator: 'https://resource.example.com',
                authorization_details: [],
                credential: {},
              },
            },
          }),
        ),
      ),
    ).toThrow('credential source reference is invalid')
    expect(() =>
      parseRealmrootAgentState(
        JSON.stringify(
          realmrootState({
            protocol_credential: {
              resource_indicator: 'https://resource.example.com',
              authorization_details: [],
              credential_endpoint: 'https://realmroot.example.com/credentials',
              proof_target: 'https://resource.example.com',
              private_key: 'not-a-32-byte-key',
              scopes: ['resource:read'],
            },
          }),
        ),
      ),
    ).toThrow('protocol DPoP private key is invalid')
  })

  it('accepts the complete optional v0.4.2 structures', () => {
    const resource = 'https://resource.example.com/'
    const sourceDetails = [
      { type: 'realmroot_resource', context: { zeta: 2, alpha: 1 } },
      { type: 'realmroot_actions', actions: ['read'] },
    ]
    const credentialDetails = [
      { actions: ['read'], type: 'realmroot_actions' },
      { context: { alpha: 1, zeta: 2 }, type: 'realmroot_resource' },
    ]
    const state = realmrootState({
      name: 'AMA Agent',
      registration_approval: {
        verification_uri_complete: 'https://realmroot.example.com/approve?code=abc',
        expires_at: '2026-09-01T00:00:00.000Z',
        interval_seconds: 5,
      },
      identity: {
        id: 'identity_1',
        issuer: 'https://realmroot.example.com/api/auth',
        subject: 'rr_agent_1',
        username: 'ama-agent',
        name: 'AMA Agent',
        runtime: 'ama',
      },
      credential_sources: {
        rrcs_AQEBAQEBAQEBAQEBAQEBAQ: {
          resource_indicator: resource,
          authorization_details: sourceDetails,
          credential: {
            resource_indicator: resource,
            authorization_details: credentialDetails,
            credential_endpoint: 'https://realmroot.example.com/api/credentials',
            proof_target: resource,
            scopes: ['resource:read'],
          },
        },
      },
      protocol_credential: {
        resource_indicator: 'https://realmroot.example.com/',
        authorization_details: [],
        credential_endpoint: 'https://realmroot.example.com/api/credentials',
        proof_target: 'https://realmroot.example.com/',
        private_key: DPOP_PRIVATE_KEY,
        access_token: 'access-token',
        expires_at: '2026-09-01T00:00:00.000Z',
        scopes: ['agent:operate'],
      },
    })

    expect(parseRealmrootAgentState(JSON.stringify(state))).toEqual({
      agentId: 'identity_1',
      origin: 'https://realmroot.example.com',
      issuer: 'https://realmroot.example.com/api/auth',
      runtime: 'ama',
    })
  })

  it('rejects malformed required state fields and unsafe service URLs', () => {
    for (const content of ['null', '[]', '"state"']) {
      expect(() => parseRealmrootAgentState(content)).toThrow('must be a JSON object')
    }
    expect(() => parseRealmrootAgentState('{')).toThrow('must be valid JSON')
    expect(() => parseRealmrootAgentState(JSON.stringify(realmrootState({ version: 17 })))).toThrow('use version 18')

    for (const [key, value] of [
      ['agent_id', ' '],
      ['origin', 3],
      ['issuer', ''],
      ['host_id', null],
      ['agent_key_id', false],
      ['enrollment_idempotency_key', []],
    ] as const) {
      expect(() => parseRealmrootAgentState(JSON.stringify(realmrootState({ [key]: value })))).toThrow(
        `requires ${key}`,
      )
    }

    for (const origin of [
      'not a url',
      'http://realmroot.example.com',
      'https://user@realmroot.example.com',
      'https://realmroot.example.com?x=1',
    ]) {
      expect(() => parseRealmrootAgentState(JSON.stringify(realmrootState({ origin })))).toThrow(
        'origin must be a safe HTTPS URL',
      )
    }
    for (const issuer of ['not a url', 'http://realmroot.example.com', 'https://realmroot.example.com/#fragment']) {
      expect(() => parseRealmrootAgentState(JSON.stringify(realmrootState({ issuer })))).toThrow(
        'issuer must be a safe HTTPS URL',
      )
    }
    for (const agent_private_key of [7, 'bad+', 'A', DPOP_PRIVATE_KEY]) {
      expect(() => parseRealmrootAgentState(JSON.stringify(realmrootState({ agent_private_key })))).toThrow(
        'invalid Ed25519 private key',
      )
    }
  })

  it('validates approval, identity, and RFC3339 boundaries', () => {
    for (const registration_approval of [
      [],
      { unknown: true },
      { verification_uri_complete: 1, interval_seconds: 5 },
      { verification_uri_complete: 'not a url', interval_seconds: 5 },
      { verification_uri_complete: 'ftp://realmroot.example.com/approve', interval_seconds: 5 },
    ]) {
      expect(() => parseRealmrootAgentState(JSON.stringify(realmrootState({ registration_approval })))).toThrow()
    }

    for (const expires_at of [
      1,
      '2026-13-01T00:00:00Z',
      '2026-01-00T00:00:00Z',
      '1900-02-29T00:00:00Z',
      '2026-01-01T24:00:00Z',
      '2026-01-01T00:60:00Z',
      '2026-01-01T00:00:60Z',
      '2026-01-01T00:00:00+24:00',
      '2026-01-01T00:00:00+00:60',
    ]) {
      expect(() =>
        parseRealmrootAgentState(
          JSON.stringify(
            realmrootState({
              registration_approval: {
                verification_uri_complete: 'http://localhost:8787/approve',
                interval_seconds: 5,
                expires_at,
              },
            }),
          ),
        ),
      ).toThrow('approval expiry is invalid')
    }
    expect(() =>
      parseRealmrootAgentState(
        JSON.stringify(
          realmrootState({
            registration_approval: {
              verification_uri_complete: 'http://127.0.0.1:8787/approve',
              interval_seconds: 5,
              expires_at: '2000-02-29T23:59:59-23:59',
            },
          }),
        ),
      ),
    ).not.toThrow()

    for (const identity of [
      null,
      [],
      { id: 'id', issuer: 'issuer', subject: 'subject', unknown: true },
      { id: 'id', issuer: 'issuer', subject: 'subject', username: 1 },
      { id: 'id', issuer: 'issuer', subject: 'subject', name: false },
      { id: 'id', issuer: 'issuer', subject: 'subject', runtime: [] },
    ]) {
      const state = realmrootState({ identity })
      if (identity === null) expect(() => parseRealmrootAgentState(JSON.stringify(state))).not.toThrow()
      else expect(() => parseRealmrootAgentState(JSON.stringify(state))).toThrow()
    }
  })

  it('rejects malformed credential source shapes and context mismatches', () => {
    for (const credential_sources of [
      [],
      { rrcs_AQEBAQEBAQEBAQEBAQEBAQ: [] },
      { rrcs_AQEBAQEBAQEBAQEBAQEBAQ: { ...credentialSource(), unknown: true } },
      { rrcs_AQEBAQEBAQEBAQEBAQEBAQ: credentialSource({ resource_indicator: 'file:///secret' }) },
      { rrcs_AQEBAQEBAQEBAQEBAQEBAQ: credentialSource({ authorization_details: [null] }) },
      { rrcs_AQEBAQEBAQEBAQEBAQEBAQ: credentialSource({ credential: null }) },
      {
        rrcs_AQEBAQEBAQEBAQEBAQEBAQ: credentialSource({
          credential: protocolCredential({ private_key: undefined, future: true }),
        }),
      },
      {
        rrcs_AQEBAQEBAQEBAQEBAQEBAQ: credentialSource({
          credential: protocolCredential({ private_key: undefined, resource_indicator: 'https://other.example.com' }),
        }),
      },
      {
        rrcs_AQEBAQEBAQEBAQEBAQEBAQ: credentialSource({
          authorization_details: [{ type: 'one' }],
          credential: protocolCredential({ private_key: undefined, authorization_details: [{ type: 'two' }] }),
        }),
      },
      {
        rrcs_AQEBAQEBAQEBAQEBAQEBAQ: credentialSource({
          credential: protocolCredential({ private_key: undefined, scopes: [] }),
        }),
      },
      {
        rrcs_AQEBAQEBAQEBAQEBAQEBAQ: credentialSource({
          credential: protocolCredential({ private_key: 'secret' }),
        }),
      },
    ]) {
      expect(() => parseRealmrootAgentState(JSON.stringify(realmrootState({ credential_sources })))).toThrow()
    }

    expect(() =>
      parseRealmrootAgentState(
        JSON.stringify(
          realmrootState({
            credential_sources: {
              rrcs_AQEBAQEBAQEBAQEBAQEBAQ: credentialSource(),
              rrcs_AgICAgICAgICAgICAgICAg: credentialSource(),
            },
          }),
        ),
      ),
    ).toThrow('duplicate context')
  })

  it('validates every DPoP credential field and protocol token pairing', () => {
    for (const protocol_credential of [
      [],
      protocolCredential({ unknown: true }),
      protocolCredential({ resource_indicator: '' }),
      protocolCredential({ resource_indicator: 'https://user:pass@resource.example.com' }),
      protocolCredential({ credential_endpoint: 'invalid' }),
      protocolCredential({ proof_target: 'http://resource.example.com' }),
      protocolCredential({ authorization_details: 'invalid' }),
      protocolCredential({ scopes: 'read' }),
      protocolCredential({ scopes: [1] }),
      protocolCredential({ access_token: 1 }),
      protocolCredential({ expires_at: 1 }),
      protocolCredential({ access_token: 'token' }),
      protocolCredential({ expires_at: '2026-01-01T00:00:00Z' }),
    ]) {
      expect(() => parseRealmrootAgentState(JSON.stringify(realmrootState({ protocol_credential })))).toThrow()
    }

    expect(() =>
      parseRealmrootAgentState(
        JSON.stringify(realmrootState({ protocol_credential: protocolCredential({ expires_at: null }) })),
      ),
    ).not.toThrow()
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
