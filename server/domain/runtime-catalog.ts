export const RUNTIME_PROVIDER_MODEL_CAPABILITY_PREFIX = 'runtime-provider-model'

export type RuntimeHostingMode = 'cloud' | 'self_hosted'
export type RuntimeName = 'ama' | 'claude-code' | 'codex' | 'copilot'

type RuntimeCatalogEntry = {
  runtime: RuntimeName
  hostingModes: RuntimeHostingMode[]
  providerModels: Array<{ provider: string; model: string; displayName?: string }>
}

// Self-hosted CLI runtimes accept any model ('*'): the host CLI owns the
// model universe and a lease fails naturally if the host cannot serve it.
// Pinning a single id here rejected legitimate models (e.g. opus on
// claude-code) at session creation. Cloud stays pinned to platform models.
export const RUNTIME_CATALOG: readonly RuntimeCatalogEntry[] = [
  {
    runtime: 'ama',
    hostingModes: ['cloud', 'self_hosted'],
    // Models are no longer hardcoded here. Cloud validates the provider/model
    // against the GLOBAL catalog (server/domain/model-catalog.ts populated by
    // discovery), and self-hosted gates on the runner's declared capabilities —
    // so ama declares a wildcard like the other runtimes.
    providerModels: [{ provider: '*', model: '*' }],
  },
  {
    runtime: 'claude-code',
    hostingModes: ['self_hosted'],
    providerModels: [{ provider: '*', model: '*' }],
  },
  {
    runtime: 'codex',
    hostingModes: ['self_hosted'],
    providerModels: [{ provider: '*', model: '*' }],
  },
  {
    runtime: 'copilot',
    hostingModes: ['self_hosted'],
    providerModels: [{ provider: '*', model: '*' }],
  },
]

// Runtimes whose active bridge handle accepts mid-run prompt injection over the
// runner session channel. The CLI-backed runtime bridge implements `send` for
// claude-code, codex, and copilot, while ama owns continuation turns natively.
const LIVE_PROMPT_RUNTIMES: ReadonlySet<RuntimeName> = new Set(['ama', 'claude-code', 'codex', 'copilot'])

export function runtimeSupportsLivePrompts(runtime: RuntimeName) {
  return LIVE_PROMPT_RUNTIMES.has(runtime)
}

export function runtimeProviderModelCapability(runtime: RuntimeName, provider: string, model: string) {
  return `${RUNTIME_PROVIDER_MODEL_CAPABILITY_PREFIX}:${runtime}:${provider}:${model}`
}

export function runtimeRequiredRunnerCapability(runtime: RuntimeName, provider: string, model?: string | null) {
  if (runtime === 'ama') {
    return runtime
  }
  if (!model) {
    return runtime
  }
  const entry = RUNTIME_CATALOG.find((item) => item.runtime === runtime)
  // Wildcard-provider entries (including wildcard-model ones) normalize the
  // provider segment to '*': runners enumerate host models without knowing
  // platform provider ids, so they declare '*' as the provider.
  // The `candidate.model === model` arm matches a wildcard-provider entry pinned
  // to a specific model; no current RUNTIME_CATALOG entry has that shape (every
  // wildcard-provider runtime is wildcard-model), so v8 cannot reach it — a
  // catalog-growth guard, not dead code.
  /* v8 ignore start */
  const wildcard = entry?.providerModels.find(
    (candidate) => candidate.provider === '*' && (candidate.model === '*' || candidate.model === model),
  )
  /* v8 ignore stop */
  return runtimeProviderModelCapability(runtime, wildcard ? '*' : provider, model)
}

// TRANSITIONAL: runners deployed before host model enumeration declare the
// bare runtime name plus a single hardcoded model, so the specific model
// capability may be missing even though the host CLI serves the model. For
// wildcard-model runtimes the bare runtime capability therefore still counts
// as model support. Removable once the runner fleet advertises enumerated
// per-model capabilities.
export function transitionalRuntimeLevelRuntimes(): RuntimeName[] {
  return RUNTIME_CATALOG.filter((entry) => entry.providerModels.some((candidate) => candidate.model === '*')).map(
    (entry) => entry.runtime,
  )
}

export function runnerSupportsRuntimeProviderModel(
  capabilities: string[],
  runtime: RuntimeName,
  provider: string,
  model?: string | null,
) {
  if (runtime === 'ama') {
    return capabilities.includes(runtime)
  }
  if (!model) {
    return (
      capabilities.includes(runtime) ||
      capabilities.some((capability) =>
        capability.startsWith(`${RUNTIME_PROVIDER_MODEL_CAPABILITY_PREFIX}:${runtime}:`),
      )
    )
  }
  if (
    capabilities.includes(runtimeProviderModelCapability(runtime, provider, model)) ||
    capabilities.includes(runtimeProviderModelCapability(runtime, '*', model))
  ) {
    return true
  }
  // TRANSITIONAL fallback — see transitionalRuntimeLevelRuntimes.
  return transitionalRuntimeLevelRuntimes().includes(runtime) && capabilities.includes(runtime)
}

export function runtimeCatalogSupportsProviderModel(
  hostingMode: RuntimeHostingMode,
  runtime: RuntimeName,
  provider: string,
  model?: string | null,
) {
  const entry = RUNTIME_CATALOG.find((item) => item.runtime === runtime)
  if (!entry?.hostingModes.includes(hostingMode)) {
    return false
  }
  // Every runtime entry now declares a wildcard provider/model, so a hosting-mode
  // match suffices here — the real provider/model gating is the global catalog
  // (cloud) and runner capabilities (self-hosted). The concrete-match arms below
  // are a growth guard for a future pinned catalog entry.
  if (entry.providerModels.every((capability) => capability.provider === '*' && capability.model === '*')) {
    return true
  }
  /* v8 ignore start -- catalog-growth guard: no current RUNTIME_CATALOG entry pins a provider/model */
  if (!model) {
    return entry.providerModels.some((capability) => capability.provider === '*' || capability.provider === provider)
  }
  return entry.providerModels.some(
    (capability) =>
      (capability.provider === '*' || capability.provider === provider) &&
      (capability.model === '*' || capability.model === model),
  )
  /* v8 ignore stop */
}

export function runtimeSupportsHostingMode(hostingMode: RuntimeHostingMode, runtime: RuntimeName) {
  return RUNTIME_CATALOG.some((entry) => entry.runtime === runtime && entry.hostingModes.includes(hostingMode))
}

export const DEFAULT_AI_GATEWAY_ID = 'ama'

// Pure cloud-model routing rule. Third-party ({vendor}/{model}) cloud models
// bill through AI Gateway and must name a gateway (configurable, default 'ama').
// '@cf/' models stay gateway-free: they run on the free Workers AI allocation,
// and forcing a not-yet-created named gateway returns 400 for them too. The
// effectful env read stays at the adapter egress; this seam only decides which
// gateway routes a given model id.
export function aiGatewayFor(modelId: string, gatewayId: string | undefined) {
  return modelId.startsWith('@cf/') ? undefined : { id: gatewayId || DEFAULT_AI_GATEWAY_ID }
}
