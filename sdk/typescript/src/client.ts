// Stable facades generated from sdk/spec/resources.json.
// The generated OpenAPI layer owns HTTP shapes; this file owns SDK shape.

import { createClient, createConfig } from './generated/client/index.js'
import * as ops from './generated/sdk.gen.js'
import type * as types from './generated/types.gen.js'

export interface EnborClientConfig {
  baseUrl: string
  projectId?: string
  headers?: Record<string, string>
  authorize?: (url: string, method: string) => Promise<{ accessToken: string; dpopProof: string }>
}

export interface EnborRunnerClientConfig {
  baseUrl: string
  projectId?: string
  headers?: Record<string, string>
  webSocketFactory?: (url: string, headers: Record<string, string>) => WebSocket | Promise<WebSocket>
}

export class EnborApiError extends Error {
  constructor(
    readonly status: number | undefined,
    readonly responseText: string,
    readonly body: unknown,
  ) {
    super(`Enbor API request failed${status === undefined ? '' : ` with HTTP ${status}`}`)
    this.name = 'EnborApiError'
  }
}

async function unwrap<TData>(call: Promise<{ data: TData | undefined; error?: unknown; response?: Response }>): Promise<TData> {
  const { data, error, response } = await call
  if (response?.ok && error === undefined) {
    return data as TData
  }
  const body = error ?? data
  throw new EnborApiError(response?.status, typeof body === 'string' ? body : JSON.stringify(body ?? {}), body)
}

export interface SessionStream {
  events: AsyncIterable<types.SessionEvent>
  send(message: types.SessionSocketClientMessage): Promise<void>
  backfill(options?: { cursor?: number; limit?: number; eventType?: string }): Promise<types.SessionSocketBackfillMessage>
  close(): void
}

export interface RunnerChannel {
  messages: AsyncIterable<types.RunnerChannelMessage>
  send(message: types.RunnerChannelMessage): Promise<void>
  close(): void
}

type SessionSocketServerMessage =
  | { type: 'event'; record: types.SessionEvent }
  | (types.SessionSocketBackfillMessage & { type: 'backfill' })
  | { type: 'runner_unavailable'; message: string }

function websocketURL(config: Pick<EnborClientConfig, 'baseUrl' | 'projectId'>, path: string): URL {
  const url = new URL(path, config.baseUrl)
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
  if (config.projectId) {
    url.searchParams.set('x-ama-project-id', config.projectId)
  }
  return url
}

function base64Url(value: string): string {
  const bytes = new TextEncoder().encode(value)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
}

async function authenticatedWebSocket(config: EnborClientConfig, path: string): Promise<WebSocket> {
  if (!config.authorize) throw new Error('Realmroot DPoP authorizer is required for Enbor WebSocket connections')
  const url = websocketURL(config, path)
  const authorization = await config.authorize(url.toString().replace(/^ws/, 'http'), 'GET')
  return new WebSocket(url.toString(), [
    'ama-dpop',
    `ama-access.${base64Url(authorization.accessToken)}`,
    `ama-proof.${base64Url(authorization.dpopProof)}`,
  ])
}

async function runnerWebSocket(config: EnborRunnerClientConfig, path: string): Promise<WebSocket> {
  if (!config.webSocketFactory) throw new Error('Runner WebSocket factory with Bearer header support is required')
  const headers = Object.fromEntries(
    Object.entries(config.headers ?? {}).filter(([name]) => name.toLowerCase() !== 'dpop'),
  )
  const authorization = Object.entries(headers).find(([name]) => name.toLowerCase() === 'authorization')?.[1]
  if (!authorization || !/^Bearer [^ ]+$/.test(authorization)) {
    throw new Error('Runner WebSocket requires an Authorization: Bearer header')
  }
  if (config.projectId) headers['x-ama-project-id'] = config.projectId
  return config.webSocketFactory(websocketURL(config, path).toString(), headers)
}

