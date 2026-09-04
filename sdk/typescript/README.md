# Enbor TypeScript SDK

The TypeScript SDK provides a stable resource facade over the Enbor
control-plane API. Its models and low-level operations are generated from
[`../openapi.json`](../openapi.json); this README documents the supported usage
patterns without duplicating the complete API contract.

Published versions are available from the public npm registry as
`@realmroot/enbor-sdk`.

```sh
pnpm add @realmroot/enbor-sdk
```

## Create a Client

For a client that has been assigned Bearer presentation, provide its access
token and Project id:

```ts
import { createEnborClient } from "@realmroot/enbor-sdk";

const client = createEnborClient({
  baseUrl: process.env.ENBOR_URL!,
  projectId: process.env.ENBOR_PROJECT_ID!,
  headers: {
    Authorization: `Bearer ${process.env.ENBOR_ACCESS_TOKEN!}`,
  },
});
```

For a DPoP client, provide a callback that returns a valid access token and a
fresh proof for the exact URL and HTTP method. The SDK attaches both headers:

```ts
const client = createEnborClient({
  baseUrl: process.env.ENBOR_URL!,
  projectId: process.env.ENBOR_PROJECT_ID!,
  authorize: async (url, method) => {
    return await realmrootAuthorizer.authorize({ url, method });
  },
});
```

`realmrootAuthorizer` represents the credential manager owned by the embedding
application; it is not exported by this package.

## Use Resource Facades

Resources are grouped under predictable properties:

```ts
const agents = await client.agents.list();
const environments = await client.environments.list();
const sessions = await client.sessions.list({ limit: 20 });

for (const agent of agents.data) {
  console.log(agent.metadata.uid, agent.metadata.name, agent.status.version);
}
```

Create an Agent and start a Session using typed request bodies:

```ts
const agent = await client.agents.create(
  {
    metadata: { name: "support-agent" },
    spec: {
      systemPrompt: "Resolve the request using the available workspace evidence.",
      provider: process.env.ENBOR_PROVIDER_ID!,
      model: process.env.ENBOR_MODEL_ID!,
      allowedTools: ["read", "grep"],
    },
  },
  crypto.randomUUID(),
);

const session = await client.sessions.create({
  spec: {
    agentId: agent.metadata.uid,
    environmentId: process.env.ENBOR_ENVIRONMENT_ID!,
    runtime: "codex",
  },
  prompt: "Inspect the workspace and summarize the current implementation.",
});
```

The optional second argument to `agents.create` is an idempotency key. Reuse
the same key only when retrying the same logical create request.

## Read and Continue a Session

Use REST methods for persisted state and history:

```ts
const current = await client.sessions.get(session.metadata.uid);
const events = await client.sessions.listEvents(session.metadata.uid, {
  limit: 100,
});

await client.sessions.createMessage(session.metadata.uid, {
  type: "prompt",
  requestId: crypto.randomUUID(),
  content: "Explain the most important tradeoff in more detail.",
});
```

Use `sessions.stream` for live events and prompt injection. DPoP-protected
Session sockets require the `authorize` callback shown above:

```ts
const stream = await client.sessions.stream(session.metadata.uid);

for await (const event of stream.events) {
  console.log(event.type, event.payload);
  if (event.type === "runtime.completed") break;
}

stream.close();
```

## Handle API Errors

Facade methods throw `EnborApiError` for non-success responses:

```ts
import { EnborApiError } from "@realmroot/enbor-sdk";

try {
  await client.agents.get("missing-agent");
} catch (error) {
  if (error instanceof EnborApiError) {
    console.error(error.status, error.responseText, error.body);
  } else {
    throw error;
  }
}
```

## Use the Generated Client

`client.raw` exposes the generated transport. Generated operation functions and
models are also exported from the package as an escape hatch. Prefer the stable
facade unless you need an operation it does not yet wrap.

See [Getting Started](../../docs/guides/getting-started.md) for the complete
first-Session flow. Observable behavior remains defined in
[`../../spec/`](../../spec/), and exact paths and schemas remain in the
[OpenAPI document](../openapi.json).
