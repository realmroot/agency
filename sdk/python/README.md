# Any Managed Agents Python SDK

This directory is the Python SDK package for the external Any Managed Agents
control-plane API.

The generated `ama_sdk.api` and `ama_sdk.models` modules come from
`sdk/openapi.json`. `ama_sdk.facade` is generated from
`sdk/spec/resources.json`, the shared SDK shape used by the TypeScript, Go, and
Python SDKs.

Regenerate generated operation metadata from the route-generated OpenAPI document:

```bash
pnpm run openapi:generate
python -m compileall sdk/python/ama_sdk
```

This package is not a pnpm workspace. It uses native Python package metadata and must remain generated from or mechanically aligned with `sdk/openapi.json` and `sdk/spec/resources.json`.
The canonical OpenAPI snapshot is `sdk/openapi.json`; this directory does not
carry its own OpenAPI copy.

Usage:

```python
from ama_sdk import AuthenticatedClient, create_ama_client
from ama_sdk.models.create_project_request import CreateProjectRequest

generated = AuthenticatedClient(base_url="https://ama.example.com", auth=realmroot_dpop_httpx_auth)
client = create_ama_client(base_url="https://ama.example.com", client=generated, project_id=project_id)

project = client.projects.create(CreateProjectRequest(name="Control Plane"))
```

Runner protocol calls use `create_ama_runner_client`. That facade contains work
item, lease, heartbeat, and runner channel methods that are intentionally absent
from the public `create_ama_client` facade.

```python
from ama_sdk import Client, create_ama_runner_client
from ama_sdk.models.put_runner_heartbeat_request import PutRunnerHeartbeatRequest
from ama_sdk.models.put_runner_heartbeat_request_state import PutRunnerHeartbeatRequestState

runner = create_ama_runner_client(
    base_url="https://ama.example.com",
    headers={"Authorization": f"Bearer {runner_access_token}"},
    client=Client(
        base_url="https://ama.example.com",
        headers={"Authorization": f"Bearer {runner_access_token}"},
    ),
    project_id=project_id,
)

runner.runners.put_heartbeat(
    runner_id,
    PutRunnerHeartbeatRequest(state=PutRunnerHeartbeatRequestState.ACTIVE),
)
```

The same Bearer header authenticates the HTTP calls and runner WebSocket
handshake. The token is never placed in the URL or WebSocket subprotocol.
