# Cloudflare Deployment

GitHub Actions is intentionally limited to CI checks. Production and staging deploys should run through Cloudflare's own build and deploy pipeline.

## Required Cloudflare resources

- Workers project: `any-managed-agents`
- Workers AI binding: `AI`
- Cloudflare Sandbox container binding: `SANDBOX`
- Production D1 database: `any-managed-agents-db`
- Staging D1 database: `any-managed-agents-db-staging`
- Container image built from this repository's `Dockerfile`

## OIDC Provider

Create one OIDC application for each deployed Worker host.

Required settings:

- Issuer: `OIDC_ISSUER`
- Client id: `OIDC_CLIENT_ID`
- Client secret: store as Wrangler secret `OIDC_CLIENT_SECRET`
- Redirect URI: configure in the OIDC provider as `https://<worker-host>/auth/callback`
- Scopes: `openid email profile`
- Flow: authorization code with PKCE

The browser uses the community `oidc-client-ts` library for authorization-code
PKCE redirect handling. The Worker uses the community `openid-client` library for
discovery and `jose` for local JWT/JWKS bearer-token verification. Do not
implement OIDC parsing or token validation by hand.

Control-plane settings:

- `AMA_ALLOWED_ORIGINS`: comma-separated browser origins allowed for
  bearer-authenticated CORS requests.

## Sandbox tool executor

Each AMA session owns one Cloudflare Sandbox instance as a tool executor backend.
AMA cloud-side code owns the session loop and dispatches concrete tool execution
requests to the sandbox. The sandbox runs commands and file operations in
`/workspace`; it does not run the primary Pi/PyAgent process for the session.

The container image must be built from this repository's `Dockerfile`. Runtime
packages required for tool execution must be baked into the container image. The
runtime must not install Node packages during session start; session startup
should only create workspace metadata and initialize the executor backend.

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

Do not store raw provider credentials in D1, session events, UI state, or logs.
The database may store metadata and secret references only.

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
external vault. D1 stores runner metadata, capabilities, heartbeat/load state,
work item payloads, lease state, safe result/error metadata, and secret
references only. Do not expose runner host ports, runner-local preview URLs, or
runner-local filesystem paths as product endpoints.

## Local E2E And Smoke

Run browser e2e against the local dev server in local development and CI. This
path must not consume real model quota or depend on deployed origins:

```bash
pnpm run e2e
```

Run the full AMA smoke on a host that has at least one supported runtime CLI
installed and authenticated (`codex`, `claude`, or `copilot`):

```bash
pnpm run test:smoke
```

`test:smoke` starts a real `ama-runner` process against a local v1 control-plane
stub and runs the selected local runtime through the embedded bridge. The control
plane is fake; runner startup, lease claim, workspace preparation, runtime
execution, local event storage, live relay, backfill, Codex follow-up prompts,
runner interruption/resume, lease completion, and memory-store writeback are
real. Set `AMA_SMOKE_RUNTIME=codex|claude-code|copilot` to force a specific
runtime. The smoke mounts `https://github.com/saltbo/slink.git` by default to
exercise real Git repository clone/mount behavior; set `AMA_SMOKE_GIT_TOKEN` only
when you need to exercise session-scoped git credential isolation. This may
consume real runtime/model quota and uses external network for the Git mount.

`pnpm run smoke:bridge` is the cheap deterministic bridge check used by GitHub
Actions. It is not a full AMA smoke.

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
