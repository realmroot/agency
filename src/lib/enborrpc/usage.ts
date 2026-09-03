import {
  type ArrayItem,
  type ListItem,
  type ListResponse,
  queryArg,
  type RpcResponseType,
  rpcRequest,
  v1,
} from './core'

type BudgetsRpc = typeof v1.budgets
type UsageSummaryRpc = (typeof v1)['usage-summary']
type UsageRecordsRpc = (typeof v1)['usage-records']

export type BudgetListResponse = RpcResponseType<BudgetsRpc['$get'], 200>
export type Budget = ListItem<BudgetListResponse>
export type UsageSummary = RpcResponseType<UsageSummaryRpc['$get'], 200>
export type UsageSummaryTotals = UsageSummary['totals']
export type UsageSummaryGroup = ArrayItem<UsageSummary['groups']>
export type UsageRecordListResponse = RpcResponseType<UsageRecordsRpc['$get'], 200>
export type UsageRecord = ListItem<UsageRecordListResponse>

export interface UsageSummaryOptions {
  groupBy?: string
  from?: string
  to?: string
}

export const usageApi = {
  listBudgets: () => rpcRequest<ListResponse<Budget>>(v1.budgets.$get(queryArg<typeof v1.budgets.$get>({}))),
  readUsageSummary: (options: UsageSummaryOptions = {}) =>
    rpcRequest<UsageSummary>(v1['usage-summary'].$get(queryArg<(typeof v1)['usage-summary']['$get']>(options))),
  listUsageRecords: (options: Record<string, unknown> = {}) =>
    rpcRequest<ListResponse<UsageRecord>>(
      v1['usage-records'].$get(queryArg<(typeof v1)['usage-records']['$get']>(options)),
    ),
}
