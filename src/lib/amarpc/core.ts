import type { InferRequestType, InferResponseType } from 'hono/client'
import { hc } from 'hono/client'
import type { StatusCode } from 'hono/utils/http-status'
import type { AppType } from '../../../server/app'
import { getAccessToken } from '../oidc'
import { getSelectedProjectId } from '../project-selection'

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly details: unknown,
  ) {
    super(message)
  }
}

export const rpc = hc<AppType>('/', {
  headers: async () => {
    const token = await getAccessToken()
    const projectId = getSelectedProjectId()
    return {
      accept: 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(projectId ? { 'x-ama-project-id': projectId } : {}),
      'x-ama-client': 'web-rpc',
    }
  },
})

export const v1 = rpc.api.v1

export type ArrayItem<T> = T extends readonly (infer Item)[] ? Item : never
export type JsonListResponse<T> = Extract<T, { data: unknown[] }>
export type ListItem<T> = T extends { data: readonly (infer Item)[] } ? Item : never
export type ListPaginationOf<T> = T extends { pagination: infer Pagination } ? Pagination : never
export type RpcRequestType<T> = InferRequestType<T>
export type RpcResponseType<T, Status extends StatusCode = 200> = InferResponseType<T, Status>

type RpcResponse = Pick<Response, 'headers' | 'json' | 'ok' | 'status' | 'statusText' | 'text'>
export type RpcArg<T> = T extends (args: infer A, ...rest: never[]) => unknown ? A : never
export type RpcJson<T> = RpcArg<T> extends { json: infer J } ? J : never
export type RpcQuery<T> = RpcArg<T> extends { query: infer Q } ? Q : never

export interface ListOptions {
  archived?: boolean
  search?: string
  createdFrom?: string
  createdTo?: string
  limit?: number
  cursor?: string
}

export type ListResponse<T> = { data: T[]; pagination: ListPagination }

export async function rpcRequest<T>(responsePromise: Promise<RpcResponse>) {
  const response = await responsePromise
  if (response.status === 204) {
    return undefined as T
  }

  const contentType = response.headers.get('content-type') ?? ''
  const body = contentType.includes('application/json') ? await response.json() : await response.text()
  if (!response.ok) {
    const message =
      typeof body === 'object' && body && 'error' in body
        ? String((body as { error?: { message?: string } }).error?.message ?? response.statusText)
        : response.statusText
    throw new ApiError(message, response.status, body)
  }
  return body as T
}

export function queryOptions(options: object = {}) {
  const query: Record<string, string> = {}
  for (const [key, value] of Object.entries(options as Record<string, string | number | boolean | undefined>)) {
    if (value !== undefined) {
      query[key] = String(value)
    }
  }
  return query
}

export function queryArg<T>(options: object = {}) {
  const query = queryOptions(options)
  return (Object.keys(query).length === 0 ? {} : { query: query as RpcQuery<T> }) as RpcArg<T>
}

export function paramQueryArg<T>(param: RpcArg<T> extends { param: infer P } ? P : never, options: object = {}) {
  const query = queryOptions(options)
  return (Object.keys(query).length === 0 ? { param } : { param, query: query as RpcQuery<T> }) as RpcArg<T>
}

export function jsonArg<T>(json: RpcJson<T>) {
  return { json } as RpcArg<T>
}

type ProjectsRpc = typeof v1.projects
type ProjectListResponse = RpcResponseType<ProjectsRpc['$get'], 200>
export type ListPagination = ListPaginationOf<ProjectListResponse>
