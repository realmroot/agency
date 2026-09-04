# Getting Started with Enbor

This guide explains the shortest path from an Enbor deployment to a running
Session. It is a non-normative integration guide; the generated
[OpenAPI document](../../sdk/openapi.json) defines exact API shapes, and the
[product Features](../../spec/) define observable behavior.

This guide follows the application-SDK path. If an Agent should operate a live
Enbor deployment for you, first read
[Choose an Integration Path](choosing-an-integration-path.md) and use the
`operate-enbor` Skill instead of copying SDK credentials into the
Agent prompt.

## Choose an Execution Model

Enbor separates durable Agent configuration from the place where a Session
runs:

```text
Project -> Agent -> immutable Agent version
        -> Environment -> immutable Environment version
        -> Session -> runtime execution and durable events
```

Use a cloud Environment when Enbor should provision the execution workspace.
Use a self-hosted Environment and `enbor-runner` when work must execute on a
machine or network you control. A Session snapshots the selected Agent and
Environment versions so later configuration changes do not rewrite an active
or historical run.

## Before You Call the SDK

You need:

1. a reachable Enbor deployment URL;
2. a Realmroot-issued access token for the Enbor resource;
3. the Enbor Project id to use for project-scoped resources;
4. a provider and model available to the selected runtime; and
5. an Environment compatible with that runtime, unless the selected flow does
   not require an explicit Environment.

Token acquisition belongs to the calling application. The SDK accepts a
Bearer token through request headers, or a per-request DPoP authorizer where
the language SDK exposes one. Do not put access tokens in Agent configuration,
Session prompts, or committed source files.

## Complete a First Session

The TypeScript example below uses the stable resource facade. Replace the
deployment, Project, provider, model, and Environment values with resources
from your Enbor installation.

```ts
import { createEnborClient } from "@realmroot/enbor-sdk";

const client = createEnborClient({
  baseUrl: process.env.ENBOR_URL!,
  projectId: process.env.ENBOR_PROJECT_ID!,
  headers: {
    Authorization: `Bearer ${process.env.ENBOR_ACCESS_TOKEN!}`,
  },
});

const agent = await client.agents.create(
  {
    metadata: {
      name: "repository-reviewer",
      description: "Reviews a repository and reports actionable risks.",
    },
    spec: {
      systemPrompt: "Review the requested repository and cite concrete evidence.",
      provider: process.env.ENBOR_PROVIDER_ID!,
      model: process.env.ENBOR_MODEL_ID!,
      allowedTools: ["read", "grep"],
    },
  },
  crypto.randomUUID(),
);

const session = await client.sessions.create({
  metadata: { name: "First repository review" },
  spec: {
    agentId: agent.metadata.uid,
    environmentId: process.env.ENBOR_ENVIRONMENT_ID!,
    runtime: "codex",
  },
  prompt: "Inspect the repository and identify the three highest-risk issues.",
});

console.log(session.metadata.uid, session.status.phase);
```

The create call returns the durable Session resource. Read its current state
and persisted events through the same facade:

```ts
const current = await client.sessions.get(session.metadata.uid);
const events = await client.sessions.listEvents(session.metadata.uid);

console.log(current.status.phase);
for (const event of events.data) {
  console.log(event.type, event.payload);
}
```

For an interactive Session, open its event stream and send subsequent prompts:

```ts
const stream = await client.sessions.stream(session.metadata.uid);

await stream.send({
  type: "prompt",
  requestId: crypto.randomUUID(),
  content: "Now propose the smallest safe fix for the first issue.",
});

for await (const event of stream.events) {
  console.log(event.type, event.payload);
  if (event.type === "runtime.completed") break;
}

stream.close();
```

DPoP-protected WebSocket connections require the TypeScript client's
`authorize` callback rather than a static Bearer header. See the
[TypeScript SDK guide](../../sdk/typescript/README.md) for that configuration.

## Continue in Your Language

- [TypeScript SDK](../../sdk/typescript/README.md)
- [Go SDK](../../sdk/go/README.md)
- [Python SDK](../../sdk/python/README.md)

Use the stable facade methods shown in those guides for ordinary integration.
Use the generated low-level client only when you need an operation that the
facade does not yet expose. Consult the [OpenAPI document](../../sdk/openapi.json)
for the exact request, response, pagination, and error schemas.

## Next Steps

- For a self-hosted runtime, follow the
  [Runner operations guide](../infra/self-hosted-runner.md).
- For a new deployment, follow the
  [Cloudflare deployment guide](../infra/cloudflare-deploy.md).
- For design boundaries and rationale, read the
  [Architecture Decision Records](../adr/README.md).