async function createSessionStream(config: EnborClientConfig, sessionId: string): Promise<SessionStream> {
  const socket = await authenticatedWebSocket(config, `/api/v1/sessions/${encodeURIComponent(sessionId)}/socket`)
  const buffered: types.SessionEvent[] = []
  const waiters: Array<(result: IteratorResult<types.SessionEvent>) => void> = []
  const backfillWaiters = new Map<string, (response: types.SessionSocketBackfillMessage) => void>()
  let done = false

  const drainDone = () => {
    done = true
    for (const resolve of waiters.splice(0)) {
      resolve({ value: undefined, done: true })
    }
  }

  socket.addEventListener('message', (event: MessageEvent) => {
    const message = JSON.parse(typeof event.data === 'string' ? event.data : '') as SessionSocketServerMessage
    if (message.type === 'event') {
      const waiter = waiters.shift()
      if (waiter) {
        waiter({ value: message.record, done: false })
      } else {
        buffered.push(message.record)
      }
    } else if (message.type === 'backfill') {
      const resolve = message.requestId ? backfillWaiters.get(message.requestId) : undefined
      if (message.requestId) {
        backfillWaiters.delete(message.requestId)
      }
      resolve?.(message)
    }
  })
  socket.addEventListener('close', drainDone)

  const ready = new Promise<void>((resolve, reject) => {
    socket.addEventListener('open', () => resolve())
    socket.addEventListener('error', () => reject(new Error('Session socket failed to open')))
  })

  let backfillSeq = 0
  return {
    events: {
      [Symbol.asyncIterator]() {
        return {
          next(): Promise<IteratorResult<types.SessionEvent>> {
            const value = buffered.shift()
            if (value !== undefined) {
              return Promise.resolve({ value, done: false })
            }
            if (done) {
              return Promise.resolve({ value: undefined, done: true })
            }
            return new Promise((resolve) => waiters.push(resolve))
          },
        }
      },
    },
    async send(message) {
      await ready
      socket.send(JSON.stringify(message))
    },
    async backfill(options = {}) {
      await ready
      const requestId = `bf_${(backfillSeq += 1)}`
      const response = new Promise<types.SessionSocketBackfillMessage>((resolve) => backfillWaiters.set(requestId, resolve))
      socket.send(JSON.stringify({ type: 'backfill', requestId, ...options }))
      return response
    },
    close() {
      socket.close()
    },
  }
}

async function createRunnerChannel(config: EnborRunnerClientConfig, runnerId: string): Promise<RunnerChannel> {
  const socket = await runnerWebSocket(config, `/api/v1/runners/${encodeURIComponent(runnerId)}/channel`)
  const buffered: types.RunnerChannelMessage[] = []
  const waiters: Array<(result: IteratorResult<types.RunnerChannelMessage>) => void> = []
  let done = false

  const drainDone = () => {
    done = true
    for (const resolve of waiters.splice(0)) {
      resolve({ value: undefined, done: true })
    }
  }

  socket.addEventListener('message', (event: MessageEvent) => {
    const message = JSON.parse(typeof event.data === 'string' ? event.data : '') as types.RunnerChannelMessage
    const waiter = waiters.shift()
    if (waiter) {
      waiter({ value: message, done: false })
    } else {
      buffered.push(message)
    }
  })
  socket.addEventListener('close', drainDone)

  const ready = new Promise<void>((resolve, reject) => {
    socket.addEventListener('open', () => resolve())
    socket.addEventListener('error', () => reject(new Error('Runner channel failed to open')))
  })

  return {
    messages: {
      [Symbol.asyncIterator]() {
        return {
          next(): Promise<IteratorResult<types.RunnerChannelMessage>> {
            const value = buffered.shift()
            if (value !== undefined) {
              return Promise.resolve({ value, done: false })
            }
            if (done) {
              return Promise.resolve({ value: undefined, done: true })
            }
            return new Promise((resolve) => waiters.push(resolve))
          },
        }
      },
    },
    async send(message) {
      await ready
      socket.send(JSON.stringify(message))
    },
    close() {
      socket.close()
    },
  }
}

function createConfiguredClient(config: EnborClientConfig | EnborRunnerClientConfig) {
  const authenticatedFetch: typeof fetch = async (input, init) => {
    const request = new Request(input, init)
    const headers = new Headers(request.headers)
    if ('authorize' in config && config.authorize) {
      const authorization = await config.authorize(request.url, request.method)
      headers.set('authorization', `DPoP ${authorization.accessToken}`)
      headers.set('dpop', authorization.dpopProof)
    }
    return fetch(new Request(request, { headers }))
  }
  return createClient(
    createConfig({
      baseUrl: config.baseUrl,
      fetch: authenticatedFetch,
      headers: {
        ...(config.projectId ? { 'x-ama-project-id': config.projectId } : {}),
        ...config.headers,
      },
    }),
  )
}

export type EnborClient = ReturnType<typeof createEnborClient>

