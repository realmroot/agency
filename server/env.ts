import type { Sandbox } from '@cloudflare/sandbox'

export interface Env {
  DB: D1Database
  AI: Ai
  ASSETS: Fetcher
  OIDC_PROVIDER?: Fetcher
  SANDBOX: DurableObjectNamespace<Sandbox>
  // The per-session Session DO (idFromName(sessionId)): event store + browser WebSocket hub.
  SESSION: DurableObjectNamespace
  // The per-environment runner pool DO (idFromName(environmentId)): self-hosted runner channel + dispatch.
  RUNNER_POOL: DurableObjectNamespace
  // Cold archive for ended cloud sessions: one events.jsonl object per session.
  SESSION_EVENTS: R2Bucket
  // Cloud session turn queue; absent in test mode where turns run inline.
  CLOUD_TURNS?: Queue<unknown>
  // Wake-up queue for durable HTTP trigger runs. D1 owns FIFO and run state.
  TRIGGER_DISPATCHES?: Queue<unknown>
  AMA_DEFAULT_MODEL?: string
  AMA_RUNTIME_MODE?: string
  AMA_VAULT_ENCRYPTION_KEY?: string
  // AI Gateway name for third-party ({vendor}/{model}) cloud models (Unified
  // Billing / BYOK); defaults to 'ama'. '@cf/' models stay gateway-free.
  AMA_AI_GATEWAY_ID?: string
  OIDC_ISSUER?: string
  OIDC_CLIENT_ID?: string
  OIDC_CLIENT_SECRET?: string
  // Exact OAuth protected-resource audience accepted by the API. When absent,
  // request handlers use their externally visible request origin.
  OIDC_RESOURCE?: string
  OIDC_RUNNER_CLIENT_ID?: string
  OIDC_RUNNER_SCOPES?: string
  OIDC_USE_SERVICE_BINDING?: string
  AMA_ALLOWED_ORIGINS?: string
  AMA_E2E_TEST_AUTH?: string
}
