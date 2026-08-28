// Pure provider business rules for the session runtime: provider-id
// canonicalization and the session provider+model resolution. Providers are a
// global vendor catalog with no credentials and no baseUrl, so the session path
// no longer resolves or dispatches any provider connection config.

import type { RuntimeName } from '@shared/runtime-types'
import { vendorFromModelId } from '../model-catalog'

export function canonicalProvider(provider: string): string {
  return provider === 'workers-ai' ? 'cloudflare-workers-ai' : provider
}

export const PLATFORM_DEFAULT_MODEL = '@cf/moonshotai/kimi-k2.6'

const SELF_HOSTED_RUNTIME_PROVIDERS: Record<Exclude<RuntimeName, 'ama'>, string> = {
  'claude-code': 'anthropic',
  codex: 'openai',
  copilot: 'github-copilot',
}

export function resolveAgentExecutionProfile(
  runtime: RuntimeName,
  configuredProvider: string | null,
  configuredModel: string | null,
  defaultCloudModel = PLATFORM_DEFAULT_MODEL,
) {
  const configuredVendor = configuredProvider && configuredProvider !== 'workers-ai' ? configuredProvider : null
  if (runtime === 'ama') {
    const model = configuredModel ?? defaultCloudModel
    return {
      provider: configuredVendor ?? vendorFromModelId(model),
      model,
      policyManaged: true,
    }
  }

  return {
    provider: configuredVendor ?? SELF_HOSTED_RUNTIME_PROVIDERS[runtime],
    model: configuredModel,
    policyManaged: configuredVendor !== null,
  }
}

// Shapes the agent snapshot a runtime turn runs against: drop the sandboxPolicy
// (the runtime gates sandbox operations itself, the snapshot must not re-assert
// it) and normalize skills to an array. Parses the persisted JSON column.
export function parseRuntimeAgentSnapshot(value: string | null) {
  const snapshot = value ? (JSON.parse(value) as Record<string, unknown>) : {}
  const { sandboxPolicy: _sandboxPolicy, ...runtimeSnapshot } = snapshot
  return {
    ...runtimeSnapshot,
    skills: Array.isArray(snapshot.skills) ? snapshot.skills : [],
  }
}

// Single source for the session's runtime provider + model. The session's pinned
// modelProvider wins; otherwise the agent snapshot's provider (falling back to
// the platform default). The model prefers the session modelConfig, then the
// agent snapshot, else null (the engine resolves the provider default).
export function resolveSessionProviderModel(
  session: { modelProvider: string | null },
  agentSnapshot: Record<string, unknown>,
  modelConfig: Record<string, unknown>,
): { provider: string; model: string | null } {
  const provider =
    session.modelProvider ?? (typeof agentSnapshot.provider === 'string' ? agentSnapshot.provider : 'workers-ai')
  const model =
    typeof modelConfig.model === 'string'
      ? modelConfig.model
      : typeof agentSnapshot.model === 'string'
        ? agentSnapshot.model
        : null
  return { provider, model }
}
