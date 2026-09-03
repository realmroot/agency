import {
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

type EnvironmentsRpc = typeof v1.environments

export type EnvironmentListResponse = RpcResponseType<EnvironmentsRpc['$get'], 200>
export type Environment = RpcResponseType<EnvironmentsRpc[':environmentId']['$get'], 200>
export type EnvironmentInput = RpcRequestType<EnvironmentsRpc['$post']>['json']
export type EnvironmentPatch = RpcRequestType<EnvironmentsRpc[':environmentId']['$patch']>['json']
export type EnvironmentVersionListResponse = RpcResponseType<EnvironmentsRpc[':environmentId']['versions']['$get'], 200>
export type EnvironmentVersion = ListItem<EnvironmentVersionListResponse>
export type EnvironmentSpec = Environment['spec']
export type EnvironmentStatus = Environment['status']
export type EnvironmentPackages = EnvironmentSpec['packages']
export type EnvironmentVariable = EnvironmentSpec['variables'][string]
export type EnvironmentType = EnvironmentSpec['type']
export type EnvironmentNetworking = EnvironmentSpec['networking']

export const environmentsApi = {
  listEnvironments: (options: ListOptions = {}) =>
    rpcRequest<ListResponse<Environment>>(v1.environments.$get(queryArg<typeof v1.environments.$get>(options))),
  readEnvironment: (id: string) =>
    rpcRequest<Environment>(v1.environments[':environmentId'].$get({ param: { environmentId: id } })),
  createEnvironment: (input: EnvironmentInput) =>
    rpcRequest<Environment>(v1.environments.$post({ json: input, header: { 'idempotency-key': crypto.randomUUID() } })),
  updateEnvironment: (id: string, input: Partial<EnvironmentInput>) =>
    rpcRequest<Environment>(
      v1.environments[':environmentId'].$patch({
        param: { environmentId: id },
        json: input as RpcJson<(typeof v1.environments)[':environmentId']['$patch']>,
      }),
    ),
  deleteEnvironment: (id: string) =>
    rpcRequest<void>(v1.environments[':environmentId'].$delete({ param: { environmentId: id } })),
  listEnvironmentVersions: (id: string) =>
    rpcRequest<ListResponse<EnvironmentVersion>>(
      v1.environments[':environmentId'].versions.$get({ param: { environmentId: id } }),
    ),
}
