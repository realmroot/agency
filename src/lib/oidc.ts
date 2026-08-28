interface CurrentUser {
  profile: {
    sub: string
    email: string
    name: string | null
    picture?: string
    org_id?: string
    org_name?: string
    organization_id?: string
    organization_name?: string
  }
}

export async function getAuthHeaders() {
  const accessToken = window.localStorage.getItem('ama:e2e-access-token')
  return accessToken ? { authorization: `Bearer ${accessToken}` } : {}
}

export async function getCurrentUser(): Promise<CurrentUser | null> {
  const e2eToken = window.localStorage.getItem('ama:e2e-access-token')
  if (e2eToken) return e2eUser(e2eToken)

  const response = await fetch('/api/v1/auth/sessions/current', { headers: { accept: 'application/json' } })
  if (response.status === 401) return null
  if (!response.ok) throw new Error('Failed to read browser session')
  const session = (await response.json()) as {
    user: { id: string; email: string; name: string | null }
    organization: { id: string; name: string }
  }
  return {
    profile: {
      sub: session.user.id,
      email: session.user.email,
      name: session.user.name,
      org_id: session.organization.id,
      org_name: session.organization.name,
    },
  }
}

export async function signIn(returnTo: string) {
  const response = await fetch('/api/v1/auth/authorization-attempts', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ returnTo }),
  })
  if (!response.ok) throw new Error('Failed to start Realmroot sign-in')
  const attempt = (await response.json()) as { authorizationUrl: string }
  window.location.assign(attempt.authorizationUrl)
}

export async function signOut() {
  window.localStorage.removeItem('ama:e2e-access-token')
  const response = await fetch('/api/v1/auth/sessions/current', { method: 'DELETE' })
  if (!response.ok && response.status !== 401) throw new Error('Failed to sign out')
  window.location.assign('/')
}

function e2eUser(accessToken: string): CurrentUser {
  const runId = accessToken.startsWith('e2e:') ? accessToken.slice('e2e:'.length) : 'run'
  const safeRunId = runId.replaceAll(/[^A-Za-z0-9_-]/g, '_') || 'run'
  return {
    profile: {
      sub: `user_e2e_${safeRunId}`,
      email: `${safeRunId}@e2e.example.com`,
      name: `E2E User ${safeRunId}`,
      org_id: `org_e2e_${safeRunId}`,
      org_name: `org_e2e_${safeRunId}`,
    },
  }
}