export function createEnborClient(config: EnborClientConfig) {
  const client = createConfiguredClient(config)

  return {
    raw: client,

    configz: {
      get: () => unwrap(ops.readConfigz({ client })),
    },

    auth: {
      config: (query?: types.ReadAuthConfigData['query']) => unwrap(ops.readAuthConfig({ client, query })),
      currentSession: () => unwrap(ops.readCurrentAuthSession({ client })),
    },

    projects: {
      list: (query?: types.ListProjectsData['query']) => unwrap(ops.listProjects({ client, query })),
      create: (body: types.CreateProjectRequest) => unwrap(ops.createProject({ client, body })),
      get: (projectId: string) => unwrap(ops.readProject({ client, path: { projectId } })),
      update: (projectId: string, body: types.UpdateProjectRequest) => unwrap(ops.updateProject({ client, path: { projectId }, body })),
      delete: (projectId: string) => unwrap(ops.deleteProject({ client, path: { projectId } })),
    },

    agents: {
      list: (query?: types.ListAgentsData['query']) => unwrap(ops.listAgents({ client, query })),
      create: (body: types.CreateAgentRequest, idempotencyKey?: string) => unwrap(ops.createAgent({ client, body, headers: { "idempotency-key": idempotencyKey } })),
      get: (agentId: string) => unwrap(ops.readAgent({ client, path: { agentId } })),
      update: (agentId: string, body: types.UpdateAgentRequest) => unwrap(ops.updateAgent({ client, path: { agentId }, body })),
      delete: (agentId: string) => unwrap(ops.deleteAgent({ client, path: { agentId } })),
      listVersions: (agentId: string) => unwrap(ops.listAgentVersions({ client, path: { agentId } })),
      getVersion: (agentId: string, version: number) => unwrap(ops.readAgentVersion({ client, path: { agentId, version } })),
    },

    identities: {
      list: (query?: types.ListIdentitiesData['query']) => unwrap(ops.listIdentities({ client, query })),
      create: (body: types.CreateIdentityRequest, idempotencyKey: string) => unwrap(ops.createIdentity({ client, body, headers: { "idempotency-key": idempotencyKey } })),
      get: (identityId: string) => unwrap(ops.readIdentity({ client, path: { identityId } })),
      delete: (identityId: string) => unwrap(ops.deleteIdentity({ client, path: { identityId } })),
    },

    environments: {
      list: (query?: types.ListEnvironmentsData['query']) => unwrap(ops.listEnvironments({ client, query })),
      create: (body: types.CreateEnvironmentRequest, idempotencyKey?: string) => unwrap(ops.createEnvironment({ client, body, headers: { "idempotency-key": idempotencyKey } })),
      get: (environmentId: string) => unwrap(ops.readEnvironment({ client, path: { environmentId } })),
      update: (environmentId: string, body: types.UpdateEnvironmentRequest) => unwrap(ops.updateEnvironment({ client, path: { environmentId }, body })),
      delete: (environmentId: string) => unwrap(ops.deleteEnvironment({ client, path: { environmentId } })),
      listVersions: (environmentId: string) => unwrap(ops.listEnvironmentVersions({ client, path: { environmentId } })),
      getVersion: (environmentId: string, version: number) => unwrap(ops.readEnvironmentVersion({ client, path: { environmentId, version } })),
    },

    providers: {
      list: () => unwrap(ops.listProviders({ client })),
      listModels: () => unwrap(ops.listModels({ client })),
      refreshCatalog: () => unwrap(ops.refreshCatalog({ client })),
      get: (providerId: string) => unwrap(ops.readProvider({ client, path: { providerId } })),
      listProviderModels: (providerId: string) => unwrap(ops.listProviderModels({ client, path: { providerId } })),
    },

    runners: {
      list: (query?: types.ListRunnersData['query']) => unwrap(ops.listRunners({ client, query })),
      create: (body: types.CreateRunnerRequest) => unwrap(ops.createRunner({ client, body })),
      get: (runnerId: string) => unwrap(ops.readRunner({ client, path: { runnerId } })),
      update: (runnerId: string, body: types.UpdateRunnerRequest) => unwrap(ops.updateRunner({ client, path: { runnerId }, body })),
      delete: (runnerId: string) => unwrap(ops.deleteRunner({ client, path: { runnerId } })),
    },

    budgets: {
      list: () => unwrap(ops.listBudgets({ client })),
      create: (body: types.CreateBudgetRequest) => unwrap(ops.createBudget({ client, body })),
      get: (budgetId: string) => unwrap(ops.readBudget({ client, path: { budgetId } })),
      update: (budgetId: string, body: types.UpdateBudgetRequest) => unwrap(ops.updateBudget({ client, path: { budgetId }, body })),
      delete: (budgetId: string) => unwrap(ops.deleteBudget({ client, path: { budgetId } })),
    },

    connectors: {
      list: (query?: types.ListConnectorsData['query']) => unwrap(ops.listConnectors({ client, query })),
      get: (connectorId: string) => unwrap(ops.readConnector({ client, path: { connectorId } })),
    },

    audit: {
      listRecords: (query?: types.ListAuditRecordsData['query']) => unwrap(ops.listAuditRecords({ client, query })),
      getRecord: (recordId: string) => unwrap(ops.readAuditRecord({ client, path: { recordId } })),
    },

    triggers: {
      list: (query?: types.ListTriggersData['query']) => unwrap(ops.listTriggers({ client, query })),
      create: (body: types.CreateTriggerRequest) => unwrap(ops.createTrigger({ client, body })),
      get: (triggerId: string) => unwrap(ops.readTrigger({ client, path: { triggerId } })),
      update: (triggerId: string, body: types.UpdateTriggerRequest) => unwrap(ops.updateTrigger({ client, path: { triggerId }, body })),
      delete: (triggerId: string) => unwrap(ops.deleteTrigger({ client, path: { triggerId } })),
      listRuns: (triggerId: string, query?: types.ListTriggerRunsData['query']) => unwrap(ops.listTriggerRuns({ client, path: { triggerId }, query })),
      createRun: (triggerId: string, body: types.CreateHttpTriggerRunRequest, options?: { headers?: Record<string, string> }) => unwrap(ops.createTriggerRun({ client, path: { triggerId }, body, headers: options?.headers })),
      getRun: (triggerId: string, runId: string) => unwrap(ops.readTriggerRun({ client, path: { triggerId, runId } })),
    },

    sessions: {
      list: (query?: types.ListSessionsData['query']) => unwrap(ops.listSessions({ client, query })),
      create: (body: types.CreateSessionRequest) => unwrap(ops.createSession({ client, body })),
      get: (sessionId: string) => unwrap(ops.readSession({ client, path: { sessionId } })),
      update: (sessionId: string, body: types.UpdateSessionRequest) => unwrap(ops.updateSession({ client, path: { sessionId }, body })),
      delete: (sessionId: string) => unwrap(ops.deleteSession({ client, path: { sessionId } })),
      stream: (sessionId: string): Promise<SessionStream> => createSessionStream(config, sessionId),
      listMessages: (sessionId: string, query?: types.ListSessionMessagesData['query']) => unwrap(ops.listSessionMessages({ client, path: { sessionId }, query })),
      createMessage: (sessionId: string, body: types.CreateSessionMessageRequest) => unwrap(ops.createSessionMessage({ client, path: { sessionId }, body })),
      getMessage: (sessionId: string, messageId: string) => unwrap(ops.readSessionMessage({ client, path: { sessionId, messageId } })),
      listEvents: (sessionId: string, query?: types.ListSessionEventsData['query']) => unwrap(ops.listSessionEvents({ client, path: { sessionId }, query })),
      listApprovals: (sessionId: string) => unwrap(ops.listSessionApprovals({ client, path: { sessionId } })),
      getApproval: (sessionId: string, approvalId: string) => unwrap(ops.readSessionApproval({ client, path: { sessionId, approvalId } })),
      decideApproval: (sessionId: string, approvalId: string, body: types.SessionApprovalDecisionRequest) => unwrap(ops.decideSessionApproval({ client, path: { sessionId, approvalId }, body })),
    },

    memoryStores: {
      list: (query?: types.ListMemoryStoresData['query']) => unwrap(ops.listMemoryStores({ client, query })),
      create: (body: types.CreateMemoryStoreRequest) => unwrap(ops.createMemoryStore({ client, body })),
      get: (storeId: string) => unwrap(ops.readMemoryStore({ client, path: { storeId } })),
      update: (storeId: string, body: types.UpdateMemoryStoreRequest) => unwrap(ops.updateMemoryStore({ client, path: { storeId }, body })),
      delete: (storeId: string) => unwrap(ops.deleteMemoryStore({ client, path: { storeId } })),
      listMemories: (storeId: string, query?: types.ListMemoryStoreMemoriesData['query']) => unwrap(ops.listMemoryStoreMemories({ client, path: { storeId }, query })),
      createMemory: (storeId: string, body: types.CreateMemoryStoreMemoryRequest) => unwrap(ops.createMemoryStoreMemory({ client, path: { storeId }, body })),
      updateMemory: (storeId: string, memoryId: string, body: types.UpdateMemoryStoreMemoryRequest) => unwrap(ops.updateMemoryStoreMemory({ client, path: { storeId, memoryId }, body })),
      deleteMemory: (storeId: string, memoryId: string) => unwrap(ops.deleteMemoryStoreMemory({ client, path: { storeId, memoryId } })),
    },

    vaults: {
      list: (query?: types.ListVaultsData['query']) => unwrap(ops.listVaults({ client, query })),
      create: (body: types.CreateVaultRequest) => unwrap(ops.createVault({ client, body })),
      get: (vaultId: string) => unwrap(ops.readVault({ client, path: { vaultId } })),
      update: (vaultId: string, body: types.UpdateVaultRequest) => unwrap(ops.updateVault({ client, path: { vaultId }, body })),
      delete: (vaultId: string) => unwrap(ops.deleteVault({ client, path: { vaultId } })),
      listCredentials: (vaultId: string, query?: types.ListVaultCredentialsData['query']) => unwrap(ops.listVaultCredentials({ client, path: { vaultId }, query })),
      createCredential: (vaultId: string, body: types.CreateVaultCredentialRequest) => unwrap(ops.createVaultCredential({ client, path: { vaultId }, body })),
      getCredential: (vaultId: string, credentialId: string) => unwrap(ops.readVaultCredential({ client, path: { vaultId, credentialId } })),
      updateCredential: (vaultId: string, credentialId: string, body: types.UpdateVaultCredentialRequest) => unwrap(ops.updateVaultCredential({ client, path: { vaultId, credentialId }, body })),
      updateCredentialSecret: (vaultId: string, credentialId: string, body: types.UpdateVaultCredentialSecretRequest) => unwrap(ops.updateVaultCredentialSecret({ client, path: { vaultId, credentialId }, body })),
      listCredentialVersions: (vaultId: string, credentialId: string, query?: types.ListVaultCredentialVersionsData['query']) => unwrap(ops.listVaultCredentialVersions({ client, path: { vaultId, credentialId }, query })),
      getCredentialVersion: (vaultId: string, credentialId: string, versionId: string) => unwrap(ops.readVaultCredentialVersion({ client, path: { vaultId, credentialId, versionId } })),
    },

    usage: {
      listRecords: (query?: types.ListUsageRecordsData['query']) => unwrap(ops.listUsageRecords({ client, query })),
      getRecord: (recordId: string) => unwrap(ops.readUsageRecord({ client, path: { recordId } })),
      getSummary: (query?: types.ReadUsageSummaryData['query']) => unwrap(ops.readUsageSummary({ client, query })),
    },
  }
}

