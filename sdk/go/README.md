# Any Managed Agents Go SDK

This directory is the Go SDK module for the external Any Managed Agents
control-plane API.

`ama.gen.go` is generated from `sdk/openapi.json`. `ama/client.go` contains the
stable facades generated from `sdk/spec/resources.json`, the shared SDK shape
used by the TypeScript, Go, and Python SDKs.

Regenerate generated operation metadata from the route-generated OpenAPI document:

```bash
pnpm run openapi:generate
go test ./...
```

This module is not a pnpm workspace. It uses native Go module metadata and must remain generated from or mechanically aligned with `sdk/openapi.json` and `sdk/spec/resources.json`.
The canonical OpenAPI snapshot is `sdk/openapi.json`; this directory does not
carry its own OpenAPI copy.

Usage:

```go
client, err := ama.New(ama.ClientConfig{
	BaseURL:    "https://ama.example.com",
	HTTPClient: realmrootDPoPHTTPClient,
	ProjectID:  projectID,
})
if err != nil {
	return err
}

project, err := client.Projects.Create(ctx, ama.CreateProjectRequest{Name: "Control Plane"})
```

Runner protocol calls use `ama.NewRunner`. That facade contains work item,
lease, heartbeat, and runner channel methods that are intentionally absent from
the public `ama.New` client.

```go
runner, err := ama.NewRunner(ama.ClientConfig{
	BaseURL:    "https://ama.example.com",
	HTTPClient: runnerBearerHTTPClient,
	ProjectID:  projectID,
})
if err != nil {
	return err
}

state := ama.PutRunnerHeartbeatRequestStateActive
_, err = runner.Runners.PutHeartbeat(ctx, runnerID, ama.PutRunnerHeartbeatRequest{State: &state})
```

`runnerBearerHTTPClient` supplies the short-lived Realmroot runner token as an
`Authorization: Bearer` header for both HTTP requests and the WebSocket
handshake. It must not place the token in the URL or WebSocket subprotocol.
