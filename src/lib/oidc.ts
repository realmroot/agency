interface WebSession {
  csrfToken: string
  user: { id: string; email: string; name: string | null }
  organization?: { id: string; name: string }
  project?: { id: string; name: string }
}

let sessionPromise: Promise<WebSession | null> | undefined

export function clearCachedWebSession() {
  sessionPromise = undefined
}

async function currentSession() {
  const response = await fetch('/api/v1/auth/sessions/current', { credentials: 'same-origin' })
  if (response.status === 401) return null
  if (!response.ok) throw new Error('Failed to read web session')
  return (await response.json()) as WebSession
}

export async function getAuthHeaders() {
  const e2eToken = window.localStorage.getItem('ama:e2e-access-token')
  if (e2eToken) return { authorization: `Bearer ${e2eToken}` }
  sessionPromise ??= currentSession()
  const session = await sessionPromise
  return session?.csrfToken ? { 'x-csrf-token': session.csrfToken } : {}
}

export async function getCurrentUser() {
  const e2eToken = window.localStorage.getItem('ama:e2e-access-token')
  if (e2eToken) {
    const runId = e2eToken.startsWith('e2e:') ? e2eToken.slice(4) : 'run'
    const safeRunId = runId.replaceAll(/[^A-Za-z0-9_-]/g, '_') || 'run'
    return {
      expired: false,
      access_token: e2eToken,
      profile: {
        sub: `user_e2e_${safeRunId}`,
        email: `${safeRunId}@e2e.example.com`,
        name: `E2E User ${safeRunId}`,
        org_id: `org_e2e_${safeRunId}`,
        org_name: `org_e2e_${safeRunId}`,
      },
    }
  }
  sessionPromise ??= currentSession()
  const session = await sessionPromise
  if (!session) return null
  return {
    expired: false,
    access_token: '',
    profile: {
      sub: session.user.id,
      email: session.user.email,
      name: session.user.name ?? undefined,
      org_id: session.organization?.id,
      org_name: session.organization?.name,
    },
  }
}

export function getStoredAccessToken() {
  return window.localStorage.getItem('ama:e2e-access-token')
}

export async function signIn(returnTo: string) {
  const safe = returnTo.startsWith('/') && !returnTo.startsWith('//') ? returnTo : '/'
  window.location.assign(`/api/v1/auth/login?returnTo=${encodeURIComponent(safe)}`)
}

export async function completeSignIn() {
  return '/'
}

export async function signOut() {
  window.localStorage.removeItem('ama:e2e-access-token')
  const headers = await getAuthHeaders()
  await fetch('/api/v1/auth/sessions/current', { method: 'DELETE', headers, credentials: 'same-origin' })
  sessionPromise = undefined
  window.location.assign('/')
}
