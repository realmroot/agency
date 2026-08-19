import { describe, expect, it } from 'vitest'
import type { CredentialType } from '@/lib/amarpc'
import {
  credentialSecretData,
  credentialTypes,
  defaultCredentialData,
  emptyCredential,
  hasValidCredentialSecretData,
} from './credential-form-model'

describe('credential form model', () => {
  it('defines default secret fields for every credential type', () => {
    const expected: Record<CredentialType, Record<string, string>> = {
      opaque: { value: '' },
      'ama.dev/basic-auth': { username: '', password: '' },
      'ama.dev/ssh-auth': { 'ssh-privatekey': '' },
      'ama.dev/tls': { 'tls.crt': '', 'tls.key': '' },
      'ama.dev/private-key-jwk': { jwk: '' },
      'ama.dev/oauth-token': {
        'access-token': '',
        'refresh-token': '',
        'token-type': '',
        'expires-at': '',
        scopes: '',
      },
      'ama.dev/realmroot-agent-state': { 'state.json': '' },
    }

    expect(Object.fromEntries(credentialTypes.map(({ type }) => [type, defaultCredentialData(type)]))).toEqual(expected)
  })

  it('filters blank values and trims keys before submitting secret data', () => {
    expect(
      credentialSecretData({
        ...emptyCredential,
        data: { ' token ': 'sk-secret', empty: '', '   ': 'ignored' },
      }),
    ).toEqual({ token: 'sk-secret' })
  })

  it('validates required fields according to credential type', () => {
    expect(hasValidCredentialSecretData({ ...emptyCredential, data: { value: 'secret' } })).toBe(true)
    expect(
      hasValidCredentialSecretData({
        ...emptyCredential,
        type: 'ama.dev/basic-auth',
        data: { username: 'user', password: '' },
      }),
    ).toBe(false)
    expect(
      hasValidCredentialSecretData({
        ...emptyCredential,
        type: 'ama.dev/basic-auth',
        data: { username: 'user', password: 'pass' },
      }),
    ).toBe(true)
    expect(
      hasValidCredentialSecretData({
        ...emptyCredential,
        type: 'ama.dev/ssh-auth',
        data: { 'ssh-privatekey': 'key' },
      }),
    ).toBe(true)
    expect(
      hasValidCredentialSecretData({
        ...emptyCredential,
        type: 'ama.dev/tls',
        data: { 'tls.crt': 'cert', 'tls.key': 'key' },
      }),
    ).toBe(true)
    expect(
      hasValidCredentialSecretData({
        ...emptyCredential,
        type: 'ama.dev/private-key-jwk',
        data: { jwk: '{"kty":"OKP"}' },
      }),
    ).toBe(true)
    expect(
      hasValidCredentialSecretData({
        ...emptyCredential,
        type: 'ama.dev/oauth-token',
        data: { 'access-token': 'token' },
      }),
    ).toBe(true)
    expect(
      hasValidCredentialSecretData({
        ...emptyCredential,
        type: 'ama.dev/realmroot-agent-state',
        data: { 'state.json': '' },
      }),
    ).toBe(false)
    expect(
      hasValidCredentialSecretData({
        ...emptyCredential,
        type: 'ama.dev/realmroot-agent-state',
        data: {
          'state.json': JSON.stringify({
            version: 18,
            agent_id: 'rr_agent_1',
            origin: 'https://realmroot.example.com',
            issuer: 'https://realmroot.example.com/api/auth',
            runtime: 'ama',
            host_id: 'host_1',
            agent_key_id: 'key_1',
            agent_private_key: 'BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBw',
            enrollment_idempotency_key: 'enroll_1',
          }),
        },
      }),
    ).toBe(true)
  })
})
