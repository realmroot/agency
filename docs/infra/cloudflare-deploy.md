# Cloudflare Deployment

This is an operational deployment runbook, not a product or API specification.
Observable behavior belongs in [`../../spec/`](../../spec/); architecture
decisions belong in [`../adr/`](../adr/).

GitHub Actions is limited to CI checks. Production and staging deploys run
through Cloudflare Workers Builds.

## Required Cloudflare resources

- Workers project: `any-managed-agents`
- Workers AI binding: `AI`
- Cloudflare Sandbox container binding: `SANDBOX`
- Production D1 database: `any-managed-agents-db`
- Staging D1 database: `any-managed-agents-db-staging-v2`
- Container image built from this repository's `Dockerfile`

## OAuth 2.0 and OpenID Connect configuration

AMA uses standard OAuth 2.0 and OpenID Connect protocols. Realmroot is the
currently configured provider; it is not part of AMA's protocol contract.

Register these provider clients for the deployment:

- one confidential Web client for the AMA backend;
- one machine client for Inbox subscription management; and
- one public native client for Runner loopback PKCE.

Register AMA as the Resource Server only after its RFC 9728 discovery document
and generated OpenAPI document are live.

Required settings:

- `OIDC_ISSUER`
- `OIDC_CLIENT_ID`
- `OIDC_CLIENT_SECRET` as a Wrangler secret
- `OIDC_RUNNER_CLIENT_ID`
- `INBOX_CLIENT_ID`
- `INBOX_CLIENT_SECRET` as a Wrangler secret
- `AMA_WEB_SESSION_ENCRYPTION_KEY` as a distinct Wrangler secret generated from
  at least 32 random bytes
- Resource audience: the exact protected Resource URL, including `/api`
- Web redirect URI: `https://<worker-host>/api/v1/auth/authorization-responses`
- Runner redirect URI: `http://127.0.0.1:49174/oauth/callback`

Configure the Web client for authorization code with PKCE and confidential
client authentication, the Runner client for public loopback authorization code
with PKCE, and the Inbox client for client credentials. Configure scopes and
permissions from the live Resource Server metadata rather than duplicating them
in this runbook.

Set secrets separately in each environment:

```bash
pnpm exec wrangler secret put OIDC_CLIENT_ID --env staging
pnpm exec wrangler secret put OIDC_CLIENT_SECRET --env staging
pnpm exec wrangler secret put INBOX_CLIENT_ID --env staging
pnpm exec wrangler secret put INBOX_CLIENT_SECRET --env staging
pnpm exec wrangler secret put AMA_WEB_SESSION_ENCRYPTION_KEY --env staging
```

Repeat without `--env staging` for production. Do not commit client secrets or
encryption keys.

Control-plane setting:

- `AMA_ALLOWED_ORIGINS`: comma-separated browser origins allowed for CORS

Rate-limit bindings must use distinct namespaces in production, staging, E2E,
and Workerd tests:

- `AUTH_CLIENT_RATE_LIMITER`
- `AUTH_IP_RATE_LIMITER`

## Runtime resources

Required bindings and variables:

- `SANDBOX`: Cloudflare Sandbox/Containers binding
- `AMA_RUNTIME_MODE=live` in deployed environments
- `AMA_AI_GATEWAY_ID`: optional Cloudflare AI Gateway id

Build the container image from this repository's `Dockerfile`. Do not store raw
provider credentials or OAuth tokens in D1, UI state, or logs.

## Vault encryption

Set `AMA_VAULT_ENCRYPTION_KEY` as a Wrangler secret with at least 32 characters.
Plan credential rotation before changing it; existing ciphertext cannot be
recovered with a different key.

## Verification

Local browser E2E and deterministic mock smoke:

```bash
pnpm run e2e
pnpm run smoke:mock
```

Run the real smoke manually only on a host with the required runtime installed
and authenticated. It may consume external network and model quota:

```bash
pnpm run smoke:real
```

## Cloudflare build settings

- Production build command: `pnpm run build`
- Staging build command: `pnpm run build:staging`
- Deploy command: managed by Cloudflare Workers Builds
- Root directory: repository root
- Production branch: `master`

Apply database migrations before deploy promotion:

```bash
pnpm run db:migrate:d1:staging
pnpm run db:migrate:d1:prod
```

## Durable Object migration bootstrap

The first deployment that introduces a Durable Object migration requires a
non-versioned bootstrap deployment:

```bash
pnpm run build
pnpm exec wrangler deploy
```

After that bootstrap, Workers Builds can upload new versions normally. Do not
grant Cloudflare deployment credentials to GitHub Actions unless the deployment
policy changes.
