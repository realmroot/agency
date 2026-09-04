import { describe, expect, it, vi } from 'vitest'
import { collectRuntimeInventory } from './inventory'
import type { RuntimeProvider } from './protocol'

describe('collectRuntimeInventory', () => {
  // [spec: runners/heartbeat]
  it('fetches usage without enumerating provider models for a usage-only refresh', async () => {
    const listModels = vi.fn(async () => ['claude-sonnet-4-6'])
    const fetchUsage = vi.fn(async () => [{ label: '5-Hour', utilization: 0.5, resetsAt: '2026-09-04T00:00:00Z' }])
    const provider: RuntimeProvider = {
      name: 'claude-code',
      binary: 'claude',
      fallbackModels: ['claude-sonnet-4-6'],
      execute: vi.fn(),
      listModels,
      fetchUsage,
    }

    const inventory = await collectRuntimeInventory(
      {
        type: 'inventory',
        requestId: 'usage',
        env: { ENBOR_RUNTIME_BRIDGE_HOST_HOME: '/host-home' },
        includeUsage: true,
        usageOnly: true,
      },
      {
        providers: [provider],
        resolveCli: () => '/usr/local/bin/claude',
        bridgeTestMode: false,
      },
    )

    expect(fetchUsage).toHaveBeenCalledOnce()
    expect(listModels).not.toHaveBeenCalled()
    expect(inventory[0]).toMatchObject({
      runtime: 'claude-code',
      models: [],
      usageWindows: [{ label: '5-Hour', utilization: 0.5, resetsAt: '2026-09-04T00:00:00Z' }],
    })
  })
})
