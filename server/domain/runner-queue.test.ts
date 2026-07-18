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
    runnerProjectId: null,
    runnerEnvironmentId: null,
    externalTenantId: null,
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
  it('defaults the auth mode from the token binding', () => {
    expect(runnerAuthModeForRegistration(oidc(), undefined)).toBe('oidc')
    expect(runnerAuthModeForRegistration(oidc({ runnerProjectId: 'project_1' }), undefined)).toBe('federated')
    expect(runnerAuthModeForRegistration(oidc(), 'bearer')).toBe('bearer')
  })

  it('defaults to federated when externalTenantId is set', () => {
    expect(runnerAuthModeForRegistration(oidc({ externalTenantId: 'tenant_1' }), undefined)).toBe('federated')
  })

  it('defaults to federated when runnerEnvironmentId is set', () => {
    expect(runnerAuthModeForRegistration(oidc({ runnerEnvironmentId: 'env_1' }), undefined)).toBe('federated')
  })

  it('overrides the environment with the federated token binding', () => {
    expect(environmentIdForRegistration(oidc({ runnerEnvironmentId: 'env_bound' }), 'env_req')).toBe('env_bound')
    expect(environmentIdForRegistration(oidc(), 'env_req')).toBe('env_req')
  })

  it('rejects a device-login token registering a non-oidc runner', () => {
    expect(runnerOidcBindingFields(oidc({ isRunnerToken: true, clientId: 'cid' }), 'bearer')).toMatchObject({
      authMode: expect.stringContaining('device-login'),
    })
  })

  it('rejects a federated token registering a non-federated runner', () => {
    expect(runnerOidcBindingFields(oidc({ isRunnerToken: true, runnerProjectId: 'project_1' }), 'oidc')).toMatchObject({
      authMode: expect.stringContaining('Federated'),
    })
  })

  it('accepts a federated runner token with a project binding and federated mode', () => {
    expect(runnerOidcBindingFields(oidc({ isRunnerToken: true, runnerProjectId: 'project_1' }), 'federated')).toBeNull()
  })

  it('rejects a federated token that has only an environment id (no project or tenant binding)', () => {
    expect(
      runnerOidcBindingFields(oidc({ isRunnerToken: true, runnerEnvironmentId: 'env_1' }), 'federated'),
    ).toMatchObject({ authorization: expect.stringContaining('project or external tenant') })
  })

  it('accepts an OIDC runner token with a client id and oidc mode', () => {
    expect(runnerOidcBindingFields(oidc({ isRunnerToken: true, clientId: 'cid' }), 'oidc')).toBeNull()
  })

  it('rejects an OIDC runner token missing a client id', () => {
    expect(runnerOidcBindingFields(oidc({ isRunnerToken: true }), 'oidc')).toMatchObject({
      authorization: expect.stringContaining('client id'),
    })
  })

  it('accepts a console (non-runner) token for any mode', () => {
    expect(runnerOidcBindingFields(oidc(), 'bearer')).toBeNull()
  })

  it('reads a trimmed machine id from metadata', () => {
    expect(runnerMachineId({ machineId: '  mac-1 ' })).toBe('mac-1')
    expect(runnerMachineId({ machineId: '' })).toBeNull()
    expect(runnerMachineId(undefined)).toBeNull()
  })
})
