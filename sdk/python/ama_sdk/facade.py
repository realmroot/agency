from __future__ import annotations

import asyncio
import json
from collections.abc import AsyncIterator
from typing import Any
from urllib.parse import quote, urlencode, urlparse, urlunparse

import websockets

from .client import AuthenticatedClient, Client
from .api.agents import create_agent as create_agent_api
from .api.agents import list_agent_versions as list_agent_versions_api
from .api.agents import list_agents as list_agents_api
from .api.agents import read_agent as read_agent_api
from .api.agents import read_agent_version as read_agent_version_api
from .api.agents import update_agent as update_agent_api
from .api.audit import list_audit_records as list_audit_records_api
from .api.audit import read_audit_record as read_audit_record_api
from .api.auth import create_auth_session as create_auth_session_api
from .api.auth import delete_current_auth_session as delete_current_auth_session_api
from .api.auth import read_auth_config as read_auth_config_api
from .api.auth import read_current_auth_session as read_current_auth_session_api
from .api.config import read_configz as read_configz_api
from .api.connectors import list_connectors as list_connectors_api
from .api.connectors import read_connector as read_connector_api
from .api.environments import create_environment as create_environment_api
from .api.environments import list_environment_versions as list_environment_versions_api
from .api.environments import list_environments as list_environments_api
from .api.environments import read_environment as read_environment_api
from .api.environments import read_environment_version as read_environment_version_api
from .api.environments import update_environment as update_environment_api
from .api.governance import create_budget as create_budget_api
from .api.governance import delete_budget as delete_budget_api
from .api.governance import list_budgets as list_budgets_api
from .api.governance import read_budget as read_budget_api
from .api.governance import update_budget as update_budget_api
from .api.leases import create_lease as create_lease_api
from .api.leases import list_leases as list_leases_api
from .api.leases import read_lease as read_lease_api
from .api.leases import update_lease as update_lease_api
from .api.memory_stores import create_memory_store as create_memory_store_api
from .api.memory_stores import create_memory_store_memory as create_memory_store_memory_api
from .api.memory_stores import delete_memory_store_memory as delete_memory_store_memory_api
from .api.memory_stores import list_memory_store_memories as list_memory_store_memories_api
from .api.memory_stores import list_memory_stores as list_memory_stores_api
from .api.memory_stores import read_memory_store as read_memory_store_api
from .api.memory_stores import update_memory_store as update_memory_store_api
from .api.memory_stores import update_memory_store_memory as update_memory_store_memory_api
from .api.projects import create_project as create_project_api
from .api.projects import list_projects as list_projects_api
from .api.projects import read_project as read_project_api
from .api.providers import list_models as list_models_api
from .api.providers import list_provider_models as list_provider_models_api
from .api.providers import list_providers as list_providers_api
from .api.providers import read_provider as read_provider_api
from .api.providers import refresh_catalog as refresh_catalog_api
from .api.runners import create_runner as create_runner_api
from .api.runners import list_runners as list_runners_api
from .api.runners import put_runner_heartbeat as put_runner_heartbeat_api
from .api.runners import read_runner as read_runner_api
from .api.runners import read_runner_heartbeat as read_runner_heartbeat_api
from .api.runners import update_runner as update_runner_api
from .api.sessions import create_session as create_session_api
from .api.sessions import create_session_events as create_session_events_api
from .api.sessions import create_session_message as create_session_message_api
from .api.sessions import decide_session_approval as decide_session_approval_api
from .api.sessions import list_session_approvals as list_session_approvals_api
from .api.sessions import list_session_events as list_session_events_api
from .api.sessions import list_session_messages as list_session_messages_api
from .api.sessions import list_sessions as list_sessions_api
from .api.sessions import read_session as read_session_api
from .api.sessions import read_session_approval as read_session_approval_api
from .api.sessions import read_session_message as read_session_message_api
from .api.sessions import update_session as update_session_api
from .api.triggers import create_trigger as create_trigger_api
from .api.triggers import create_trigger_run as create_trigger_run_api
from .api.triggers import delete_trigger as delete_trigger_api
from .api.triggers import list_trigger_runs as list_trigger_runs_api
from .api.triggers import list_triggers as list_triggers_api
from .api.triggers import read_trigger as read_trigger_api
from .api.triggers import read_trigger_run as read_trigger_run_api
from .api.triggers import update_trigger as update_trigger_api
from .api.usage import list_usage_records as list_usage_records_api
from .api.usage import read_usage_record as read_usage_record_api
from .api.usage import read_usage_summary as read_usage_summary_api
from .api.vaults import create_vault as create_vault_api
from .api.vaults import create_vault_credential as create_vault_credential_api
from .api.vaults import list_vault_credential_versions as list_vault_credential_versions_api
from .api.vaults import list_vault_credentials as list_vault_credentials_api
from .api.vaults import list_vaults as list_vaults_api
from .api.vaults import read_vault as read_vault_api
from .api.vaults import read_vault_credential as read_vault_credential_api
from .api.vaults import read_vault_credential_version as read_vault_credential_version_api
from .api.vaults import update_vault as update_vault_api
from .api.vaults import update_vault_credential as update_vault_credential_api
from .api.vaults import update_vault_credential_secret as update_vault_credential_secret_api
from .api.work_items import list_work_items as list_work_items_api
from .api.work_items import read_work_item as read_work_item_api


