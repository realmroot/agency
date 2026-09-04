# Enbor Python SDK

The Python SDK provides a resource-oriented facade over the Enbor control-plane
API. Its models and low-level operations are generated from
[`../openapi.json`](../openapi.json); this README documents normal SDK usage
without duplicating the complete API contract.

Install the published package from PyPI:

```bash
pip install enbor-sdk
```

The distribution exposes the `enbor_sdk` import package. Releases are published
with PyPI Trusted Publishing from the repository's `pypi` GitHub environment.

## Create a Client

```python
import os

from enbor_sdk import create_enbor_client

client = create_enbor_client(
    base_url=os.environ["ENBOR_URL"],
    project_id=os.environ["ENBOR_PROJECT_ID"],
    headers={
        "Authorization": f"Bearer {os.environ['ENBOR_ACCESS_TOKEN']}",
    },
)

agents = client.agents.list()
for agent in agents.data:
    print(agent.metadata.uid, agent.metadata.name)
```

The calling application owns Realmroot credential acquisition and refresh.
Supply the presentation mode assigned to that client; do not store access
tokens in Agent configuration or Session prompts.

## Create an Agent and Session

Request models are available from `enbor_sdk.models`:

```python
import os
import uuid

from enbor_sdk.models import (
    CreateAgentRequest,
    CreateAgentRequestSpec,
    CreateSessionRequest,
    ExecutionSpecInput,
    ResourceCreateMetadata,
    RuntimeName,
)

agent = client.agents.create(
    CreateAgentRequest(
        metadata=ResourceCreateMetadata(name="support-agent"),
        spec=CreateAgentRequestSpec(
            system_prompt="Resolve requests using workspace evidence.",
            provider=os.environ["ENBOR_PROVIDER_ID"],
            model=os.environ["ENBOR_MODEL_ID"],
            allowed_tools=["read", "grep"],
        ),
    ),
    idempotency_key=str(uuid.uuid4()),
)

session = client.sessions.create(
    CreateSessionRequest(
        spec=ExecutionSpecInput(
            agent_id=agent.metadata.uid,
            environment_id=os.environ["ENBOR_ENVIRONMENT_ID"],
            runtime=RuntimeName.CODEX,
        ),
        prompt="Inspect the workspace and summarize the implementation.",
    )
)
```

## Read Session State and Events

```python
current = client.sessions.get(session.metadata.uid)
events = client.sessions.list_events(session.metadata.uid)

print(current.status.phase)
for event in events.data:
    print(event.type_.value, event.payload)
```

Facade methods raise `EnborApiError` for non-success responses:

```python
from enbor_sdk import EnborApiError

try:
    client.agents.get("missing-agent")
except EnborApiError as error:
    print(error.status, error.response_text, error.body)
```

Use `client.raw` to access the generated client when an operation is not yet
covered by the facade.

See [Getting Started](../../docs/guides/getting-started.md) for the complete
workflow. Observable behavior remains defined in [`../../spec/`](../../spec/),
and exact paths and schemas remain in the [OpenAPI document](../openapi.json).
