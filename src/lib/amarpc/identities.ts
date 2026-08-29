import {
  type ListOptions,
  type ListResponse,
  queryArg,
  type RpcRequestType,
  type RpcResponseType,
  rpcRequest,
  v1,
} from './core'

type IdentitiesRpc = typeof v1.identities

export type Identity = RpcResponseType<IdentitiesRpc[':identityId']['$get'], 200>
export type IdentityInput = RpcRequestType<IdentitiesRpc['$post']>['json']
export type IdentityRuntime = Identity['spec']['runtime']

export const identitiesApi = {
  listIdentities: (options: ListOptions = {}) =>
    rpcRequest<ListResponse<Identity>>(v1.identities.$get(queryArg<typeof v1.identities.$get>(options))),
  readIdentity: (id: string) => rpcRequest<Identity>(v1.identities[':identityId'].$get({ param: { identityId: id } })),
  createIdentity: (input: IdentityInput, idempotencyKey: string) =>
    rpcRequest<Identity>(v1.identities.$post({ header: { 'idempotency-key': idempotencyKey }, json: input })),
  archiveIdentity: (id: string) =>
    rpcRequest<Identity>(v1.identities[':identityId'].$patch({ param: { identityId: id }, json: { archived: true } })),
}
