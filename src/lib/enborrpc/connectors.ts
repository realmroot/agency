import { type ArrayItem, type ListResponse, queryArg, type RpcResponseType, rpcRequest, v1 } from './core'

type ConnectorsRpc = typeof v1.connectors

export type ConnectorListResponse = RpcResponseType<ConnectorsRpc['$get'], 200>
export type Connector = RpcResponseType<ConnectorsRpc[':connectorId']['$get'], 200>
export type ConnectorTool = ArrayItem<Connector['tools']>

export interface ConnectorListOptions {
  search?: string
  category?: string
  trustLevel?: string
  capability?: string
}

export const connectorsApi = {
  listConnectors: (options: ConnectorListOptions = {}) =>
    rpcRequest<ListResponse<Connector>>(v1.connectors.$get(queryArg<typeof v1.connectors.$get>(options))),
  readConnector: (connectorId: string) =>
    rpcRequest<Connector>(v1.connectors[':connectorId'].$get({ param: { connectorId } })),
}
