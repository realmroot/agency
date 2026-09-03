import { type ListResponse, queryArg, type RpcResponseType, rpcRequest, v1 } from './core'

type AuditRecordsRpc = (typeof v1)['audit-records']

export type AuditRecordListResponse = RpcResponseType<AuditRecordsRpc['$get'], 200>
export type AuditRecord = RpcResponseType<AuditRecordsRpc[':recordId']['$get'], 200>

export interface AuditRecordListOptions {
  actorId?: string
  projectId?: string
  resourceType?: string
  resourceId?: string
  action?: string
  outcome?: string
  from?: string
  to?: string
  limit?: number
  cursor?: string
}

export const auditApi = {
  listAuditRecords: (options: AuditRecordListOptions = {}) =>
    rpcRequest<ListResponse<AuditRecord>>(
      v1['audit-records'].$get(queryArg<(typeof v1)['audit-records']['$get']>(options)),
    ),
  readAuditRecord: (id: string) =>
    rpcRequest<AuditRecord>(v1['audit-records'][':recordId'].$get({ param: { recordId: id } })),
}
