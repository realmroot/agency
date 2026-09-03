import {
  type ArrayItem,
  type ListItem,
  type ListOptions,
  type ListResponse,
  queryArg,
  type RpcJson,
  type RpcRequestType,
  type RpcResponseType,
  rpcRequest,
  v1,
} from './core'

type AgentsRpc = typeof v1.agents

export type AgentListResponse = RpcResponseType<AgentsRpc['$get'], 200>
export type Agent = RpcResponseType<AgentsRpc[':agentId']['$get'], 200>
export type AgentInput = RpcRequestType<AgentsRpc['$post']>['json']
export type AgentPatch = RpcRequestType<AgentsRpc[':agentId']['$patch']>['json']
export type AgentVersionListResponse = RpcResponseType<AgentsRpc[':agentId']['versions']['$get'], 200>
export type AgentVersion = ListItem<AgentVersionListResponse>
export type AgentSpec = Agent['spec']
export type AgentStatus = Agent['status']
export type AgentAllowedTool = ArrayItem<AgentSpec['allowedTools']>
export type AgentAllowedToolInput = ArrayItem<NonNullable<AgentInput['spec']['allowedTools']>>
export type ResourceMetadata = Agent['metadata']
export type ResourcePhase = AgentStatus['phase']

export interface AgentListOptions extends ListOptions {
  identityAgentId?: string
}

export const agentsApi = {
  listAgents: (options: AgentListOptions = {}) =>
    rpcRequest<ListResponse<Agent>>(v1.agents.$get(queryArg<typeof v1.agents.$get>(options))),
  readAgent: (id: string) => rpcRequest<Agent>(v1.agents[':agentId'].$get({ param: { agentId: id } })),
  createAgent: (input: AgentInput) =>
    rpcRequest<Agent>(v1.agents.$post({ json: input, header: { 'idempotency-key': crypto.randomUUID() } })),
  updateAgent: (id: string, input: Partial<AgentInput>) =>
    rpcRequest<Agent>(
      v1.agents[':agentId'].$patch({
        param: { agentId: id },
        json: input as RpcJson<(typeof v1.agents)[':agentId']['$patch']>,
      }),
    ),
  deleteAgent: (id: string) => rpcRequest<void>(v1.agents[':agentId'].$delete({ param: { agentId: id } })),
  listAgentVersions: (id: string) =>
    rpcRequest<ListResponse<AgentVersion>>(v1.agents[':agentId'].versions.$get({ param: { agentId: id } })),
}