export type EnborRunnerClient = ReturnType<typeof createEnborRunnerClient>

export function createEnborRunnerClient(config: EnborRunnerClientConfig) {
  const client = createConfiguredClient(config)

  return {
    raw: client,

    configz: {
      get: () => unwrap(ops.readConfigz({ client })),
    },

    runners: {
      list: (query?: types.ListRunnersData['query']) => unwrap(ops.listRunners({ client, query })),
      create: (body: types.CreateRunnerRequest) => unwrap(ops.createRunner({ client, body })),
      get: (runnerId: string) => unwrap(ops.readRunner({ client, path: { runnerId } })),
      update: (runnerId: string, body: types.UpdateRunnerRequest) => unwrap(ops.updateRunner({ client, path: { runnerId }, body })),
      delete: (runnerId: string) => unwrap(ops.deleteRunner({ client, path: { runnerId } })),
      channel: (runnerId: string): Promise<RunnerChannel> => createRunnerChannel(config, runnerId),
      getHeartbeat: (runnerId: string) => unwrap(ops.readRunnerHeartbeat({ client, path: { runnerId } })),
      putHeartbeat: (runnerId: string, body: types.PutRunnerHeartbeatRequest) => unwrap(ops.putRunnerHeartbeat({ client, path: { runnerId }, body })),
    },

    workItems: {
      list: (query?: types.ListWorkItemsData['query']) => unwrap(ops.listWorkItems({ client, query })),
      get: (workItemId: string) => unwrap(ops.readWorkItem({ client, path: { workItemId } })),
    },

    leases: {
      list: (query?: types.ListLeasesData['query']) => unwrap(ops.listLeases({ client, query })),
      create: (body: types.CreateLeaseRequest) => unwrap(ops.createLease({ client, body })),
      get: (leaseId: string) => unwrap(ops.readLease({ client, path: { leaseId } })),
      update: (leaseId: string, body: types.UpdateLeaseRequest) => unwrap(ops.updateLease({ client, path: { leaseId }, body })),
    },

    sessions: {
      createEvents: (sessionId: string, body: types.CreateSessionEventsRequest) => unwrap(ops.createSessionEvents({ client, path: { sessionId }, body })),
    },
  }
}
