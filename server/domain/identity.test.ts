import { describe, expect, it } from 'vitest'
import {
  type IdentityDescriptor,
  IdentityRuntimeMismatchError,
  IdentityRuntimeRequiredError,
  isIdentityRuntime,
  resolveIdentityRuntime,
} from './identity'

const descriptor: IdentityDescriptor = {
  identityId: 'identity_1',
  agentId: 'rr_agent_1',
  issuer: 'https://realmroot.example/api/auth',
  subject: 'rr_agent_1',
  username: 'reviewer',
  runtime: 'codex',
  credentialRef: 'enbor://vaults/vault_1/credentials/cred_1',
}

describe('Identity runtime resolution', () => {
  it('accepts canonical runtime identifiers independently of Enbor drivers', () => {
    expect(['hermes', 'antigravity', 'custom.runtime_1'].every(isIdentityRuntime)).toBe(true)
    expect(['', '.invalid', 'Uppercase', 'path/runtime', 'a'.repeat(65)].some(isIdentityRuntime)).toBe(false)
  })

  it('requires an explicit runtime without an Identity', () => {
    expect(() => resolveIdentityRuntime(undefined, null)).toThrow(IdentityRuntimeRequiredError)
    expect(() => resolveIdentityRuntime(undefined, null)).toThrow('Runtime is required')
  })

  it('accepts the explicit runtime without an Identity', () => {
    expect(resolveIdentityRuntime('enbor', null)).toBe('enbor')
  })

  it('inherits or accepts the matching immutable Identity runtime', () => {
    expect(resolveIdentityRuntime(undefined, descriptor)).toBe('codex')
    expect(resolveIdentityRuntime('codex', descriptor)).toBe('codex')
  })

  it('reports both expected and actual runtimes on a mismatch', () => {
    let error: unknown
    try {
      resolveIdentityRuntime('copilot', descriptor)
    } catch (caught) {
      error = caught
    }
    expect(error).toBeInstanceOf(IdentityRuntimeMismatchError)
    expect(error).toMatchObject({
      name: 'IdentityRuntimeMismatchError',
      code: 'identity_runtime_mismatch',
      expected: 'codex',
      actual: 'copilot',
    })
  })
})
