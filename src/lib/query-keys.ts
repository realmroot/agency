export const queryKeys = {
  auth: {
    user: ['auth', 'user'] as const,
  },
  projects: {
    all: ['projects'] as const,
    list: ['projects', 'list'] as const,
  },
  agents: {
    all: ['agents'] as const,
    list: () => ['agents', 'list'] as const,
    detail: (id: string) => ['agents', 'detail', id] as const,
    versions: (id: string) => ['agents', 'detail', id, 'versions'] as const,
  },
  identities: {
    all: ['identities'] as const,
    list: () => ['identities', 'list'] as const,
    detail: (id: string) => ['identities', 'detail', id] as const,
  },
  environments: {
    all: ['environments'] as const,
    list: () => ['environments', 'list'] as const,
    detail: (id: string) => ['environments', 'detail', id] as const,
    versions: (id: string) => ['environments', 'detail', id, 'versions'] as const,
  },
  triggers: {
    all: ['triggers'] as const,
    list: (filters: Record<string, string> = {}) => ['triggers', 'list', filters] as const,
    detail: (id: string) => ['triggers', 'detail', id] as const,
    runs: (id: string) => ['triggers', 'detail', id, 'runs'] as const,
  },
  sessions: {
    all: ['sessions'] as const,
    list: () => ['sessions', 'list'] as const,
    detail: (id: string) => ['sessions', 'detail', id] as const,
  },
  providers: {
    all: ['providers'] as const,
    list: () => ['providers', 'list'] as const,
    detail: (id: string) => ['providers', 'detail', id] as const,
    models: ['providers', 'models'] as const,
  },
  runners: {
    all: ['runners'] as const,
    list: (filters: Record<string, string | boolean | undefined> = {}) => ['runners', 'list', filters] as const,
  },
  vaults: {
    all: ['vaults'] as const,
    list: () => ['vaults', 'list'] as const,
    detail: (id: string) => ['vaults', 'detail', id] as const,
    credentials: (id: string) => ['vaults', 'detail', id, 'credentials'] as const,
    audit: (id: string) => ['vaults', 'detail', id, 'audit'] as const,
  },
  memoryStores: {
    all: ['memory-stores'] as const,
    list: () => ['memory-stores', 'list'] as const,
    detail: (id: string) => ['memory-stores', 'detail', id] as const,
    memories: (id: string) => ['memory-stores', 'detail', id, 'memories'] as const,
  },
  connectors: {
    all: ['connectors'] as const,
    list: (filters: Record<string, string> = {}) => ['connectors', 'list', filters] as const,
    detail: (connectorId: string) => ['connectors', 'detail', connectorId] as const,
  },
  usage: {
    summary: (filters: object = {}) => ['usage', 'summary', filters] as const,
  },
  audit: {
    records: (filters: object = {}) => ['audit', 'records', filters] as const,
    record: (id: string) => ['audit', 'record', id] as const,
  },
}
