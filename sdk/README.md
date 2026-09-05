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

### Retrying Session creation

Persist a unique `Idempotency-Key` with the exact Session creation request before
sending it. Reuse both after a timeout or lost response. Keys are scoped to a
Project: concurrent requests with the same key and inputs return the same
Session, while different inputs return HTTP 409. A deleted Session retains its
key reservation and also returns 409; use a new key for a new execution.

The TypeScript facade accepts the key as the second argument to
`client.sessions.create(request, key)`. Go exposes `Sessions.CreateWithParams`
and Python accepts `idempotency_key` in `sessions.create`.

For keyed creation, Enbor commits the Session and its startup work together.
Runner work remains available after an interrupted notification; cloud startup
delivery is recovered by the scheduled worker. A successful create or replay
identifies the Session, but does not prove that its workspace or runtime is
ready. Observe that Session's state and events separately.

These guides describe integration patterns and deliberately do not duplicate
the full endpoint catalog. The generated [OpenAPI JSON](openapi.json) remains
the exact source for paths, request and response schemas, authentication
requirements, errors, and generated models.

Start with the repository-level [Getting Started guide](../docs/guides/getting-started.md),
then open the guide for your language.

The SDK is the right interface for application code. When an Agent needs to
operate a live Enbor deployment on a user's behalf, follow
[Choose an Integration Path](../docs/guides/choosing-an-integration-path.md)
and use the `operate-enbor` Skill so identity, authorization, and
operation discovery remain outside application examples.
