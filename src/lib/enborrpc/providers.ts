import {
  type ListItem,
  type ListOptions,
  type ListResponse,
  queryArg,
  type RpcResponseType,
  rpcRequest,
  v1,
} from './core'

type ProvidersRpc = typeof v1.providers

export type ProviderListResponse = RpcResponseType<ProvidersRpc['$get'], 200>
export type Provider = RpcResponseType<ProvidersRpc[':providerId']['$get'], 200>
export type ProviderModelListResponse = RpcResponseType<ProvidersRpc['models']['$get'], 200>
export type ProviderModel = ListItem<ProviderModelListResponse>
export type CatalogRefreshResult = RpcResponseType<ProvidersRpc['refresh']['$post'], 200>

export const providersApi = {
  listProviders: (options: ListOptions = {}) =>
    rpcRequest<ListResponse<Provider>>(v1.providers.$get(queryArg<typeof v1.providers.$get>(options))),
  listModels: () => rpcRequest<ListResponse<ProviderModel>>(v1.providers.models.$get()),
  readProvider: (id: string) => rpcRequest<Provider>(v1.providers[':providerId'].$get({ param: { providerId: id } })),
  listProviderModels: (id: string) =>
    rpcRequest<ListResponse<ProviderModel>>(v1.providers[':providerId'].models.$get({ param: { providerId: id } })),
  refreshCatalog: () => rpcRequest<CatalogRefreshResult>(v1.providers.refresh.$post()),
}