class AmaApiError(Exception):
    def __init__(self, status: int | None, response_text: str, body: Any) -> None:
        super().__init__(f"AMA API request failed{'' if status is None else f' with HTTP {status}'}")
        self.status = status
        self.response_text = response_text
        self.body = body


class JsonWebSocket:
    def __init__(self, url: str, headers: dict[str, str]) -> None:
        self.url = url
        self.headers = headers
        self._socket: Any | None = None

    async def connect(self) -> "JsonWebSocket":
        self._socket = await websockets.connect(self.url, additional_headers=self.headers or None)
        return self

    async def __aenter__(self) -> "JsonWebSocket":
        return await self.connect()

    async def __aexit__(self, *args: Any) -> None:
        await self.close()

    def _connected(self) -> Any:
        if self._socket is None:
            raise RuntimeError("WebSocket is not connected; use 'async with' or await connect().")
        return self._socket

    async def recv_json(self) -> Any:
        return json.loads(await self._connected().recv())

    async def send_json(self, value: Any) -> None:
        await self._connected().send(json.dumps(value))

    async def close(self, code: int = 1000, reason: str = "") -> None:
        if self._socket is not None:
            await self._socket.close(code=code, reason=reason)
            self._socket = None


class RunnerChannel(JsonWebSocket):
    async def messages(self) -> AsyncIterator[Any]:
        while True:
            yield await self.recv_json()

    async def send(self, message: Any) -> None:
        await self.send_json(message)


