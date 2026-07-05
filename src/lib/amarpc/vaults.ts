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

type VaultsRpc = typeof v1.vaults

export type VaultListResponse = RpcResponseType<VaultsRpc['$get'], 200>
export type Vault = RpcResponseType<VaultsRpc[':vaultId']['$get'], 200>
export type VaultInput = RpcRequestType<VaultsRpc['$post']>['json']
export type VaultCredentialListResponse = RpcResponseType<VaultsRpc[':vaultId']['credentials']['$get'], 200>
export type VaultCredential = ListItem<VaultCredentialListResponse>
export type VaultCredentialInput = RpcRequestType<VaultsRpc[':vaultId']['credentials']['$post']>['json']
export type VaultCredentialSecretInput = RpcRequestType<
  VaultsRpc[':vaultId']['credentials'][':credentialId']['$put']
>['json']
export type VaultCredentialVersion = NonNullable<VaultCredential['status']['activeVersion']>
export type VaultCredentialVersionSpec = VaultCredentialVersion['spec']
export type VaultCredentialVersionStatus = VaultCredentialVersion['status']
export type VaultCredentialSpec = VaultCredential['spec']
export type VaultCredentialStatus = VaultCredential['status']
export type VaultSpec = Vault['spec']
export type CredentialType = VaultCredentialSpec['type']

export interface VaultCredentialListOptions {
  search?: string
  state?: string
  createdFrom?: string
  createdTo?: string
  limit?: number
  cursor?: string
}

export const vaultsApi = {
  listVaults: (options: ListOptions = {}) =>
    rpcRequest<ListResponse<Vault>>(v1.vaults.$get(queryArg<typeof v1.vaults.$get>(options))),
  readVault: (id: string) => rpcRequest<Vault>(v1.vaults[':vaultId'].$get({ param: { vaultId: id } })),
  createVault: (input: VaultInput) => rpcRequest<Vault>(v1.vaults.$post({ json: input })),
  archiveVault: (id: string) =>
    rpcRequest<Vault>(v1.vaults[':vaultId'].$patch({ param: { vaultId: id }, json: { archived: true } })),
  listVaultCredentials: (id: string, options: VaultCredentialListOptions = {}) =>
    rpcRequest<ListResponse<VaultCredential>>(
      v1.vaults[':vaultId'].credentials.$get(
        paramQueryArg<(typeof v1.vaults)[':vaultId']['credentials']['$get']>({ vaultId: id }, options),
      ),
    ),
  createVaultCredential: (vaultId: string, input: VaultCredentialInput) =>
    rpcRequest<VaultCredential>(
      v1.vaults[':vaultId'].credentials.$post({
        param: { vaultId },
        json: input as RpcJson<(typeof v1.vaults)[':vaultId']['credentials']['$post']>,
      }),
    ),
  updateVaultCredentialSecret: (vaultId: string, credentialId: string, secret: VaultCredentialSecretInput) =>
    rpcRequest<VaultCredential>(
      v1.vaults[':vaultId'].credentials[':credentialId'].$put({
        param: { vaultId, credentialId },
        json: secret as RpcJson<(typeof v1.vaults)[':vaultId']['credentials'][':credentialId']['$put']>,
      }),
    ),
  revokeVaultCredential: (vaultId: string, credentialId: string, revokeReason?: string) =>
    rpcRequest<VaultCredential>(
      v1.vaults[':vaultId'].credentials[':credentialId'].$patch({
        param: { vaultId, credentialId },
        json: { state: 'revoked', ...(revokeReason ? { revokeReason } : {}) },
      }),
    ),
}
