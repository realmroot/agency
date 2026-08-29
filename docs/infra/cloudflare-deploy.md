# Cloudflare Deployment

GitHub Actions is intentionally limited to CI checks. Production and staging deploys should run through Cloudflare's own build and deploy pipeline.

## Required Cloudflare resources

- Workers project: `any-managed-agents`
- Workers AI binding: `AI`
- Cloudflare Sandbox container binding: `SANDBOX`
- Production D1 database: `any-managed-agents-db`
- Staging D1 database: `any-managed-agents-db-staging-v2`
- Container image built from this repository's `Dockerfile`

## Realmroot Applications and Resource Server

Create one confidential Realmroot Web Application for the AMA backend and one
public native Application for the runner loopback PKCE flow. Register AMA as
the native Resource Server at `https://ama.tftt.cc/api` only after its RFC 9728
discovery document and OpenAPI document are live.

Required settings:

- Issuer: `OIDC_ISSUER`
- AMA backend client id: `OIDC_CLIENT_ID`
- AMA backend client secret: store `OIDC_CLIENT_SECRET` as a Wrangler secret.
- Browser session encryption: store `AMA_WEB_SESSION_ENCRYPTION_KEY` as a
  distinct Wrangler secret generated from at least 32 random bytes (for example,
  `openssl rand -base64 32`). The Worker derives separate encryption and
  rate-limit HMAC keys with HKDF.
- Resource audience: the exact protected Resource URL, including `/api`.
- AMA backend redirect URI: configure exactly as
  `https://<worker-host>/api/v1/auth/authorization-responses`.
- Runner redirect URI: configure exactly `http://127.0.0.1:49174/oauth/callback`; do not register wildcard ports.
- Scopes: `openid email profile`
- AMA backend flow: server-side authorization code with PKCE and
  `client_secret_basic` authentication. Do not request `offline_access`; the web
  session is capped to the access-token lifetime.
- Runner flow: public authorization code with loopback PKCE.

Realmroot grants explicit AMA Resource scopes.
Collection reads require `<resource>:read`, mutations require
`<resource>:write`, and narrowly scoped administration may use
`<resource>:*`. A missing permission claim is denied.

The Worker completes browser authorization, stores the Realmroot access token
encrypted in D1, and gives the browser only an opaque HttpOnly, SameSite=Lax
cookie. Cookie sessions and direct Realmroot Bearer/DPoP credentials normalize
to the same claims and exact-scope authorization path. Unsafe cookie requests
must carry the Worker's exact Origin. The native runner keeps its separate
authorization-code PKCE Application and sends Realmroot Bearer access tokens.
The Worker uses `jose` for JWT/JWKS validation and ES256 DPoP verification for
Realmroot CLI, Toolbox, and Agent clients. A verified `client_id` selects the
permitted credential mode; cross-mode fallback is not accepted.

When the Agent provisioning PR is stacked on this change, add its constrained
resource token-exchange policy to this same confidential Web Application. Both
the Application policy and the signed-in User Context must grant each target
scope. Do not create a third machine Application.

Roll out the Application migration in this order so the public SPA is never
reused as a confidential client:

1. Create the Realmroot `confidential_web` Application with the exact production
   and staging callback URIs above, AMA Resource scopes, and (after the Agent
   provisioning PR) its constrained token-exchange policies.
2. Capture its one-time client secret. Set `OIDC_CLIENT_ID`,
   `OIDC_CLIENT_SECRET`, and a new `AMA_WEB_SESSION_ENCRYPTION_KEY` separately in
   each Cloudflare environment; do not commit any of these values. Keep the
   runner's existing public-native `OIDC_RUNNER_CLIENT_ID` unchanged.
3. Run the staging D1 migration command so `0029_web_auth_sessions.sql` is
   applied, deploy staging, and verify the callback, Cookie session, direct
   JWT/DPoP calls, and runner login.
4. Apply the migration and deploy production, then remove the superseded public
   SPA Application. Remove the machine Application only after the stacked Agent
   provisioning change uses this confidential Web Application for exchange.

Set the three environment-specific values before step 3 (repeat without
`--env staging` for production):

```bash
pnpm exec wrangler secret put OIDC_CLIENT_ID --env staging
pnpm exec wrangler secret put OIDC_CLIENT_SECRET --env staging
pnpm exec wrangler secret put AMA_WEB_SESSION_ENCRYPTION_KEY --env staging
```

The `AUTH_CLIENT_RATE_LIMITER` Workers binding limits browser authorization
attempts by a random, opaque HttpOnly client cookie. A separate, higher-threshold
`AUTH_IP_RATE_LIMITER` aggregates abuse by hashed connecting address without
letting a small number of attempts block an entire shared NAT. Their namespaces
are distinct in production, staging, E2E, and Workerd tests. Cloudflare applies
these fast, permissive limits per location; use WAF rules as the first-line
volumetric control for the login and callback paths. The Worker also caches
discovery metadata for ten minutes and applies five-second discovery/token/JWKS
deadlines.