class SessionStream(JsonWebSocket):
    def __init__(self, url: str, headers: dict[str, str]) -> None:
        super().__init__(url, headers)
        self._events: asyncio.Queue[Any | None] = asyncio.Queue()
        self._messages: asyncio.Queue[Any | None] = asyncio.Queue()
        self._backfills: dict[str, asyncio.Future[Any]] = {}
        self._reader: asyncio.Task[None] | None = None
        self._backfill_seq = 0

    async def connect(self) -> "SessionStream":
        await super().connect()
        self._reader = asyncio.create_task(self._read_loop())
        return self

    async def _read_loop(self) -> None:
        try:
            async for message in self._connected():
                socket_message = json.loads(message)
                message_type = socket_message.get("type") if isinstance(socket_message, dict) else None
                if message_type == "event":
                    await self._events.put(socket_message.get("record"))
                elif message_type == "backfill":
                    request_id = socket_message.get("requestId")
                    future = self._backfills.pop(request_id, None)
                    if future is not None and not future.done():
                        future.set_result(socket_message)
                else:
                    await self._messages.put(socket_message)
        except Exception as error:
            for future in self._backfills.values():
                if not future.done():
                    future.set_exception(error)
            self._backfills.clear()
        finally:
            await self._events.put(None)
            await self._messages.put(None)

    async def events(self) -> AsyncIterator[Any]:
        while True:
            event = await self._events.get()
            if event is None:
                return
            yield event

    async def messages(self) -> AsyncIterator[Any]:
        while True:
            message = await self._messages.get()
            if message is None:
                return
            yield message

    async def send(self, message: Any) -> None:
        await self.send_json(message)

    async def backfill(self, **options: Any) -> Any:
        self._backfill_seq += 1
        request_id = f"bf_{self._backfill_seq}"
        future: asyncio.Future[Any] = asyncio.get_running_loop().create_future()
        self._backfills[request_id] = future
        await self.send_json({"type": "backfill", "requestId": request_id, **options})
        return await future

    async def close(self, code: int = 1000, reason: str = "") -> None:
        if self._reader is not None:
            self._reader.cancel()
            self._reader = None
        await super().close(code=code, reason=reason)


class _ClientCore:
    def __init__(
        self,
        base_url: str,
        access_token: str | None = None,
        project_id: str | None = None,
        headers: dict[str, str] | None = None,
        client: AuthenticatedClient | Client | None = None,
    ) -> None:
        merged_headers = dict(headers or {})
        if project_id:
            merged_headers["x-ama-project-id"] = project_id
        self.base_url = base_url
        self.access_token = access_token
        self.project_id = project_id
        self.headers = merged_headers
        self.client = client or _new_generated_client(base_url, access_token, merged_headers)

    @property
    def raw(self) -> AuthenticatedClient | Client:
        return self.client


class AmaClient:
    def __init__(
        self,
        base_url: str,
        access_token: str | None = None,
        project_id: str | None = None,
        headers: dict[str, str] | None = None,
        client: AuthenticatedClient | Client | None = None,
    ) -> None:
        self._core = _ClientCore(base_url, access_token, project_id, headers, client)
        self.configz = _ConfigzResource(self._core)
        self.auth = _AuthResource(self._core)
        self.projects = _ProjectsResource(self._core)
        self.agents = _AgentsResource(self._core)
        self.environments = _EnvironmentsResource(self._core)
        self.providers = _ProvidersResource(self._core)
        self.runners = _RunnersResource(self._core)
        self.budgets = _BudgetsResource(self._core)
        self.connectors = _ConnectorsResource(self._core)
        self.audit = _AuditResource(self._core)
        self.triggers = _TriggersResource(self._core)
        self.sessions = _SessionsResource(self._core)
        self.memory_stores = _MemoryStoresResource(self._core)
        self.vaults = _VaultsResource(self._core)
        self.usage = _UsageResource(self._core)

    @property
    def raw(self) -> AuthenticatedClient | Client:
        return self._core.raw


class AmaRunnerClient:
    def __init__(
        self,
        base_url: str,
        access_token: str | None = None,
        project_id: str | None = None,
        headers: dict[str, str] | None = None,
        client: AuthenticatedClient | Client | None = None,
    ) -> None:
        self._core = _ClientCore(base_url, access_token, project_id, headers, client)
        self.configz = _RunnerConfigzResource(self._core)
        self.runners = _RunnerRunnersResource(self._core)
        self.work_items = _RunnerWorkItemsResource(self._core)
        self.leases = _RunnerLeasesResource(self._core)
        self.sessions = _RunnerSessionsResource(self._core)

    @property
    def raw(self) -> AuthenticatedClient | Client:
        return self._core.raw


def create_ama_client(
    base_url: str,
    access_token: str | None = None,
    project_id: str | None = None,
    headers: dict[str, str] | None = None,
) -> AmaClient:
    return AmaClient(base_url=base_url, access_token=access_token, project_id=project_id, headers=headers)


