// Generated authentication boundary for the Realmroot-native Enbor Resource.

export type AuthToken = string | undefined

export interface Auth {
  in?: 'header' | 'query' | 'cookie'
  key?: string
  name?: string
  scheme?: never
  type: 'apiKey' | 'http'
}

export const getAuthToken = async (
  _auth: Auth,
  _callback: ((auth: Auth) => Promise<AuthToken> | AuthToken) | AuthToken,
): Promise<string | undefined> => {
  throw new Error('Raw token authentication is unsupported; use createEnborClient with a Realmroot DPoP authorizer')
}
