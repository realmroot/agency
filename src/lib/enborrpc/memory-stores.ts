import {
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

type MemoryStoresRpc = (typeof v1)['memory-stores']

export type MemoryStoreListResponse = RpcResponseType<MemoryStoresRpc['$get'], 200>
export type MemoryStore = RpcResponseType<MemoryStoresRpc[':storeId']['$get'], 200>
export type MemoryStoreInput = RpcRequestType<MemoryStoresRpc['$post']>['json']
export type MemoryStorePatch = RpcRequestType<MemoryStoresRpc[':storeId']['$patch']>['json']
export type MemoryStoreMemoryListResponse = RpcResponseType<MemoryStoresRpc[':storeId']['memories']['$get'], 200>
export type MemoryStoreMemory = ListItem<MemoryStoreMemoryListResponse>
export type MemoryStoreMemoryInput = RpcRequestType<MemoryStoresRpc[':storeId']['memories']['$post']>['json']
export type MemoryStoreMemoryPatch = RpcRequestType<
  MemoryStoresRpc[':storeId']['memories'][':memoryId']['$patch']
>['json']

export const memoryStoresApi = {
  listMemoryStores: (options: ListOptions = {}) =>
    rpcRequest<ListResponse<MemoryStore>>(
      v1['memory-stores'].$get(queryArg<(typeof v1)['memory-stores']['$get']>(options)),
    ),
  readMemoryStore: (id: string) =>
    rpcRequest<MemoryStore>(v1['memory-stores'][':storeId'].$get({ param: { storeId: id } })),
  createMemoryStore: (input: MemoryStoreInput) => rpcRequest<MemoryStore>(v1['memory-stores'].$post({ json: input })),
  updateMemoryStore: (id: string, input: MemoryStorePatch) =>
    rpcRequest<MemoryStore>(
      v1['memory-stores'][':storeId'].$patch({
        param: { storeId: id },
        json: input as RpcJson<(typeof v1)['memory-stores'][':storeId']['$patch']>,
      }),
    ),
  deleteMemoryStore: (id: string) =>
    rpcRequest<void>(v1['memory-stores'][':storeId'].$delete({ param: { storeId: id } })),
  listMemoryStoreMemories: (storeId: string, options: ListOptions = {}) =>
    rpcRequest<ListResponse<MemoryStoreMemory>>(
      v1['memory-stores'][':storeId'].memories.$get(
        paramQueryArg<(typeof v1)['memory-stores'][':storeId']['memories']['$get']>({ storeId }, options),
      ),
    ),
  createMemoryStoreMemory: (storeId: string, input: MemoryStoreMemoryInput) =>
    rpcRequest<MemoryStoreMemory>(
      v1['memory-stores'][':storeId'].memories.$post({
        param: { storeId },
        json: input as RpcJson<(typeof v1)['memory-stores'][':storeId']['memories']['$post']>,
      }),
    ),
  updateMemoryStoreMemory: (storeId: string, memoryId: string, input: Partial<MemoryStoreMemoryInput>) =>
    rpcRequest<MemoryStoreMemory>(
      v1['memory-stores'][':storeId'].memories[':memoryId'].$patch({
        param: { storeId, memoryId },
        json: input as RpcJson<(typeof v1)['memory-stores'][':storeId']['memories'][':memoryId']['$patch']>,
      }),
    ),
  deleteMemoryStoreMemory: (storeId: string, memoryId: string) =>
    rpcRequest<void>(v1['memory-stores'][':storeId'].memories[':memoryId'].$delete({ param: { storeId, memoryId } })),
}