def create_ama_runner_client(
    base_url: str,
    access_token: str | None = None,
    project_id: str | None = None,
    headers: dict[str, str] | None = None,
) -> AmaRunnerClient:
    return AmaRunnerClient(base_url=base_url, access_token=access_token, project_id=project_id, headers=headers)


def _new_generated_client(base_url: str, access_token: str | None, headers: dict[str, str]) -> AuthenticatedClient | Client:
    if access_token:
        return AuthenticatedClient(base_url=base_url, token=access_token, headers=headers)
    return Client(base_url=base_url, headers=headers)


def _websocket_url(base_url: str, path: str, access_token: str | None, project_id: str | None) -> str:
    parsed = urlparse(base_url.rstrip("/") + path)
    if parsed.scheme == "https":
        scheme = "wss"
    elif parsed.scheme == "http":
        scheme = "ws"
    else:
        raise ValueError("AMA base URL must use http or https")
    query = {}
    if access_token:
        query["access_token"] = access_token
    if project_id:
        query["x-ama-project-id"] = project_id
    return urlunparse((scheme, parsed.netloc, parsed.path, "", urlencode(query), ""))


def _websocket_headers(headers: dict[str, str], access_token: str | None, project_id: str | None) -> dict[str, str]:
    result = dict(headers)
    if access_token:
        result["authorization"] = f"Bearer {access_token}"
    if project_id:
        result["x-ama-project-id"] = project_id
    return result


def _unwrap(response: Any) -> Any:
    status = int(response.status_code)
    if 200 <= status <= 299:
        return response.parsed
    body = response.parsed
    response_text = getattr(body, "error", None)
    if response_text is not None and getattr(response_text, "message", None):
        text = response_text.message
    else:
        text = response.content.decode("utf-8", errors="replace") if response.content else ""
    raise AmaApiError(status, text, body)


class _ConfigzResource:
    def __init__(self, owner: _ClientCore) -> None:
        self._owner = owner
        self._client = owner.raw

    def get(self) -> Any:
        return _unwrap(read_configz_api.sync_detailed(client=self._client))

class _AuthResource:
    def __init__(self, owner: _ClientCore) -> None:
        self._owner = owner
        self._client = owner.raw

    def config(self, **query: Any) -> Any:
        return _unwrap(read_auth_config_api.sync_detailed(client=self._client, **query))

    def create_session(self, body: Any) -> Any:
        return _unwrap(create_auth_session_api.sync_detailed(client=self._client, body=body))

    def current_session(self) -> Any:
        return _unwrap(read_current_auth_session_api.sync_detailed(client=self._client))

    def delete_current_session(self) -> Any:
        return _unwrap(delete_current_auth_session_api.sync_detailed(client=self._client))

class _ProjectsResource:
    def __init__(self, owner: _ClientCore) -> None:
        self._owner = owner
        self._client = owner.raw

    def list(self, **query: Any) -> Any:
        return _unwrap(list_projects_api.sync_detailed(client=self._client, **query))

    def create(self, body: Any) -> Any:
        return _unwrap(create_project_api.sync_detailed(client=self._client, body=body))

    def get(self, project_id: str) -> Any:
        return _unwrap(read_project_api.sync_detailed(project_id=project_id, client=self._client))

class _AgentsResource:
    def __init__(self, owner: _ClientCore) -> None:
        self._owner = owner
        self._client = owner.raw

    def list(self, **query: Any) -> Any:
        return _unwrap(list_agents_api.sync_detailed(client=self._client, **query))

    def create(self, body: Any) -> Any:
        return _unwrap(create_agent_api.sync_detailed(client=self._client, body=body))

    def get(self, agent_id: str) -> Any:
        return _unwrap(read_agent_api.sync_detailed(agent_id=agent_id, client=self._client))

    def update(self, agent_id: str, body: Any) -> Any:
        return _unwrap(update_agent_api.sync_detailed(agent_id=agent_id, client=self._client, body=body))

    def list_versions(self, agent_id: str) -> Any:
        return _unwrap(list_agent_versions_api.sync_detailed(agent_id=agent_id, client=self._client))

    def get_version(self, agent_id: str, version: int) -> Any:
        return _unwrap(read_agent_version_api.sync_detailed(agent_id=agent_id, version=version, client=self._client))

