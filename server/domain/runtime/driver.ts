// The runtime driver table: the per-runtime capability descriptor and the pure
// lookup/naming/metadata helpers over it. Drivers are pure data — a runtime's
// hosting-mode + provider/model support and its cloud backend/protocol labels.
//
// Cloud session startup is a capability flag (supportsCloudStartup), not a
// function reference: the effectful startCloudSession lives behind a usecase
// port, so the domain driver stays free of any adapters/session-runtime import
// and domain-stays-pure holds.

import { type IdentityRuntime, IdentityRuntimeUnsupportedError } from '@server/domain/identity'
import {
  type RuntimeHostingMode,
  type RuntimeName,
  runtimeCatalogSupportsProviderModel,
  runtimeSupportsHostingMode,
} from '@server/domain/runtime-catalog'

export type RuntimeDriver = {
  runtime: RuntimeName
  cloudBackend: string | null
  cloudProtocol: string | null
  supportsHostingMode: (hostingMode: RuntimeHostingMode) => boolean
  supportsCloudProviderModel: (provider: string, model: string | null) => boolean
  // Whether the runtime can boot a cloud sandbox session. The effectful startup
  // lives behind a usecase port; this flag gates that call.
  supportsCloudStartup: boolean
}

const SELF_HOSTED_ONLY_DRIVERS = ['claude-code', 'codex', 'copilot'] as const

const ENBOR_DRIVER: RuntimeDriver = {
  runtime: 'ama',
  cloudBackend: 'ama-cloud',
  cloudProtocol: 'ama-runtime-rpc',
  supportsHostingMode: (hostingMode) => runtimeSupportsHostingMode(hostingMode, 'ama'),
  supportsCloudProviderModel: (provider, model) => runtimeCatalogSupportsProviderModel('cloud', 'ama', provider, model),
  supportsCloudStartup: true,
}

const SELF_HOSTED_DRIVERS: RuntimeDriver[] = SELF_HOSTED_ONLY_DRIVERS.map((runtime) => ({
  runtime,
  cloudBackend: null,
  cloudProtocol: null,
  supportsHostingMode: (hostingMode) => runtimeSupportsHostingMode(hostingMode, runtime),
  supportsCloudProviderModel: () => false,
  supportsCloudStartup: false,
}))

export const RUNTIME_DRIVERS: readonly RuntimeDriver[] = [ENBOR_DRIVER, ...SELF_HOSTED_DRIVERS]

// Valid runtime names derived from the registered drivers, so an untrusted
// string (e.g. a queue message field) can be checked before it is cast to the
// RuntimeName union and handed to runtimeDriver().
const RUNTIME_DRIVER_NAMES: ReadonlySet<string> = new Set(RUNTIME_DRIVERS.map((driver) => driver.runtime))

export function isRuntimeName(value: unknown): value is RuntimeName {
  return typeof value === 'string' && RUNTIME_DRIVER_NAMES.has(value)
}

export function runtimeNameForIdentity(runtime: IdentityRuntime): RuntimeName {
  if (!isRuntimeName(runtime)) throw new IdentityRuntimeUnsupportedError(runtime)
  return runtime
}

export function runtimeDriver(runtime: RuntimeName) {
  const driver = RUNTIME_DRIVERS.find((candidate) => candidate.runtime === runtime)
  if (!driver) {
    throw new Error(`Unsupported runtime driver: ${runtime}`)
  }
  return driver
}

export function runtimeDriverName(runtime: RuntimeName, hostingMode: RuntimeHostingMode) {
  if (runtime === 'ama') {
    return 'ama-cloud'
  }
  return hostingMode === 'cloud' ? runtimeDriver(runtime).cloudBackend : `${runtime}-self-hosted`
}

export function runtimePlacement(values: {
  hostingMode: RuntimeHostingMode
  runtime: RuntimeName
  runtimeConfig: Record<string, unknown>
  provider: string | null
  model: string | null
  metadata?: Record<string, unknown>
}) {
  const driver = runtimeDriver(values.runtime)
  const metadata = values.metadata ?? {}
  const runtimeDriverValue =
    typeof metadata.runtimeDriver === 'string'
      ? metadata.runtimeDriver
      : runtimeDriverName(values.runtime, values.hostingMode)
  const runtimeBackend =
    typeof metadata.runtimeBackend === 'string'
      ? metadata.runtimeBackend
      : values.runtime === 'ama' || values.hostingMode === 'cloud'
        ? driver.cloudBackend
        : null
  const runtimeProtocol =
    typeof metadata.runtimeProtocol === 'string'
      ? metadata.runtimeProtocol
      : typeof metadata.runnerProtocol === 'string'
        ? metadata.runnerProtocol
        : values.runtime === 'ama' || values.hostingMode === 'cloud'
          ? driver.cloudProtocol
          : null
  return {
    hostingMode: values.hostingMode,
    runtime: values.runtime,
    runtimeConfig: values.runtimeConfig,
    provider: values.provider,
    model: values.model,
    driver: runtimeDriverValue,
    backend: runtimeBackend,
    protocol: runtimeProtocol,
  }
}
