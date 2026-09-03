# Self-Hosted Enbor Runner Operations

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
Windows arm64 is compile-checked but is not a supported release target. Tags
matching `v*` publish archives and `checksums.txt` through GoReleaser, plus a
multi-architecture Linux image at `ghcr.io/realmroot/enbor-runner`.

## Install

Install the latest release with Homebrew on macOS or Linux:

```bash
brew install realmroot/tap/enbor-runner
```

The Formula installs the release archive for the current operating system and
CPU architecture. It is updated automatically by the `realmroot/homebrew-tap`
repository after a new Enbor Runner release is published.

## Authenticate

Authenticate with the configured OAuth 2.0 and OpenID Connect provider before
starting the daemon. Realmroot is the current provider. Select the personal or
organization context that owns the AMA project.

```bash
enbor-runner auth login --api-server "https://ama.example.com"
```

The provider registration must allow the runner's fixed loopback redirect URI:
`http://127.0.0.1:49174/oauth/callback`.

## Managed instance

```bash
enbor-runner start \
  --api-server "https://ama.example.com" \
  --project-id "project_..." \
  --environment-id "env_..." \
  --allow-unsafe-process
```

Common operator commands:

```bash
enbor-runner list
enbor-runner status runner_...
enbor-runner stop runner_...
enbor-runner restart runner_...
enbor-runner logs --follow runner_...
enbor-runner configure runner_... --max-concurrent 10
enbor-runner configure runner_... --start-at-login=true
enbor-runner configure runner_... --start-at-login=false
enbor-runner remove runner_...
```

## Foreground instance

Use foreground mode in containers, development shells, or when another service
manager owns the process:

```bash
enbor-runner run \
  --api-server "https://ama.example.com" \
  --project-id "project_..." \
  --environment-id "env_..." \
  --allow-unsafe-process
```

On Windows:

```powershell
.\enbor-runner.exe run `
  --api-server $env:AMA_API_SERVER `
  --project-id $env:AMA_PROJECT_ID `
  --environment-id $env:AMA_ENVIRONMENT_ID
```

The Enbor name changes the executable but deliberately keeps the existing
`AMA_RUNNER_*` environment variables, `ama-runner` state directories, managed
service identifiers, Go module paths, and `ama-runner-work` protocol identifier.
Existing Runner state therefore remains reusable and the control-plane protocol
does not change as part of packaging.

## Docker

Authenticate once with the native binary, then mount its credential directory
into the container. Pre-create host-owned state and workspace directories and
run the container with the host UID/GID so the mode-`0600` credential remains
readable and new files remain owned by the operator. Foreground `run` mode is
required because native launchd/systemd management does not apply in a container:

```bash
mkdir -p "$HOME/.local/state/enbor-runner-container" "$PWD/.enbor-work"
docker run --rm \
  --name enbor-runner \
  --user "$(id -u):$(id -g)" \
  --env HOME=/tmp \
  --env AMA_RUNNER_CREDENTIALS=/enbor/config/credentials.json \
  --volume "$HOME/.config/ama-runner:/enbor/config" \
  --volume "$HOME/.local/state/enbor-runner-container:/enbor/state" \
  --volume "$PWD/.enbor-work:/workspace" \
  ghcr.io/realmroot/enbor-runner:latest run \
  --api-server "https://ama.example.com" \
  --project-id "project_..." \
  --environment-id "env_..." \
  --state-dir /enbor/state \
  --work-dir /workspace \
  --allow-unsafe-process
```

The image includes Node.js, Git, and an SSH client. It does not bundle provider
CLIs. Build a derived image with pinned `codex`, `claude`, or `copilot` versions
when that runtime should be advertised.

## Provider permission policy

The runner accepts provider permission policy through host environment
variables. Managed `enbor-runner start` installations copy these values into the
native user service when the instance is created; foreground `enbor-runner run`
reads them from its process environment.

| Variable | Allowed values | Default |
| --- | --- | --- |
| `AMA_CODEX_SANDBOX_MODE` | `read-only`, `workspace-write`, `danger-full-access` | `danger-full-access` |
| `AMA_CODEX_APPROVAL_POLICY` | `never`, `on-request`, `untrusted`; deprecated `on-failure` remains accepted for the pinned SDK | `never` |
| `AMA_CLAUDE_CODE_PERMISSION_MODE` | `default`, `acceptEdits`, `bypassPermissions`, `plan`, `dontAsk`, `auto` | `bypassPermissions` |

Codex enterprise users can keep the workspace sandbox and send escalations
through their configured reviewer:

```bash
AMA_CODEX_SANDBOX_MODE=workspace-write \
AMA_CODEX_APPROVAL_POLICY=on-request \
enbor-runner start \
  --api-server "https://ama.example.com" \
  --project-id "project_..." \
  --environment-id "env_..." \
  --allow-unsafe-process
```

Claude Code sets its dangerous-skip flag only for `bypassPermissions`. For
example, a runner can use Claude Code's model-reviewed permission mode with
`AMA_CLAUDE_CODE_PERMISSION_MODE=auto`. The runner rejects unknown values
before provider execution. Session environment variables cannot change these
settings because AMA reserves the `AMA_` prefix for runner-owned configuration.

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
enbor-runner status runner_...
enbor-runner logs --follow runner_...
```

Verify the configured API Server, Environment, provider login, runtime CLI
availability, writable state/work directories, and host clock. Consult the live
OpenAPI document for protocol shapes rather than adding endpoint documentation
to this runbook.