Browser authorization-attempt creation, authorization response handling, and
Cookie Session deletion are internal site protocol routes. They are deliberately
absent from AMA's OpenAPI document and generated SDKs. The current authenticated
context remains a public Resource API because Bearer and DPoP clients use it too.

Control-plane settings:

- `AMA_ALLOWED_ORIGINS`: comma-separated browser origins allowed for
  Realmroot-authenticated CORS requests.

## Sandbox tool executor

Each AMA session owns one Cloudflare Sandbox instance as a tool executor backend.
AMA cloud-side code owns the session loop and dispatches concrete tool execution
requests to the sandbox. The sandbox runs commands and file operations in
`/workspace`; it does not run the primary Pi/PyAgent process for the session.

The container image must be built from this repository's `Dockerfile`. Runtime
packages required for tool execution must be baked into the container image. The
runtime must not install Node packages during session start; session startup
should only create workspace metadata and initialize the executor backend.
The image pins and checksum-verifies the Realmroot CLI used by Realmroot-bound
Agents.

Required Worker bindings and variables:

- `SANDBOX`: Cloudflare Sandbox/Containers binding.
- `AMA_RUNTIME_MODE=live` for deployed environments. Tests use
  `AMA_RUNTIME_MODE=test`.

## Workers AI model configuration

v1.0 keeps model and provider policy in AMA before runtime work starts. The
cloud-owned runtime calls provider adapters from the Worker side. The sandbox
does not call the Cloudflare REST API directly for model work.

Required settings:

- `AMA_DEFAULT_MODEL=@cf/moonshotai/kimi-k2.6`

Optional settings:

- `AMA_AI_GATEWAY_ID`: Cloudflare AI Gateway id for third-party gateway-routed
  models. Native `@cf/` Workers AI models do not need a gateway id.

Do not store raw provider credentials or OAuth tokens in D1, session events, UI
state, or logs. D1 may store metadata, secret references, and authenticated
ciphertext only.

## Vault credential encryption

Vault credential storage encrypts managed secret values with AES-GCM before
anything reaches D1.

Required settings for managed vault storage:

- `AMA_VAULT_ENCRYPTION_KEY`: store as a Wrangler secret with at least 32
  characters. Credential creation and rotation fail fast when it is missing.

Rotating this key invalidates existing ciphertext, so plan a credential
rotation pass when the key changes. Tampered or foreign ciphertext is rejected
with a safe error during runtime resolution.

## Self-hosted runners

Self-hosted runners service environments with `hostingMode: "self_hosted"` and
an explicit selected `runtime`. They claim queued work from
`/api/runners/{runnerId}/leases`, renew the lease while executing, upload
canonical AMA session events, and complete, fail, or cancel the lease.

Runner authentication material must live in Cloudflare Secrets or an approved
external vault. D1 stores runner metadata, supported runtimes and models, heartbeat/load state,
work item payloads, lease state, safe result/error metadata, and secret
references only. Do not expose runner host ports, runner-local preview URLs, or
runner-local filesystem paths as product endpoints.

Runners that accept Realmroot-bound Agents must have a compatible `realmroot`
CLI on `PATH`. A bound Session fails before runtime launch when the CLI or the
bound state is unavailable; an unbound Session has no Realmroot dependency.

## Local E2E And Smoke

Run browser e2e against the local dev server in local development and CI. This
path must not consume real model quota or depend on deployed origins:

```bash
pnpm run e2e
```

Run the mock runtime smoke in CI. It is deterministic and does not consume model
quota:

```bash
pnpm run smoke:mock
```

Run the full real AMA smoke manually on a host with Codex installed and
authenticated:

```bash
pnpm run smoke:real
```

`smoke:real` boots the local Worker stack, builds and starts a real `ama-runner`,
creates real control-plane resources over HTTP, opens the browser session socket,
runs Codex through the embedded bridge, verifies workspace writes, live relay,
completed-session backfill after runner reconnect, and verifies that a sub-agent
run appears in canonical AMA events as an `agent` tool call and matching tool
result. This may consume real runtime/model quota and uses external network for
the Git mount.

## Cloudflare build settings

Use these settings when connecting the GitHub repository in Cloudflare:

- Production build command: `pnpm run build`
- Staging build command: `pnpm run build:staging`
- Deploy command: managed by Cloudflare Workers Builds
- Root directory: repository root
- Production branch: `master`

Database migrations are explicit and should be run before deploy promotion:

```bash
pnpm run db:migrate:d1:staging
pnpm run db:migrate:d1:prod
```

## Durable Object migration bootstrap

Cloudflare Workers Builds deploys with `wrangler versions upload`. The first deployment that introduces a Durable Object migration cannot use version upload; Cloudflare requires the migration to be applied through a non-versioned deployment first.

For a brand-new Worker, run this once after creating D1 resources and before relying on Workers Builds:

```bash
pnpm run build
pnpm exec wrangler deploy
```

After that bootstrap deployment, Workers Builds can upload new versions normally.

GitHub Actions must not be granted Cloudflare deployment credentials unless this policy changes.
