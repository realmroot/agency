import { getBearerClaimsForAudience, organizationIdForClaims } from '@server/auth/oidc'
import { type Env, fakeRealmrootEnrollmentEnabled } from '@server/env'
import type { RealmrootManagementAuthority, RealmrootManagementCredential } from '@server/usecases/ports'

const tokenExchangeGrant = 'urn:ietf:params:oauth:grant-type:token-exchange'
const accessTokenType = 'urn:ietf:params:oauth:token-type:access_token'

function required(value: string | undefined, name: string) {
  const normalized = value?.trim()
  if (!normalized) throw new Error(`${name} is required`)
  return normalized
}

function bearerCredential(accessToken: string): RealmrootManagementCredential {
  if (!accessToken || /\s/.test(accessToken))
    throw new Error('Realmroot Agent management authority returned an invalid token')
  return {
    async headers() {
      return { authorization: `Bearer ${accessToken}` }
    },
  }
}

function managementResource(env: Env) {
  const issuer = required(env.OIDC_ISSUER, 'OIDC_ISSUER')
  return env.REALMROOT_MANAGEMENT_RESOURCE?.trim() || `${new URL(issuer).origin}/api`
}

function subjectAccessToken(authorization: string | null) {
  const match = /^Bearer\s+(\S+)$/i.exec(authorization?.trim() ?? '')
  if (!match?.[1]) throw new Error('Realmroot Agent management authority requires the AMA User Bearer token')
  return match[1]
}

function basicComponent(value: string) {
  return encodeURIComponent(value).replaceAll('%20', '+')
}

async function exchangeUserToken(env: Env, authorization: string | null) {
  const issuer = required(env.OIDC_ISSUER, 'OIDC_ISSUER').replace(/\/$/, '')
  const clientId = required(env.REALMROOT_TOKEN_EXCHANGE_CLIENT_ID, 'REALMROOT_TOKEN_EXCHANGE_CLIENT_ID')
  const clientSecret = required(env.REALMROOT_TOKEN_EXCHANGE_CLIENT_SECRET, 'REALMROOT_TOKEN_EXCHANGE_CLIENT_SECRET')
  const response = await fetch(`${issuer}/oauth2/token`, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      authorization: `Basic ${btoa(`${basicComponent(clientId)}:${basicComponent(clientSecret)}`)}`,
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: tokenExchangeGrant,
      subject_token: subjectAccessToken(authorization),
      subject_token_type: accessTokenType,
      requested_token_type: accessTokenType,
      audience: managementResource(env),
      scope: 'agents:write',
    }),
    signal: AbortSignal.timeout(10_000),
  })
  const body = (await response.json().catch(() => null)) as Record<string, unknown> | null
  if (!response.ok) {
    const description = typeof body?.error_description === 'string' ? body.error_description : `HTTP ${response.status}`
    throw new Error(`Realmroot User token exchange failed: ${description}`)
  }
  if (
    !body ||
    typeof body.access_token !== 'string' ||
    body.token_type !== 'Bearer' ||
    body.issued_token_type !== accessTokenType ||
    body.scope !== 'agents:write' ||
    body.refresh_token !== undefined
  ) {
    throw new Error('Realmroot User token exchange returned an invalid response')
  }
  return { accessToken: body.access_token, clientId }
}

export function createRealmrootManagementAuthority(env: Env): RealmrootManagementAuthority {
  return {
    async forAgentAdministration(auth, authorization) {
      if (auth.agentActor) throw new Error('Only a Realmroot User can administer managed Agent identities')
      if (fakeRealmrootEnrollmentEnabled(env)) return bearerCredential(`ama-e2e-fixture:${auth.user.id}`)
      const exchanged = await exchangeUserToken(env, authorization)
      const claims = await getBearerClaimsForAudience(env, exchanged.accessToken, managementResource(env))
      if (
        claims.sub !== auth.user.id ||
        organizationIdForClaims(claims) !== auth.organization.id ||
        (claims.client_id ?? claims.azp) !== exchanged.clientId ||
        !claims.permissions.includes('agents:write') ||
        claims.actor
      ) {
        throw new Error('Realmroot Agent management authority does not represent the AMA User delegation')
      }
      return bearerCredential(exchanged.accessToken)
    },
  }
}