class _EnvironmentsResource:
    def __init__(self, owner: _ClientCore) -> None:
        self._owner = owner
        self._client = owner.raw

    def list(self, **query: Any) -> Any:
        return _unwrap(list_environments_api.sync_detailed(client=self._client, **query))

    def create(self, body: Any) -> Any:
        return _unwrap(create_environment_api.sync_detailed(client=self._client, body=body))

    def get(self, environment_id: str) -> Any:
        return _unwrap(read_environment_api.sync_detailed(environment_id=environment_id, client=self._client))

    def update(self, environment_id: str, body: Any) -> Any:
        return _unwrap(update_environment_api.sync_detailed(environment_id=environment_id, client=self._client, body=body))

    def list_versions(self, environment_id: str) -> Any:
        return _unwrap(list_environment_versions_api.sync_detailed(environment_id=environment_id, client=self._client))

    def get_version(self, environment_id: str, version: int) -> Any:
        return _unwrap(read_environment_version_api.sync_detailed(environment_id=environment_id, version=version, client=self._client))

class _ProvidersResource:
    def __init__(self, owner: _ClientCore) -> None:
        self._owner = owner
        self._client = owner.raw

    def list(self) -> Any:
        return _unwrap(list_providers_api.sync_detailed(client=self._client))

    def list_models(self) -> Any:
        return _unwrap(list_models_api.sync_detailed(client=self._client))

    def refresh_catalog(self) -> Any:
        return _unwrap(refresh_catalog_api.sync_detailed(client=self._client))

    def get(self, provider_id: str) -> Any:
        return _unwrap(read_provider_api.sync_detailed(provider_id=provider_id, client=self._client))

    def list_provider_models(self, provider_id: str) -> Any:
        return _unwrap(list_provider_models_api.sync_detailed(provider_id=provider_id, client=self._client))

class _RunnersResource:
    def __init__(self, owner: _ClientCore) -> None:
        self._owner = owner
        self._client = owner.raw

    def list(self, **query: Any) -> Any:
        return _unwrap(list_runners_api.sync_detailed(client=self._client, **query))

    def create(self, body: Any) -> Any:
        return _unwrap(create_runner_api.sync_detailed(client=self._client, body=body))

    def get(self, runner_id: str) -> Any:
        return _unwrap(read_runner_api.sync_detailed(runner_id=runner_id, client=self._client))

    def update(self, runner_id: str, body: Any) -> Any:
        return _unwrap(update_runner_api.sync_detailed(runner_id=runner_id, client=self._client, body=body))

class _BudgetsResource:
    def __init__(self, owner: _ClientCore) -> None:
        self._owner = owner
        self._client = owner.raw

    def list(self) -> Any:
        return _unwrap(list_budgets_api.sync_detailed(client=self._client))

    def create(self, body: Any) -> Any:
        return _unwrap(create_budget_api.sync_detailed(client=self._client, body=body))

    def get(self, budget_id: str) -> Any:
        return _unwrap(read_budget_api.sync_detailed(budget_id=budget_id, client=self._client))

    def update(self, budget_id: str, body: Any) -> Any:
        return _unwrap(update_budget_api.sync_detailed(budget_id=budget_id, client=self._client, body=body))

    def delete(self, budget_id: str) -> Any:
        return _unwrap(delete_budget_api.sync_detailed(budget_id=budget_id, client=self._client))

class _ConnectorsResource:
    def __init__(self, owner: _ClientCore) -> None:
        self._owner = owner
        self._client = owner.raw

    def list(self, **query: Any) -> Any:
        return _unwrap(list_connectors_api.sync_detailed(client=self._client, **query))

    def get(self, connector_id: str) -> Any:
        return _unwrap(read_connector_api.sync_detailed(connector_id=connector_id, client=self._client))

