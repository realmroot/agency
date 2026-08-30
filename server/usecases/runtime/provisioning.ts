// Create-session provisioning usecases: provider/model resolution, runtime
// capability validation, and the MCP server manifest. Deps-first — they read
// through deps.sessionOrchestration, hold no db handle, and construct no
// adapters.

import type { RuntimeName } from '@server/contracts/environment-contracts'
import { runtimeDriver } from '@server/domain/runtime/driver'
import type { AgentSnapshot, EnvironmentSnapshot } from '@server/domain/runtime/session-snapshot'
import {
  runtimeCatalogSupportsProviderModel,
  runtimesSupport,
  selfHostedRuntimeModel,
} from '@server/domain/runtime-catalog'
import type { AuthScope, ProviderRepo, SessionOrchestrationStore } from '../ports'

type ProvisioningDeps = {
  sessionOrchestration: SessionOrchestrationStore
}

export async function validateRuntimeProviderModel(
  deps: Pick<ProvisioningDeps, 'sessionOrchestration'> & { providers: ProviderRepo },
  auth: AuthScope,
  environmentId: string,
  hostingMode: 'cloud' | 'self_hosted',
  runtime: RuntimeName,
  provider: string | null,
  model: string | null,
) {
  const driver = runtimeDriver(runtime)
  if (!driver.supportsHostingMode(hostingMode)) {
    return false
  }
  if (hostingMode === 'cloud') {
    // Cloud dispatches every model through the Workers AI binding + AI Gateway,
    // so the global catalog (populated by discovery) is the source of truth for
    // what exists. provider is the vendor slug, which is the provider row id.
    if (!provider) return false
    return model
      ? Boolean(await deps.providers.findModel(provider, model))
      : Boolean(await deps.providers.findBySlug(provider))
  }
  // self_hosted: the catalog is a loose pre-filter; the runner's structured
  // runtimes list does the real gating.
  if (provider && !runtimeCatalogSupportsProviderModel(hostingMode, runtime, provider, model)) {
    return false
  }
  const activeRunnerRuntimes = await deps.sessionOrchestration.activeRunnerRuntimes(auth.project.id, environmentId)
  const runnerModel = selfHostedRuntimeModel(provider, model)
  return (
    activeRunnerRuntimes.some((runtimes) => runtimesSupport(runtimes, runtime, runnerModel)) ||
    activeRunnerRuntimes.length === 0
  )
}

export function mcpConnectorIds(snapshot: Record<string, unknown>) {
  const servers = Array.isArray(snapshot.servers) ? (snapshot.servers as unknown[]) : []
  return servers
    .map((server) =>
      server && typeof server === 'object' && 'connectorId' in server ? (server.connectorId as unknown) : null,
    )
    .filter((connectorId): connectorId is string => typeof connectorId === 'string')
}

function endpointUrl(metadata: Record<string, unknown>) {
  const value = metadata.endpointUrl ?? metadata.defaultEndpointUrl
  return typeof value === 'string' && value.length > 0 ? value : null
}

export async function resolveMcpServers(
  deps: ProvisioningDeps,
  _auth: AuthScope,
  _sessionId: string,
  agentSnapshot: AgentSnapshot,
  _environmentSnapshot: EnvironmentSnapshot | null,
) {
  const connectorIds = agentSnapshot.mcpConnectors
  if (connectorIds.length === 0) {
    return { servers: [] }
  }
  const catalog = await deps.sessionOrchestration.mcpCatalogEntries(connectorIds)
  const servers = []
  for (const connector of catalog) {
    if (connector.availability !== 'available') {
      continue
    }
    servers.push({
      connectorId: connector.id,
      name: connector.name,
      endpointUrl: endpointUrl(connector.metadata),
      auth: null,
      tools: connector.tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
        approvalMode: tool.approvalMode,
      })),
    })
  }
  return { servers }
}
