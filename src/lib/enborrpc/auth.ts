import { type RpcResponseType, rpcRequest, v1 } from './core'

type ConfigzRpc = typeof v1.configz
type AuthRpc = typeof v1.auth

export type PublicConfig = RpcResponseType<ConfigzRpc['$get'], 200>
export type AuthConfig = RpcResponseType<AuthRpc['config']['$get'], 200>
export type AuthSession = RpcResponseType<AuthRpc['sessions']['current']['$get'], 200>
export type AuthUser = AuthSession['user']
export type AuthOrganization = AuthSession['organization']
export type AuthProject = AuthSession['project']

export interface AuthContext {
  user: AuthSession['user'] & { avatarUrl: string | null }
  organization: AuthSession['organization']
  project: AuthSession['project']
  roles: string[]
  permissions: string[]
}

export const authApi = {
  readConfigz: () => rpcRequest<PublicConfig>(v1.configz.$get()),
  readAuthConfig: (organization?: string) =>
    rpcRequest<AuthConfig>(v1.auth.config.$get({ query: organization ? { organization } : {} })),
  readCurrentSession: () => rpcRequest<AuthSession>(v1.auth.sessions.current.$get()),
}
