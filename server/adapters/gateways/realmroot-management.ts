import { getBearerClaimsForAudience } from '@server/auth/oidc'
import { managementAuthorizationForWebSession } from '@server/auth/web-session'
import { type Env, fakeRealmrootEnrollmentEnabled } from '@server/env'
import type { RealmrootManagementAuthority, RealmrootManagementCredential } from '@server/usecases/ports'

function bearerCredential(authorization: string): RealmrootManagementCredential {
  if (!/^Bearer\s+\S+$/i.test(authorization)) {
    throw new Error('Realmroot Agent management authority did not return a Bearer token')
  }
  return {
    async headers() {
      return { authorization }
    },
  }
}

function managementResource(env: Env) {
  const issuer = env.OIDC_ISSUER?.trim()
  if (!issuer) throw new Error('OIDC_ISSUER is required')
  return env.REALMROOT_MANAGEMENT_RESOURCE?.trim() || `${new URL(issuer).origin}/api`
}

async function delegatedCredential(
  env: Env,
  authorization: string,
  subject: string,
  clientId: string | null | undefined,
) {
  const credential = bearerCredential(authorization)
  const accessToken = authorization.replace(/^Bearer\s+/i, '')
  const claims = await getBearerClaimsForAudience(env, accessToken, managementResource(env))
  if (
    claims.sub !== subject ||
    !clientId ||
    (claims.client_id ?? claims.azp) !== clientId ||
    !claims.permissions.includes('agents:write')
  ) {
    throw new Error('Realmroot Agent management authority does not represent the AMA User grant')
  }
  return credential
}

export function createRealmrootManagementAuthority(env: Env): RealmrootManagementAuthority {
  return {
    async forAgentAdministration(auth) {
      if (fakeRealmrootEnrollmentEnabled(env)) {
        return bearerCredential(`Bearer ama-e2e-fixture:${auth.user.id}`)
      }
      if (auth.oidc?.realmrootManagementAuthorization) {
        return await delegatedCredential(
          env,
          auth.oidc.realmrootManagementAuthorization,
          auth.user.id,
          auth.oidc.clientId,
        )
      }
      const sessionId = auth.oidc?.realmrootManagementSessionId
      if (!sessionId) {
        throw new Error('Realmroot Agent management authority requires a delegated User grant')
      }
      return await delegatedCredential(
        env,
        await managementAuthorizationForWebSession(env, sessionId),
        auth.user.id,
        auth.oidc?.clientId ?? env.OIDC_CLIENT_ID,
      )
    },
  }
}
