import { type User, UserManager, WebStorageStateStore } from 'oidc-client-ts'

interface OidcConfigResponse {
  authority: string
  clientId: string
  scope: string
  resource: string
}

let managerPromise: Promise<UserManager> | undefined
let userPromise: Promise<User | null> | undefined
let configPromise: Promise<OidcConfigResponse> | undefined

async function readOidcConfig() {
  const response = await fetch('/api/v1/configz')
  if (!response.ok) throw new Error('Failed to load browser configuration')
  const body = (await response.json()) as {
    auth?: {
      oidc?: {
        issuer?: string
        resource?: string
        browser?: { clientId?: string; scopes?: string[] }
      } | null
    }
  }
  const oidc = body.auth?.oidc
  const browser = oidc?.browser
  const scopes = Array.isArray(browser?.scopes) ? browser.scopes.filter(Boolean) : []
  if (!oidc?.issuer || !oidc.resource || !browser?.clientId || scopes.length === 0) {
    throw new Error('OIDC browser configuration is missing')
  }
  return {
    authority: oidc.issuer,
    clientId: browser.clientId,
    scope: scopes.join(' '),
    resource: oidc.resource,
  }
}

async function oidcConfig() {
  configPromise ??= readOidcConfig()
  const config = await configPromise
  const origin = window.location.origin
  return {
    ...config,
    redirectUri: `${origin}/auth/callback`,
    postLogoutRedirectUri: `${origin}/`,
  }
}

function isSerializedJwt(token: string) {
  return token.split('.').length === 3
}

export async function getOidcManager() {
  managerPromise ??= oidcConfig().then(
    (config) =>
      new UserManager({
        authority: config.authority,
        client_id: config.clientId,
        redirect_uri: config.redirectUri,
        post_logout_redirect_uri: config.postLogoutRedirectUri,
        response_type: 'code',
        scope: config.scope,
        resource: config.resource,
        automaticSilentRenew: true,
        userStore: new WebStorageStateStore({ store: window.sessionStorage }),
      }),
  )
  return managerPromise
}

export async function getAuthHeaders() {
  const accessToken = getStoredAccessToken()
  if (!accessToken) return {}
  if (accessToken.startsWith('e2e:')) return { authorization: `Bearer ${accessToken}` }
  const manager = await getOidcManager()
  userPromise ??= manager.getUser()
  const user = await userPromise
  if (!user || user.expired || user.access_token !== accessToken) return {}
  return { authorization: `Bearer ${accessToken}` }
}

export async function getCurrentUser() {
  const e2eToken = window.localStorage.getItem('ama:e2e-access-token')
  if (e2eToken) {
    const runId = e2eToken.startsWith('e2e:') ? e2eToken.slice('e2e:'.length) : 'run'
    const safeRunId = runId.replaceAll(/[^A-Za-z0-9_-]/g, '_') || 'run'
    return {
      expired: false,
      access_token: e2eToken,
      token_type: 'Bearer',
      scope: 'openid email profile',
      session_state: null,
      state: undefined,
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      toStorageString: () => '',
      profile: {
        sub: `user_e2e_${safeRunId}`,
        email: `${safeRunId}@e2e.example.com`,
        name: `E2E User ${safeRunId}`,
        org_id: `org_e2e_${safeRunId}`,
        org_name: `org_e2e_${safeRunId}`,
      },
    } as unknown as User
  }

  const manager = await getOidcManager()
  userPromise ??= manager.getUser()
  const user = await userPromise
  if (!user || user.expired) return null
  if (!isSerializedJwt(user.access_token)) {
    userPromise = undefined
    await manager.removeUser()
    return null
  }
  return user
}

export function getStoredAccessToken() {
  const e2eToken = window.localStorage.getItem('ama:e2e-access-token')
  if (e2eToken) return e2eToken
  for (let index = 0; index < window.sessionStorage.length; index += 1) {
    const key = window.sessionStorage.key(index)
    if (!key?.startsWith('oidc.user:')) continue
    const raw = window.sessionStorage.getItem(key)
    if (!raw) continue
    try {
      const user = JSON.parse(raw) as { access_token?: string; expires_at?: number }
      if (user.access_token && (!user.expires_at || user.expires_at * 1000 > Date.now())) {
        if (isSerializedJwt(user.access_token)) return user.access_token
        window.sessionStorage.removeItem(key)
      }
    } catch {}
  }
  return null
}

export async function signIn(returnTo: string) {
  const manager = await getOidcManager()
  await manager.signinRedirect({ state: { returnTo } })
}

export async function completeSignIn() {
  const manager = await getOidcManager()
  const user = await manager.signinRedirectCallback()
  userPromise = Promise.resolve(user)
  const state = user.state as { returnTo?: string } | undefined
  const returnTo = state?.returnTo
  return returnTo?.startsWith('/') && !returnTo.startsWith('//') ? returnTo : '/'
}

export async function signOut() {
  window.localStorage.removeItem('ama:e2e-access-token')
  const manager = await getOidcManager()
  await manager.signoutRedirect()
}
