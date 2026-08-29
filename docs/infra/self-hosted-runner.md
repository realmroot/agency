# Self-Hosted AMA Runner

`cmd/ama-runner` is the first self-hosted tool-executor daemon for Any Managed Agents. AMA keeps ownership of the agent loop, work queue, policy decisions, session state, and event storage. The runner leases AMA-owned self-hosted work and reports structured events/results back through the runner protocol API.

The daemon is intentionally not a Pi or PyAgent runtime host. It must not launch local Pi loops, expose runner-local session URLs, or accept unapproved local work.

## Build

```bash
cd cmd/ama-runner
go test ./...
go build ./...
```

The runner module depends on the repo-local generated Go SDK:

```go
require github.com/saltbo/any-managed-agents/sdk/go v0.0.0
replace github.com/saltbo/any-managed-agents/sdk/go => ../../sdk/go
```

All AMA API calls go through `sdk/go/ama`. The daemon uses `ama.NewRunner` for runner protocol calls and does not maintain a separate API client outside SDK transport configuration.

Release artifacts support Linux and macOS on amd64/arm64 and Windows on amd64. Windows arm64 is compile-checked but is not a supported release target yet.

## Login And Configuration

Authenticate the runner with Realmroot loopback PKCE before starting the daemon. Select the same personal or organization Context that owns the AMA project:

```bash
ama-runner auth login --api-server "https://ama.example.com"
```

The command discovers Realmroot metadata from `/api/v1/configz`, starts a loopback listener at `http://127.0.0.1:49174/oauth/callback`, opens the public-native authorization-code PKCE flow, and stores the short-lived Bearer access token plus rotating refresh credential in the local credential file. Register that exact callback in Realmroot; wildcard ports are unsupported. The command never prints access or refresh tokens.

Foreground `run` configuration may be read from `$AMA_RUNNER_CONFIG`, `$XDG_CONFIG_HOME/ama-runner/config.json`, or `$HOME/.config/ama-runner/config.json`. Managed instance definitions are stored separately below `$XDG_CONFIG_HOME/ama-runner/instances` or `$HOME/.config/ama-runner/instances`.

The shared credential file remains `$AMA_RUNNER_CREDENTIALS`, `$XDG_CONFIG_HOME/ama-runner/credentials.json`, or `$HOME/.config/ama-runner/credentials.json`. Saved profiles are keyed by AMA API Server and OIDC account, and refresh writes are serialized so multiple Runner instances can reuse one login safely. Managed instance definitions contain only non-secret configuration and a credential-file reference.

On Windows, Go's native `%APPDATA%` and `%LOCALAPPDATA%` directories provide the equivalent configuration, credential, instance, state, workspace, log, and session-event locations.

Default state and work directories are derived from the normalized AMA API Server and Environment pair:

```text
<native-state-root>/ama-runner/servers/<api-server-key>/environments/<environment-key>/
<native-state-root>/ama-runner/servers/<api-server-key>/environments/<environment-key>/work/
```

The local machine hostname is not part of the key. The normalized API Server origin and Environment id determine the key, so different pairs cannot collide while restarting the same pair reuses its Runner identity, process lock, workspaces, and session event logs.

Create and start a managed Runner instance with:

```bash
ama-runner start \
  --api-server "https://ama.example.com" \
  --project-id "project_..." \
  --environment-id "env_..." \
  --allow-unsafe-process
```

`start` stores the instance, installs it with the native user service manager, enables automatic startup, waits for the first successful heartbeat, and prints its stable local instance id. One API Server and Environment pair owns at most one local Runner process.

```bash
ama-runner list
ama-runner status runner_...
ama-runner stop runner_...
ama-runner restart runner_...
ama-runner logs --follow runner_...
ama-runner configure runner_... --max-concurrent 10
ama-runner remove runner_...
```

`list` and `status` report native local process state separately from AMA control-plane heartbeat state. `stop` drains leases and disables automatic startup. `remove` preserves state by default; `remove --purge` explicitly deletes the Runner identity, workspaces, session events, and logs.

Use explicit foreground mode in containers, development shells, or an existing external service manager:

```bash
ama-runner run \
  --api-server "https://ama.example.com" \
  --project-id "project_..." \
  --environment-id "env_..." \
  --allow-unsafe-process
```