class _AuditResource:
    def __init__(self, owner: _ClientCore) -> None:
        self._owner = owner
        self._client = owner.raw

    def list_records(self, **query: Any) -> Any:
        return _unwrap(list_audit_records_api.sync_detailed(client=self._client, **query))

    def get_record(self, record_id: str) -> Any:
        return _unwrap(read_audit_record_api.sync_detailed(record_id=record_id, client=self._client))

class _TriggersResource:
    def __init__(self, owner: _ClientCore) -> None:
        self._owner = owner
        self._client = owner.raw

    def list(self, **query: Any) -> Any:
        return _unwrap(list_triggers_api.sync_detailed(client=self._client, **query))

    def create(self, body: Any) -> Any:
        return _unwrap(create_trigger_api.sync_detailed(client=self._client, body=body))

    def get(self, trigger_id: str) -> Any:
        return _unwrap(read_trigger_api.sync_detailed(trigger_id=trigger_id, client=self._client))

    def update(self, trigger_id: str, body: Any) -> Any:
        return _unwrap(update_trigger_api.sync_detailed(trigger_id=trigger_id, client=self._client, body=body))

    def delete(self, trigger_id: str) -> Any:
        return _unwrap(delete_trigger_api.sync_detailed(trigger_id=trigger_id, client=self._client))

    def list_runs(self, trigger_id: str, **query: Any) -> Any:
        return _unwrap(list_trigger_runs_api.sync_detailed(trigger_id=trigger_id, client=self._client, **query))

    def create_run(self, trigger_id: str, body: Any) -> Any:
        return _unwrap(create_trigger_run_api.sync_detailed(trigger_id=trigger_id, client=self._client, body=body))

    def get_run(self, trigger_id: str, run_id: str) -> Any:
        return _unwrap(read_trigger_run_api.sync_detailed(trigger_id=trigger_id, run_id=run_id, client=self._client))

class _SessionsResource:
    def __init__(self, owner: _ClientCore) -> None:
        self._owner = owner
        self._client = owner.raw

    def list(self, **query: Any) -> Any:
        return _unwrap(list_sessions_api.sync_detailed(client=self._client, **query))

    def create(self, body: Any) -> Any:
        return _unwrap(create_session_api.sync_detailed(client=self._client, body=body))

    def get(self, session_id: str) -> Any:
        return _unwrap(read_session_api.sync_detailed(session_id=session_id, client=self._client))

    def update(self, session_id: str, body: Any) -> Any:
        return _unwrap(update_session_api.sync_detailed(session_id=session_id, client=self._client, body=body))

    def stream(self, session_id: str) -> SessionStream:
        return SessionStream(
            _websocket_url(self._owner.base_url, f"/api/v1/sessions/{quote(session_id)}/socket", self._owner.access_token, self._owner.project_id),
            _websocket_headers(self._owner.headers, self._owner.access_token, self._owner.project_id),
        )

    def list_messages(self, session_id: str, **query: Any) -> Any:
        return _unwrap(list_session_messages_api.sync_detailed(session_id=session_id, client=self._client, **query))

    def create_message(self, session_id: str, body: Any) -> Any:
        return _unwrap(create_session_message_api.sync_detailed(session_id=session_id, client=self._client, body=body))

    def get_message(self, session_id: str, message_id: str) -> Any:
        return _unwrap(read_session_message_api.sync_detailed(session_id=session_id, message_id=message_id, client=self._client))

    def list_events(self, session_id: str, **query: Any) -> Any:
        return _unwrap(list_session_events_api.sync_detailed(session_id=session_id, client=self._client, **query))

    def list_approvals(self, session_id: str) -> Any:
        return _unwrap(list_session_approvals_api.sync_detailed(session_id=session_id, client=self._client))

    def get_approval(self, session_id: str, approval_id: str) -> Any:
        return _unwrap(read_session_approval_api.sync_detailed(session_id=session_id, approval_id=approval_id, client=self._client))

    def decide_approval(self, session_id: str, approval_id: str, body: Any) -> Any:
        return _unwrap(decide_session_approval_api.sync_detailed(session_id=session_id, approval_id=approval_id, client=self._client, body=body))

