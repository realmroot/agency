# AMA Runner Architecture

This document fixes the target shape for the Go `ama-runner` implementation.
The goal is to keep the runner boring: one process that registers itself,
polls work, keeps a relay open, executes sandbox or external-runtime work, and
reports lease state through the Go AMA SDK.

## Principles

- Keep packages by capability, not by layer names.
- Keep CLI command assembly in `cmd/ama-runner/cmd`; keep config loading and
  credential helpers in `internal/cli` and `internal/config`.
- Keep the daemon package responsible for runner lifecycle, lease orchestration,
  and relay wiring.
- Keep reusable runner build metadata in `pkg/version`.
- Keep generated cross-language session event vocabulary in `pkg/sessionevent`.
- Keep sandbox mechanics in `internal/sandbox`.
- Keep CLI-backed runtime mechanics in `internal/runtime`.
- Keep workspace materialization in `internal/workspace`.
- Keep protocol-level `/workspace` path parsing in `internal/workspacepath` so
  logical paths have identical semantics on every host.
- Keep host-specific primitives in narrow `internal/sys/*` packages. Their
  callers must not branch on operating-system names or import OS-specific APIs.
- Do not introduce a runner-side AMA Server client abstraction. Runner code calls
  the Go SDK facade directly.
- Do not add objects unless they own a real lifecycle or invariant. A struct that
  only groups moved functions is not an improvement.
- Keep cross-language protocol surface small. The Go runner understands only the
  work payloads and relay/sandbox messages it must execute.

## Final Object Model

### `cmd.Root`

CLI command bootstrap:

- declares explicit `run`, managed lifecycle, auth, and version commands
- wires Viper-backed foreground configuration
- delegates local instance persistence to `instance.Registry`
- delegates native background service ownership to `managed.Controller`

The root command never starts a Runner implicitly.

### `instance.Registry`

Local managed Runner definitions:

- derives one stable instance id from normalized API Server and Environment id
- stores non-secret immutable instance identity and mutable runtime configuration
- stores the explicit login-startup policy, which defaults to disabled
- restores the shared credential-file reference for runtime use
- validates that managed state and work directories use the deterministic instance layout

### `managed.Controller`

Native process lifecycle:

- installs one user service per Runner instance through launchd, systemd, or Windows Service Control Manager
- starts installed services immediately without implicitly enabling login startup
- updates the persisted login-startup policy without interrupting a running service
- starts, stops, restarts, and disables that service
- waits for the daemon's first successful heartbeat readiness record
- reports native local state separately from AMA control-plane state
- owns local service logs without storing credentials

### `version.Info`

Build metadata shared by CLI output and runner registration/heartbeat metadata:

- binary name
- semantic release version
- commit
- build date

### `sessionevent`

Generated canonical session event vocabulary shared with TypeScript runtime
contracts:

- event type constants
- ordered canonical event type list
- canonical event type membership check

### `daemon.Daemon`

Long-lived runner process:

- registers or recovers runner identity
- sends heartbeats
- refreshes advertised runtime capabilities
- starts the per-runner relay hub
- polls work with bounded concurrency
- drains active leases on shutdown

It does not execute tool calls or runtime sessions directly.

### `daemon.LeaseWorker`

Single work lease orchestration:

- claims one work item
- parses work payload
- checks required runner capability
- renews the active lease
- runs tool work through `sandbox.SandboxAdapter`
- prepares session workspaces for AMA and CLI-backed runtime sessions
- starts AMA runtime sessions by registering a `session.SandboxHandle` for first-party tool execution
- starts CLI-backed runtime sessions through `runtime.Runner`
- completes, fails, cancels, or interrupts the lease through `ama.Client`

This is intentionally one object, not a stack of lifecycle/executor/finalizer
objects. A lease is the unit of orchestration.

### `session.Relay`, `session.HostHandle`, and `session.SandboxHandle`

Runner-hosted session relay:

- one shared runner channel
- session command routing by session id
- event backfill from local event store
- command delivery to CLI-backed runtime sessions
- sandbox request execution for AMA runtime sessions

The relay lives in `internal/session` because it is runner-hosted session
transport and server protocol wiring. It owns relay socket dispatch, live session
handles, and local event replay; `daemon` only registers the handle for the lease
it is currently running.

### `daemon.IdentityStore`

Persisted runner identity:

- machine id
- runner id
- state file read/write/clear

### `runtime.Inventory`

Reported runtimes:

- reports the first-party AMA runtime when the host supports its tool executor
- detects local runtime CLIs from the runtime registry
- asks `runtime.Bridge` to probe model availability
- tracks usage windows
- builds runtime capabilities and inventory for heartbeat metadata

### `runtime.Bridge`

Go client for the embedded TypeScript runtime bridge:

- materializes and starts the bundled bridge process
- sends bridge requests over NDJSON stdin
- reads session events, resume tokens, results, and errors from NDJSON stdout
- forwards control frames to the active bridge request
- probes model availability and provider usage through bridge commands

The bridge owns provider/runtime semantics in TypeScript. Go owns only the local
process boundary, environment boundary, and conversion into runner callbacks.

### `sys/host`, `sys/lockfile`, `sys/processtree`, `sys/securefile`, and `sys/userdirs`

Host integration primitives:

- reports build platform and host-supported runtime capabilities
- resolves native user configuration and state directories
- serializes credential and daemon ownership with native file locks
- writes credential and local configuration files with Unix owner-only modes or
  a protected Windows DACL for the current user and LocalSystem
- starts and terminates complete process trees through Unix process groups or Windows Job Objects

Each package exposes one platform-neutral contract and keeps its Unix and Windows
implementations in build-tagged files. Config, daemon, runtime, and sandbox code
consume those contracts without importing `syscall`, `x/sys/windows`, or checking
`runtime.GOOS`.

### `runtime.Runner`

CLI-backed runtime session execution:

- uses an injected adapter for tests or `runtime.Bridge` by default
- applies the session duration context
- emits runtime events through a callback
- reports whether the run timed out

It does not prepare workspaces, update AMA leases, capture memory-store snapshots,
or know about the runner relay hub. Those are lease orchestration concerns owned
by `daemon.LeaseWorker`.

## Rejected Shapes

- A separate `controlplane` package inside runner: rejected because AMA Server API
  calls belong behind the Go SDK facade, not a runner-specific adapter.
- `LeaseLifecycle` + `ToolLeaseExecutor` + `SessionLeaseExecutor` +
  `RuntimeSession`: rejected as too fragmented. They split one lease lifecycle
  into too many objects without enough independent invariants.
- Moving relay hub into `sandbox` or `runtime`: rejected because relay is
  runner-hosted session relay, command routing, sandbox request handling, and local event replay, not execution logic.
