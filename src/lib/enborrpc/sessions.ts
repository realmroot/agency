import {
  type ArrayItem,
  type JsonListResponse,
  jsonArg,
  type ListOptions,
  paramQueryArg,
  queryArg,
  type RpcRequestType,
  type RpcResponseType,
  rpcRequest,
  v1,
} from './core'

type SessionsRpc = typeof v1.sessions
type SessionRpc = SessionsRpc[':sessionId']

export type SessionListResponse = RpcResponseType<SessionsRpc['$get'], 200>
export type Session = RpcResponseType<SessionRpc['$get'], 200>
export type SessionMessage = RpcResponseType<SessionRpc['messages']['$post'], 201>
export type SessionEventListResponse = JsonListResponse<RpcResponseType<SessionRpc['events']['$get'], 200>>
export type SessionEvent = ArrayItem<SessionEventListResponse['data']>
export type SessionApprovalListResponse = RpcResponseType<SessionRpc['approvals']['$get'], 200>
export type SessionApproval = ArrayItem<SessionApprovalListResponse['data']>
export type SessionInput = RpcRequestType<SessionsRpc['$post']>['json']
export type SessionApprovalDecisionInput = RpcRequestType<SessionRpc['approvals'][':approvalId']['$patch']>['json']
export type SessionState = Session['status']['phase']
export type SessionPlacement = NonNullable<Session['status']['placement']>
export type SessionAgentSnapshot = Session['status']['bindings']['agent']['snapshot']
export type SessionEnvironmentSnapshot = NonNullable<Session['status']['bindings']['environment']['snapshot']>
export type EnvFromEntry = ArrayItem<Session['spec']['envFrom']>
export type Volume = ArrayItem<Session['spec']['volumes']>
export type VolumeMount = ArrayItem<Session['spec']['volumeMounts']>
export type GitRepositoryVolume = Extract<Volume, { type: 'git_repository' }>
export type MemoryStoreVolume = Extract<Volume, { type: 'memory' }>
export type MemoryStoreReadOnly = VolumeMount['readOnly']

export interface SessionListOptions extends ListOptions {
  state?: string
  labelSelector?: string
}

export interface SessionEventListOptions {
  cursor?: number
  order?: 'asc' | 'desc'
  limit?: number
  type?: SessionEvent['type']
  createdFrom?: string
  createdTo?: string
}

export const sessionsApi = {
  listSessions: (options: SessionListOptions = {}) =>
    rpcRequest<SessionListResponse>(v1.sessions.$get(queryArg<typeof v1.sessions.$get>(options))),
  createSession: (input: SessionInput) =>
    rpcRequest<Session>(v1.sessions.$post(jsonArg<typeof v1.sessions.$post>(input))),
  readSession: (id: string) => rpcRequest<Session>(v1.sessions[':sessionId'].$get({ param: { sessionId: id } })),
  closeSession: (id: string) =>
    rpcRequest<Session>(v1.sessions[':sessionId'].$patch({ param: { sessionId: id }, json: { state: 'closed' } })),
  reopenSession: (id: string) =>
    rpcRequest<Session>(v1.sessions[':sessionId'].$patch({ param: { sessionId: id }, json: { state: 'idle' } })),
  deleteSession: (id: string) => rpcRequest<void>(v1.sessions[':sessionId'].$delete({ param: { sessionId: id } })),
  sendSessionMessage: (id: string, content: string) =>
    rpcRequest<SessionMessage>(
      v1.sessions[':sessionId'].messages.$post({ param: { sessionId: id }, json: { type: 'prompt', content } }),
    ),
  listSessionEvents: (id: string, options: SessionEventListOptions = {}) =>
    rpcRequest<SessionEventListResponse>(
      v1.sessions[':sessionId'].events.$get(
        paramQueryArg<(typeof v1.sessions)[':sessionId']['events']['$get']>({ sessionId: id }, options),
      ),
    ),
  listSessionApprovals: (id: string) =>
    rpcRequest<SessionApprovalListResponse>(v1.sessions[':sessionId'].approvals.$get({ param: { sessionId: id } })),
  decideSessionApproval: (id: string, approvalId: string, input: SessionApprovalDecisionInput) =>
    rpcRequest<SessionApproval>(
      v1.sessions[':sessionId'].approvals[':approvalId'].$patch({
        param: { sessionId: id, approvalId },
        json: input,
      }),
    ),
}