class _MemoryStoresResource:
    def __init__(self, owner: _ClientCore) -> None:
        self._owner = owner
        self._client = owner.raw

    def list(self, **query: Any) -> Any:
        return _unwrap(list_memory_stores_api.sync_detailed(client=self._client, **query))

    def create(self, body: Any) -> Any:
        return _unwrap(create_memory_store_api.sync_detailed(client=self._client, body=body))

    def get(self, store_id: str) -> Any:
        return _unwrap(read_memory_store_api.sync_detailed(store_id=store_id, client=self._client))

    def update(self, store_id: str, body: Any) -> Any:
        return _unwrap(update_memory_store_api.sync_detailed(store_id=store_id, client=self._client, body=body))

    def list_memories(self, store_id: str, **query: Any) -> Any:
        return _unwrap(list_memory_store_memories_api.sync_detailed(store_id=store_id, client=self._client, **query))

    def create_memory(self, store_id: str, body: Any) -> Any:
        return _unwrap(create_memory_store_memory_api.sync_detailed(store_id=store_id, client=self._client, body=body))

    def update_memory(self, store_id: str, memory_id: str, body: Any) -> Any:
        return _unwrap(update_memory_store_memory_api.sync_detailed(store_id=store_id, memory_id=memory_id, client=self._client, body=body))

    def delete_memory(self, store_id: str, memory_id: str) -> Any:
        return _unwrap(delete_memory_store_memory_api.sync_detailed(store_id=store_id, memory_id=memory_id, client=self._client))

class _VaultsResource:
    def __init__(self, owner: _ClientCore) -> None:
        self._owner = owner
        self._client = owner.raw

    def list(self, **query: Any) -> Any:
        return _unwrap(list_vaults_api.sync_detailed(client=self._client, **query))

    def create(self, body: Any) -> Any:
        return _unwrap(create_vault_api.sync_detailed(client=self._client, body=body))

    def get(self, vault_id: str) -> Any:
        return _unwrap(read_vault_api.sync_detailed(vault_id=vault_id, client=self._client))

    def update(self, vault_id: str, body: Any) -> Any:
        return _unwrap(update_vault_api.sync_detailed(vault_id=vault_id, client=self._client, body=body))

    def list_credentials(self, vault_id: str, **query: Any) -> Any:
        return _unwrap(list_vault_credentials_api.sync_detailed(vault_id=vault_id, client=self._client, **query))

    def create_credential(self, vault_id: str, body: Any) -> Any:
        return _unwrap(create_vault_credential_api.sync_detailed(vault_id=vault_id, client=self._client, body=body))

    def get_credential(self, vault_id: str, credential_id: str) -> Any:
        return _unwrap(read_vault_credential_api.sync_detailed(vault_id=vault_id, credential_id=credential_id, client=self._client))

    def update_credential(self, vault_id: str, credential_id: str, body: Any) -> Any:
        return _unwrap(update_vault_credential_api.sync_detailed(vault_id=vault_id, credential_id=credential_id, client=self._client, body=body))

    def update_credential_secret(self, vault_id: str, credential_id: str, body: Any) -> Any:
        return _unwrap(update_vault_credential_secret_api.sync_detailed(vault_id=vault_id, credential_id=credential_id, client=self._client, body=body))

    def list_credential_versions(self, vault_id: str, credential_id: str, **query: Any) -> Any:
        return _unwrap(list_vault_credential_versions_api.sync_detailed(vault_id=vault_id, credential_id=credential_id, client=self._client, **query))

    def get_credential_version(self, vault_id: str, credential_id: str, version_id: str) -> Any:
        return _unwrap(read_vault_credential_version_api.sync_detailed(vault_id=vault_id, credential_id=credential_id, version_id=version_id, client=self._client))

