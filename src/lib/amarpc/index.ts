export * from './agents'
export * from './audit'
export * from './auth'
export * from './connectors'
export type { ListOptions, ListPagination, ListResponse } from './core'
export { ApiError } from './core'
export * from './environments'
export * from './memory-stores'
export * from './projects'
export * from './providers'
export * from './runners'
export * from './sessions'
export * from './triggers'
export * from './usage'
export * from './vaults'

import { agentsApi } from './agents'
import { auditApi } from './audit'
import { authApi } from './auth'
import { connectorsApi } from './connectors'
import { environmentsApi } from './environments'
import { memoryStoresApi } from './memory-stores'
import { projectsApi } from './projects'
import { providersApi } from './providers'
import { runnersApi } from './runners'
import { sessionsApi } from './sessions'
import { triggersApi } from './triggers'
import { usageApi } from './usage'
import { vaultsApi } from './vaults'

export const api = {
  ...authApi,
  ...projectsApi,
  ...agentsApi,
  ...environmentsApi,
  ...triggersApi,
  ...sessionsApi,
  ...providersApi,
  ...runnersApi,
  ...vaultsApi,
  ...memoryStoresApi,
  ...connectorsApi,
  ...usageApi,
  ...auditApi,
}
