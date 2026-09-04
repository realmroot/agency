import { resolveCliPath } from './host/cli'
import type { RuntimeBridgeInputMessage, RuntimeInventoryEntry, RuntimeProvider } from './protocol'
import { listProviders } from './providers/registry'
import { probeFailureStatus, TEST_MODE_RUNTIME_MODELS } from './run-modes'

type InventoryRequest = Extract<RuntimeBridgeInputMessage, { type: 'inventory' }>

type InventoryDependencies = {
  providers: RuntimeProvider[]
  resolveCli: (binary: string) => string | undefined
  bridgeTestMode: boolean
}

const defaultDependencies = (): InventoryDependencies => ({
  providers: listProviders(),
  resolveCli: resolveCliPath,
  bridgeTestMode: process.env.ENBOR_RUNTIME_BRIDGE_TEST_MODE === '1',
})

export async function collectRuntimeInventory(
  request: InventoryRequest,
  dependencies: InventoryDependencies = defaultDependencies(),
): Promise<RuntimeInventoryEntry[]> {
  const runtimes: RuntimeInventoryEntry[] = []
  for (const provider of dependencies.providers) {
    const installed = dependencies.bridgeTestMode || Boolean(dependencies.resolveCli(provider.binary))
    if (!installed) {
      runtimes.push({
        runtime: provider.name,
        binary: provider.binary,
        installed: false,
        fallbackModels: provider.fallbackModels,
        models: [],
        status: 'missing',
        detail: `${provider.binary} CLI not found on PATH`,
      })
      continue
    }
    let models: string[] = []
    let status = 'ready'
    let detail = 'host CLI is available'
    try {
      if (request.usageOnly) {
        detail = 'host CLI usage probe'
      } else if (dependencies.bridgeTestMode) {
        models = TEST_MODE_RUNTIME_MODELS[provider.name] ?? []
        detail = 'deterministic bridge test runtime'
      } else {
        models = provider.listModels ? ((await provider.listModels({ env: request.env })) ?? []) : []
        if (models.length > 0) {
          detail = `host CLI enumerated ${models.length} models`
        } else {
          status = 'unauthenticated'
          detail = 'host CLI exposed no models; authenticate the runtime CLI'
        }
      }
    } catch (err) {
      status = probeFailureStatus(err instanceof Error ? err.message : String(err))
      detail = 'host model enumeration failed'
    }

    let usageWindows = null
    let limitedDetail: string | null = null
    if (request.includeUsage && provider.fetchUsage && !dependencies.bridgeTestMode) {
      try {
        usageWindows = await provider.fetchUsage({ env: request.env })
      } catch {
        usageWindows = null
      }
      if ((!usageWindows || usageWindows.length === 0) && provider.usageUnavailableDetail) {
        limitedDetail = provider.usageUnavailableDetail
      }
    }

    runtimes.push({
      runtime: provider.name,
      binary: provider.binary,
      installed: true,
      fallbackModels: provider.fallbackModels,
      models,
      status,
      detail,
      ...(usageWindows ? { usageWindows } : {}),
      ...(limitedDetail ? { limitedDetail } : {}),
    })
  }
  return runtimes
}