class _UsageResource:
    def __init__(self, owner: _ClientCore) -> None:
        self._owner = owner
        self._client = owner.raw

    def list_records(self, **query: Any) -> Any:
        return _unwrap(list_usage_records_api.sync_detailed(client=self._client, **query))

    def get_record(self, record_id: str) -> Any:
        return _unwrap(read_usage_record_api.sync_detailed(record_id=record_id, client=self._client))

    def get_summary(self, **query: Any) -> Any:
        return _unwrap(read_usage_summary_api.sync_detailed(client=self._client, **query))

class _RunnerConfigzResource:
    def __init__(self, owner: _ClientCore) -> None:
        self._owner = owner
        self._client = owner.raw

    def get(self) -> Any:
        return _unwrap(read_configz_api.sync_detailed(client=self._client))

class _RunnerRunnersResource:
    def __init__(self, owner: _ClientCore) -> None:
        self._owner = owner
        self._client = owner.raw

    def list(self, **query: Any) -> Any:
        return _unwrap(list_runners_api.sync_detailed(client=self._client, **query))

    def create(self, body: Any) -> Any:
        return _unwrap(create_runner_api.sync_detailed(client=self._client, body=body))

    def get(self, runner_id: str) -> Any:
        return _unwrap(read_runner_api.sync_detailed(runner_id=runner_id, client=self._client))

    def update(self, runner_id: str, body: Any) -> Any:
        return _unwrap(update_runner_api.sync_detailed(runner_id=runner_id, client=self._client, body=body))

    def channel(self, runner_id: str) -> RunnerChannel:
        return RunnerChannel(
            _websocket_url(self._owner.base_url, f"/api/v1/runners/{quote(runner_id)}/channel", self._owner.access_token, self._owner.project_id),
            _websocket_headers(self._owner.headers, self._owner.access_token, self._owner.project_id),
        )

    def get_heartbeat(self, runner_id: str) -> Any:
        return _unwrap(read_runner_heartbeat_api.sync_detailed(runner_id=runner_id, client=self._client))

    def put_heartbeat(self, runner_id: str, body: Any) -> Any:
        return _unwrap(put_runner_heartbeat_api.sync_detailed(runner_id=runner_id, client=self._client, body=body))

class _RunnerWorkItemsResource:
    def __init__(self, owner: _ClientCore) -> None:
        self._owner = owner
        self._client = owner.raw

    def list(self, **query: Any) -> Any:
        return _unwrap(list_work_items_api.sync_detailed(client=self._client, **query))

    def get(self, work_item_id: str) -> Any:
        return _unwrap(read_work_item_api.sync_detailed(work_item_id=work_item_id, client=self._client))

class _RunnerLeasesResource:
    def __init__(self, owner: _ClientCore) -> None:
        self._owner = owner
        self._client = owner.raw

    def list(self, **query: Any) -> Any:
        return _unwrap(list_leases_api.sync_detailed(client=self._client, **query))

    def create(self, body: Any) -> Any:
        return _unwrap(create_lease_api.sync_detailed(client=self._client, body=body))

    def get(self, lease_id: str) -> Any:
        return _unwrap(read_lease_api.sync_detailed(lease_id=lease_id, client=self._client))

    def update(self, lease_id: str, body: Any) -> Any:
        return _unwrap(update_lease_api.sync_detailed(lease_id=lease_id, client=self._client, body=body))

class _RunnerSessionsResource:
    def __init__(self, owner: _ClientCore) -> None:
        self._owner = owner
        self._client = owner.raw

    def create_events(self, session_id: str, body: Any) -> Any:
        return _unwrap(create_session_events_api.sync_detailed(session_id=session_id, client=self._client, body=body))