The binary has no implicit foreground root command: `ama-runner --api-server ...` is invalid. Explicit `--state-dir` and `--work-dir` overrides are accepted only by `run`; managed `start` always uses the deterministic instance directories.

This storage change uses a one-time operator data migration. Before installing the new binary, stop the old process and move its API-Server-scoped `runner-state.json`, `runner.lock`, and complete `work` directory into the new directory for its configured Environment. Do not copy only the identity file: the `work` directory is the durable owner of runner-local session JSONL. The new binary reads only the new layout and has no legacy fallback.

Foreground mode on Windows uses the same explicit command and stops with `Ctrl-C`:

```powershell
.\ama-runner.exe run `
  --api-server $env:AMA_API_SERVER `
  --project-id $env:AMA_PROJECT_ID `
  --environment-id $env:AMA_ENVIRONMENT_ID
```

Node.js and the desired runtime CLIs (`codex`, `claude`, and/or `copilot`) must be installed on `PATH`. The runner resolves Windows `.exe` and `.cmd` launchers through `PATHEXT`.

Timing defaults:

- Lease duration: `60s`
- Lease renewal interval: `20s`
- Heartbeat interval: `20s`
- Poll interval when no work is available: `5s`
- Max concurrent leases: `5`

The daemon requires a saved Realmroot Context login. The registered runner client receives short-lived Bearer access tokens and refreshes them through Realmroot; `AMA_TOKEN`, static token overrides, and token-print commands are unsupported.

The daemon fails fast when the API server, Realmroot Bearer login, environment binding, work directory, timing values, or unsafe adapter acknowledgement is invalid. Runner registration stores only Realmroot subject/client binding metadata; raw access and refresh tokens never reach D1. Runner scopes are limited to registration, work items, leases, and session event upload.

## Local Executor Boundary

The AMA runtime uses the `process-unsafe` adapter on Linux and macOS. It is marked unsafe because it executes commands directly on the host with the configured work directory as the workspace boundary. Windows does not advertise the AMA runtime and cannot receive AMA runtime or standalone sandbox-tool work; it can advertise and run the installed Codex, Claude Code, and Copilot runtimes.

`process-unsafe` supports approved AMA runtime tool work for:

- `bash`
- `read`
- `write`
- `edit`
- `grep`
- `find`
- `ls`
- `fetch`
- `web_search`

The adapter captures stdout, stderr, exit code, structured output, and errors. File reads/writes are constrained to the configured work directory, including symlink boundary checks. Command cancellation uses context cancellation and process-group termination on Unix-like hosts. Windows runtime cancellation uses a Job Object so the Node bridge and its provider CLI child processes terminate together.

`bash` starts child commands with an explicit minimal environment. AMA control-plane credentials and `AMA_*` runner/operator configuration are not passed to leased commands. `HOME` and temp directories are set to runner-controlled directories inside the configured workspace so host operator config paths are not inherited.

Do not use this adapter for untrusted workloads. Docker/OCI isolation should be added later as a separate adapter behind the same interface.

## Control-Plane Loop

At startup, the daemon:

1. Checks `/api/v1/configz` for an AMA control plane.
2. Loads the saved Realmroot Bearer Context-login profile.
3. Registers a runner when no runner id is configured.
4. Sends an active heartbeat with supported runtimes, models, and adapter metadata.
5. Lists available work with `GET /api/v1/work-items` and claims it with `POST /api/v1/leases`.
6. Uploads structured lease events.
7. Renews active leases while local work is running.
8. Finishes leases as `completed`, `failed`, or `cancelled`.

`204` lease responses mean no eligible work is available. Authentication failures, runner-token binding failures, unsupported payload protocols, unsupported sandbox backends, and incompatible control planes are fatal.

Current AMA self-hosted session creation queues `session.start` work. The daemon handles that work as a cloud-owned session handoff: it uploads a structured `runner.session.started` event and completes the lease without launching Pi/PyAgent locally. Approved AMA runtime tool payloads are the only work items that enter the local process adapter.

## Cancellation Status

The daemon cancels local work and reports `cancelled` when its local process receives cancellation. It also cancels local work if a lease renewal fails, because a `409` means the lease no longer owns the work item.

The current API does not yet expose a control-plane initiated cancellation signal for an already running self-hosted lease. Operators should treat that as a known API gap: AMA can accept runner-sent `cancelled` lease updates, but the runner cannot poll a first-class cancellation resource yet.
