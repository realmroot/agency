import type { Env } from '@server/env'
import type { RealmrootManagementAuthority, RealmrootManagementCredential } from '@server/usecases/ports'

function required(value: string | undefined, name: string) {
  if (!value?.trim()) throw new Error(`${name} is required for Realmroot Identity provisioning`)
  return value.trim()
}

function credential(accessToken: string): RealmrootManagementCredential {
  return {
    async headers() {
      return { authorization: `Bearer ${accessToken}` }
    },
  }
}

export function createRealmrootManagementAuthority(env: Env): RealmrootManagementAuthority {
  return {
    async exchange(input) {
      if (env.E2E_TEST_AUTH === 'true' && env.E2E_FAKE_REALMROOT_ENROLLMENT === 'true') {
        return credential(`enbor-e2e-fixture:${input.subject}`)
      }
      const issuer = required(env.OIDC_ISSUER, 'OIDC_ISSUER').replace(/\/$/, '')
      const discoveryResponse = await fetch(`${issuer.replace(/\/$/, '')}/.well-known/openid-configuration`, {
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(15_000),
      })
      const discovery = (await discoveryResponse.json().catch(() => null)) as {
        issuer?: string
        token_endpoint?: string
      } | null
      if (!discoveryResponse.ok || discovery?.issuer !== issuer || !discovery.token_endpoint) {
        throw new Error('Realmroot authorization server discovery failed')
      }
      const tokenEndpoint = new URL(discovery.token_endpoint)
      if (tokenEndpoint.protocol !== 'https:' || tokenEndpoint.origin !== new URL(issuer).origin) {
        throw new Error('Realmroot token endpoint crossed an origin boundary')
      }
      const response = await fetch(tokenEndpoint, {
        method: 'POST',
        headers: {
          accept: 'application/json',
          'content-type': 'application/x-www-form-urlencoded',
          authorization: `Basic ${btoa(`${required(env.OIDC_CLIENT_ID, 'OIDC_CLIENT_ID')}:${required(env.OIDC_CLIENT_SECRET, 'OIDC_CLIENT_SECRET')}`)}`,
        },
        body: new URLSearchParams({
          grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
          subject_token_type: 'urn:ietf:params:oauth:token-type:access_token',
          subject_token: input.subjectToken,
          audience: env.REALMROOT_MANAGEMENT_RESOURCE?.trim() || `${new URL(issuer).origin}/api`,
          scope: 'agents:write',
        }),
        signal: AbortSignal.timeout(15_000),
      })
      const body = (await response.json().catch(() => null)) as { access_token?: string; token_type?: string } | null
      if (!response.ok || !body?.access_token || body.token_type?.toLowerCase() !== 'bearer') {
        throw new Error('Realmroot management grant exchange failed')
      }
      return credential(body.access_token)
    },
  }
}
