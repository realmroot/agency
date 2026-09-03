import { type ListOptions, queryArg, type RpcResponseType, rpcRequest, v1 } from './core'

type RunnersRpc = typeof v1.runners

export type RunnerListResponse = RpcResponseType<RunnersRpc['$get'], 200>
export type Runner = RunnerListResponse['data'][number]

export interface RunnerListOptions extends ListOptions {
  state?: Runner['state']
  environmentId?: string
}

export const runnersApi = {
  listRunners: (options: RunnerListOptions = {}) =>
    rpcRequest<RunnerListResponse>(v1.runners.$get(queryArg<typeof v1.runners.$get>(options))),
}
