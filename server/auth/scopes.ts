export const AMA_RESOURCE_PATH = '/api'
export const AMA_RESOURCE_NAME = 'Any Managed Agents API'
export const AMA_RESOURCE_DESCRIPTION =
  'Realmroot-protected control plane for managed Agents, environments, sessions, runners, governance, usage, and audit.'

const resourceNames = [
  'agents',
  'audit-records',
  'auth',
  'budgets',
  'connectors',
  'environments',
  'leases',
  'memory-stores',
  'projects',
  'providers',
  'runners',
  'sessions',
  'triggers',
  'usage-records',
  'usage-summary',
  'vaults',
  'work-items',
] as const

export const AMA_SCOPES = resourceNames.flatMap((resource) => [`${resource}:read`, `${resource}:write`] as const)

export function requiredScope(method: string, requestUrl: string) {
  const pathname = new URL(requestUrl).pathname
  if (/^\/api\/v1\/sessions\/[^/]+\/socket$/.test(pathname)) return 'sessions:write'
  if (/^\/api\/v1\/runners\/[^/]+\/channel$/.test(pathname)) return 'runners:write'
  const apiMatch = /^\/api\/v1\/([^/]+)/.exec(pathname)
  const resource = apiMatch?.[1] ?? (pathname.startsWith('/runtime/') ? 'sessions' : null)
  if (!resource || !resourceNames.includes(resource as (typeof resourceNames)[number])) return null
  const operation = method === 'GET' || method === 'HEAD' ? 'read' : 'write'
  return `${resource}:${operation}`
}

export function protectedResourceMetadata(origin: string, issuer: string) {
  return {
    resource: `${origin}${AMA_RESOURCE_PATH}`,
    authorization_servers: [issuer],
    scopes_supported: AMA_SCOPES,
    bearer_methods_supported: [],
    resource_name: AMA_RESOURCE_NAME,
    dpop_signing_alg_values_supported: ['ES256'],
    dpop_bound_access_tokens_required: true,
  }
}
