import type { RuntimeSupport } from '@server/domain/runtime-catalog'
import { describe, expect, it, vi } from 'vitest'
import type { AuthScope } from '../ports'
import { validateRuntimeProviderModel } from './provisioning'

const auth: AuthScope = {
  user: { id: 'user_1' },
  organization: { id: 'org_1', name: 'Organization' },
  project: { id: 'project_1', name: 'Project' },
  roles: ['system'],
  permissions: ['*'],
}

function depsWithInventory(inventory: RuntimeSupport) {
  const activeRunnerRuntimes = vi.fn(async () => [inventory])
  return {
    activeRunnerRuntimes,
    deps: {
      sessionOrchestration: { activeRunnerRuntimes },
      providers: {},
    },
  }
}

describe('validateRuntimeProviderModel self-hosted inventory boundary', () => {
  it('matches a canonical provider/model selection against the runner-local inventory', async () => {
    const fixture = depsWithInventory([{ runtime: 'codex', state: 'ready', models: ['gpt-5.6-sol'] }])

    await expect(
      validateRuntimeProviderModel(
        fixture.deps as never,
        auth,
        'environment_1',
        'self_hosted',
        'codex',
        'openai',
        'openai/gpt-5.6-sol',
      ),
    ).resolves.toBe(true)
    expect(fixture.activeRunnerRuntimes).toHaveBeenCalledWith('project_1', 'environment_1')
  })

  it('preserves a runner-native slash-containing model owned by a different namespace', async () => {
    const fixture = depsWithInventory([{ runtime: 'codex', state: 'ready', models: ['org/model'] }])

    await expect(
      validateRuntimeProviderModel(
        fixture.deps as never,
        auth,
        'environment_1',
        'self_hosted',
        'codex',
        'openai',
        'org/model',
      ),
    ).resolves.toBe(true)
  })
})
