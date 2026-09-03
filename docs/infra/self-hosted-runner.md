# Self-Hosted AMA Runner Operations

This runbook covers installation and operation of `cmd/ama-runner`. It is not a
product or API specification. Observable Runner behavior is specified in
[`../../spec/runners.feature`](../../spec/runners.feature) and runtime behavior
in [`../../spec/runtime.feature`](../../spec/runtime.feature).

## Build

```bash
cd cmd/ama-runner
go test ./...
go build ./...
```

The module uses the repository-local generated Go SDK. Node.js and any selected
runtime CLIs (`codex`, `claude`, or `copilot`) must be available on `PATH`.

Release artifacts support Linux and macOS on amd64/arm64 and Windows on amd64.
Windows arm64 is compile-checked but is not a supported release target.

## Authenticate

Authenticate with the configured OAuth 2.0 and OpenID Connect provider before
starting the daemon. Realmroot is the current provider. Select the personal or
organization context that owns the AMA project.

```bash
ama-runner auth login --api-server "https://ama.example.com"
```

The provider registration must allow the runner's fixed loopback redirect URI:
`http://127.0.0.1:49174/oauth/callback`.

## Managed instance

```bash
ama-runner start \
  --api-server "https://ama.example.com" \
  --project-id "project_..." \
  --environment-id "env_..." \
  --allow-unsafe-process
```

Common operator commands:

```bash
ama-runner list
ama-runner status runner_...
ama-runner stop runner_...
ama-runner restart runner_...
ama-runner logs --follow runner_...
ama-runner configure runner_... --max-concurrent 10
ama-runner configure runner_... --start-at-login=true
ama-runner remove runner_...
```

## Foreground instance

Use foreground mode in containers, development shells, or when another service
manager owns the process:

```bash
ama-runner run \
  --api-server "https://ama.example.com" \
  --project-id "project_..." \
  --environment-id "env_..." \
  --allow-unsafe-process
```

On Windows:

```powershell
.\ama-runner.exe run `
  --api-server $env:AMA_API_SERVER `
  --project-id $env:AMA_PROJECT_ID `
  --environment-id $env:AMA_ENVIRONMENT_ID
```

## Local files

Configuration, credentials, managed-instance definitions, state, workspaces,
logs, and session events use the platform-native configuration and state roots.
The following environment variables override the shared defaults where
supported:

- `AMA_RUNNER_CONFIG`
- `AMA_RUNNER_CREDENTIALS`
- `XDG_CONFIG_HOME`

Do not print, copy into logs, or commit provider access and refresh credentials.

When upgrading from the previous API-Server-only state layout, stop the old
process and move `runner-state.json`, `runner.lock`, and the complete `work`
directory into the Environment-specific instance directory before installing
the new binary. Preserve the complete `work` directory because it contains
operator recovery data.

## Process adapter safety

`--allow-unsafe-process` permits commands to execute directly on the Runner
host. Use it only on a trusted host for trusted workloads. Use an isolated
adapter for untrusted workloads.

Install the desired runtime CLIs for the same operating-system account that
runs the service. Keep AMA control-plane credentials and operator configuration
outside agent workspaces.

## Diagnostics

Start with:

```bash
ama-runner status runner_...
ama-runner logs --follow runner_...
```

Verify the configured API Server, Environment, provider login, runtime CLI
availability, writable state/work directories, and host clock. Consult the live
OpenAPI document for protocol shapes rather than adding endpoint documentation
to this runbook.
