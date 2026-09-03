import {
  jsonArg,
  type ListItem,
  type ListOptions,
  type ListResponse,
  paramQueryArg,
  queryArg,
  type RpcJson,
  type RpcRequestType,
  type RpcResponseType,
  rpcRequest,
  v1,
} from './core'

type TriggersRpc = typeof v1.triggers

export type TriggerListResponse = RpcResponseType<TriggersRpc['$get'], 200>
export type Trigger = RpcResponseType<TriggersRpc[':triggerId']['$get'], 200>
export type CreateTriggerInput = RpcRequestType<TriggersRpc['$post']>['json']
export type TriggerInput = RpcRequestType<TriggersRpc[':triggerId']['$patch']>['json']
export type TriggerRunListResponse = RpcResponseType<TriggersRpc[':triggerId']['runs']['$get'], 200>
export type TriggerRun = ListItem<TriggerRunListResponse>
export type TriggerSpec = Trigger['spec']
export type TriggerStatus = Trigger['status']
export type TriggerSource = TriggerSpec['source']
export type TriggerSchedule = Extract<TriggerSource, { type: 'schedule' }>['schedule']
export type TriggerRunSpec = TriggerRun['spec']
export type TriggerRunStatus = TriggerRun['status']
export type RuntimeName = TriggerSpec['template']['spec']['runtime']

export interface TriggerListOptions extends ListOptions {
  suspend?: boolean
}

export const triggersApi = {
  listTriggers: (options: TriggerListOptions = {}) =>
    rpcRequest<ListResponse<Trigger>>(v1.triggers.$get(queryArg<typeof v1.triggers.$get>(options))),
  createTrigger: (input: CreateTriggerInput) =>
    rpcRequest<Trigger>(v1.triggers.$post(jsonArg<typeof v1.triggers.$post>(input))),
  readTrigger: (id: string) => rpcRequest<Trigger>(v1.triggers[':triggerId'].$get({ param: { triggerId: id } })),
  updateTrigger: (id: string, input: Partial<TriggerInput>) =>
    rpcRequest<Trigger>(
      v1.triggers[':triggerId'].$patch({
        param: { triggerId: id },
        json: input as RpcJson<(typeof v1.triggers)[':triggerId']['$patch']>,
      }),
    ),
  deleteTrigger: (id: string) => rpcRequest<void>(v1.triggers[':triggerId'].$delete({ param: { triggerId: id } })),
  listTriggerRuns: (id: string, options: ListOptions = {}) =>
    rpcRequest<ListResponse<TriggerRun>>(
      v1.triggers[':triggerId'].runs.$get(
        paramQueryArg<(typeof v1.triggers)[':triggerId']['runs']['$get']>({ triggerId: id }, options),
      ),
    ),
}
