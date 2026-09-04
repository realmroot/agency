# Enbor Go SDK

The Go SDK provides typed resource services over the Enbor control-plane API.
Its models and low-level HTTP client are generated from
[`../openapi.json`](../openapi.json); this README documents normal SDK usage
without duplicating the complete API contract.

Go resolves releases directly from the repository using the module path
`github.com/realmroot/enbor/sdk/go` and `sdk/go/v*` module tags.

```bash
go get github.com/realmroot/enbor/sdk/go@latest
```

The package name is `enbor`.

## Create a Client

```go
package main

import (
	"context"
	"fmt"
	"os"

	enbor "github.com/realmroot/enbor/sdk/go"
)

func main() {
	client, err := enbor.New(enbor.ClientConfig{
		BaseURL:   os.Getenv("ENBOR_URL"),
		ProjectID: os.Getenv("ENBOR_PROJECT_ID"),
		Headers: map[string]string{
			"Authorization": "Bearer " + os.Getenv("ENBOR_ACCESS_TOKEN"),
		},
	})
	if err != nil {
		panic(err)
	}

	agents, err := client.Agents.List(context.Background(), nil)
	if err != nil {
		panic(err)
	}
	for _, agent := range agents.Data {
		fmt.Println(agent.Metadata.Uid, agent.Metadata.Name)
	}
}
```

The caller owns Realmroot credential acquisition and refresh. Supply the
presentation mode assigned to that client; never persist an access token in an
Agent or Session resource.

## Create an Agent and Session

Generated Go request types preserve the OpenAPI shape. The Agent request has a
typed anonymous `Spec`, so initialize the request and then assign its fields:

```go
ctx := context.Background()
provider := os.Getenv("ENBOR_PROVIDER_ID")
model := os.Getenv("ENBOR_MODEL_ID")
tools := []string{"read", "grep"}

agentRequest := enbor.CreateAgentRequest{
	Metadata: enbor.ResourceCreateMetadata{Name: "support-agent"},
}
agentRequest.Spec.SystemPrompt = "Resolve requests using workspace evidence."
agentRequest.Spec.Provider = &provider
agentRequest.Spec.Model = &model
agentRequest.Spec.AllowedTools = &tools

agent, err := client.Agents.Create(ctx, agentRequest)
if err != nil {
	panic(err)
}

environmentID := os.Getenv("ENBOR_ENVIRONMENT_ID")
runtime := enbor.RuntimeNameCodex
session, err := client.Sessions.Create(ctx, enbor.CreateSessionRequest{
	Spec: enbor.ExecutionSpecInput{
		AgentId:       agent.Metadata.Uid,
		EnvironmentId: &environmentID,
		Runtime:       &runtime,
	},
	Prompt: "Inspect the workspace and summarize the implementation.",
})
if err != nil {
	panic(err)
}
```

## Read Session State and Events

```go
current, err := client.Sessions.Get(ctx, session.Metadata.Uid)
if err != nil {
	panic(err)
}

events, err := client.Sessions.ListEvents(ctx, session.Metadata.Uid, nil)
if err != nil {
	panic(err)
}

fmt.Println(current.Status.Phase)
fmt.Printf("received %d persisted events\n", len(events.Data))
```

`SessionEvent` is a generated union. Use its `AsSessionEventN` conversion
methods when you need the typed payload for a specific event variant; consult
the OpenAPI document for the discriminator-to-variant mapping.

Facade methods return `*enbor.APIError` for non-success HTTP responses. Use
`enbor.StatusCode(err)` when branching on the response status.

`client.Raw()` exposes the generated `ClientWithResponses` when an operation is
not yet covered by a resource service.

See [Getting Started](../../docs/guides/getting-started.md) for the complete
workflow. Observable behavior remains defined in [`../../spec/`](../../spec/),
and exact paths and schemas remain in the [OpenAPI document](../openapi.json).
