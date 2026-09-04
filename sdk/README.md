# Enbor SDKs

Enbor publishes TypeScript, Go, and Python clients generated from the same
[OpenAPI document](openapi.json). Each SDK also exposes a stable resource
facade so application code can use predictable `<resource>.<operation>` calls
without depending directly on generated operation names.

| Language | Package | Guide |
| --- | --- | --- |
| TypeScript | `@realmroot/enbor-sdk` | [TypeScript](typescript/README.md) |
| Go | `github.com/realmroot/enbor/sdk/go` | [Go](go/README.md) |
| Python | `enbor-sdk` | [Python](python/README.md) |

## Shared Client Configuration

Every SDK needs:

- the base URL of an Enbor deployment;
- a Realmroot-issued credential for that Enbor resource; and
- a Project id for project-scoped operations.

The SDKs do not perform an interactive Realmroot login. The embedding
application obtains and refreshes credentials, then supplies them to the SDK.
Bearer clients can provide an `Authorization` header. DPoP clients must produce
a fresh proof for each HTTP request; the TypeScript SDK supports this with an
`authorize(url, method)` callback.

## Stable Facades and Generated Clients

The stable facades group operations by resource:

```text
client.projects
client.agents
client.identities
client.environments
client.providers
client.runners
client.connectors
client.sessions
client.memoryStores / client.memory_stores
client.vaults
client.triggers
client.audit
client.usage
```

Naming follows each language's conventions. For example, listing Agents is
`client.agents.list()` in TypeScript, `client.Agents.List(...)` in Go, and
`client.agents.list()` in Python.

Each facade exposes its underlying generated client through `raw`. Prefer the
facade for normal application code and use `raw` only when an operation is not
yet covered by the stable surface.

## API Contract

These guides describe integration patterns and deliberately do not duplicate
the full endpoint catalog. The generated [OpenAPI JSON](openapi.json) remains
the exact source for paths, request and response schemas, authentication
requirements, errors, and generated models.

Start with the repository-level [Getting Started guide](../docs/guides/getting-started.md),
then open the guide for your language.
