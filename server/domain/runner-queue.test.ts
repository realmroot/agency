import { describe, expect, it } from 'vitest'
import {
  environmentIdForRegistration,
  hasSecretMaterial,
  type RunnerOidcContext,
  runnerAuthModeForRegistration,
  runnerMachineId,
  runnerOidcBindingFields,
  runnerSupportsWork,
} from './runner-queue'

function oidc(overrides: Partial<RunnerOidcContext> = {}): RunnerOidcContext {
  return {
    isRunnerToken: false,
    subject: 'sub_1',
    clientId: null,
    ...overrides,
  }
}

describe('[spec: runners/eligibility] runnerSupportsWork', () => {
  it('claims unscoped non-session work for any runner', () => {
    expect(runnerSupportsWork([], { type: 'maintenance' })).toBe(true)
  })

  it('requires the ama runtime for local tool work', () => {
    const work = { type: 'tool.execute', toolName: 'bash' }
    expect(runnerSupportsWork([], work)).toBe(false)
    expect(runnerSupportsWork([{ runtime: 'ama', state: 'ready', models: [] }], work)).toBe(true)
  })

  it('rejects session starts that declare no runtime requirement', () => {
    expect(runnerSupportsWork([], { type: 'session.start' })).toBe(false)
  })
})

describe('runnerSupportsWork runtime matching', () => {
  it('rejects session work when the runner reports no inventory', () => {
    expect(
      runnerSupportsWork([], {
        type: 'session.start',
        runtimeRequirement: { runtime: 'claude-code', model: 'claude-opus-4' },
      }),
    ).toBe(false)
  })

  it('passes unscoped work regardless of inventory', () => {
    expect(runnerSupportsWork([{ runtime: 'codex', state: 'unhealthy', models: [] }], { type: 'maintenance' })).toBe(
      true,
    )
  })

  it('requires a ready inventory entry with the selected model', () => {
    expect(
      runnerSupportsWork([{ runtime: 'claude-code', state: 'ready', models: ['sonnet'] }], {
        type: 'session.start',
        runtimeRequirement: { runtime: 'claude-code', model: 'opus' },
      }),
    ).toBe(false)
    expect(
      runnerSupportsWork([{ runtime: 'claude-code', state: 'ready', models: ['opus', 'sonnet'] }], {
        type: 'session.start',
        runtimeRequirement: { runtime: 'claude-code', model: 'opus' },
      }),
    ).toBe(true)
  })

  it('requires only the ready runtime when no model is selected', () => {
    expect(
      runnerSupportsWork([{ runtime: 'copilot', state: 'ready', models: ['auto'] }], {
        type: 'session.start',
        runtimeRequirement: { runtime: 'copilot' },
      }),
    ).toBe(true)
  })

  it('requires a ready ama inventory entry for ama work', () => {
    const work = { type: 'session.start', runtimeRequirement: { runtime: 'ama' } }
    expect(runnerSupportsWork([{ runtime: 'ama', state: 'unhealthy', models: [] }], work)).toBe(false)
    expect(runnerSupportsWork([{ runtime: 'ama', state: 'ready', models: [] }], work)).toBe(true)
  })
})

describe('hasSecretMaterial', () => {
  it('flags secret-shaped keys but not plain operator metadata', () => {
    expect(hasSecretMaterial({ apiKey: 'x' })).toBe(true)
    expect(hasSecretMaterial({ access_token: 'x' })).toBe(true)
    expect(hasSecretMaterial({ nested: [{ password: 'x' }] })).toBe(true)
    expect(hasSecretMaterial({ pool: 'default', machineId: 'mac-1' })).toBe(false)
  })
})

describe('[spec: runners/auth-binding] runner registration binding', () => {
  it('defaults to Realmroot and preserves an explicitly requested Realmroot mode', () => {
    expect(runnerAuthModeForRegistration(undefined)).toBe('realmroot')
    expect(runnerAuthModeForRegistration('realmroot')).toBe('realmroot')
  })

  it('preserves the requested environment', () => {
    expect(environmentIdForRegistration('env_req')).toBe('env_req')
    expect(environmentIdForRegistration(undefined)).toBeUndefined()
  })

  it('rejects a runner token registering a legacy auth mode', () => {
    expect(runnerOidcBindingFields(oidc({ isRunnerToken: true, clientId: 'cid' }), 'bearer' as never)).toMatchObject({
      authMode: expect.stringContaining('Realmroot'),
    })
  })

  it('accepts a Realmroot runner token with a bindable client id', () => {
    expect(runnerOidcBindingFields(oidc({ isRunnerToken: true, clientId: 'cid' }), 'realmroot')).toBeNull()
  })

  it('rejects a Realmroot runner token missing a client id', () => {
    expect(runnerOidcBindingFields(oidc({ isRunnerToken: true }), 'realmroot')).toMatchObject({
      authorization: expect.stringContaining('client id'),
    })
  })

  it('rejects a console token for Realmroot registration', () => {
    expect(runnerOidcBindingFields(oidc(), 'realmroot')).toMatchObject({
      authorization: expect.stringContaining('Realmroot runner device token'),
    })
  })

  it('reads a trimmed machine id from metadata', () => {
    expect(runnerMachineId({ machineId: '  mac-1 ' })).toBe('mac-1')
    expect(runnerMachineId({ machineId: '' })).toBeNull()
    expect(runnerMachineId(undefined)).toBeNull()
  })
})
