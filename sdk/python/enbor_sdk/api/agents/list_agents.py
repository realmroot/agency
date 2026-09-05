from http import HTTPStatus
from typing import Any, cast
from urllib.parse import quote

import httpx

from ...client import AuthenticatedClient, Client
from ...types import Response, UNSET
from ... import errors

from ...models.agent_list_response import AgentListResponse
from ...models.error_response import ErrorResponse
from ...models.list_agents_identity_bound import ListAgentsIdentityBound
from ...models.list_agents_runtime import ListAgentsRuntime
from ...models.list_agents_schedulable import ListAgentsSchedulable
from ...types import UNSET, Unset
from typing import cast
import datetime



def _get_kwargs(
    *,
    search: str | Unset = UNSET,
    created_from: datetime.datetime | Unset = UNSET,
    created_to: datetime.datetime | Unset = UNSET,
    limit: int | Unset = UNSET,
    cursor: str | Unset = UNSET,
    identity_bound: ListAgentsIdentityBound | Unset = UNSET,
    identity_agent_id: str | Unset = UNSET,
    runtime: ListAgentsRuntime | Unset = UNSET,
    schedulable: ListAgentsSchedulable | Unset = UNSET,
    x_enbor_project_id: str | Unset = UNSET,

) -> dict[str, Any]:
    headers: dict[str, Any] = {}
    if not isinstance(x_enbor_project_id, Unset):
        headers["X-Enbor-Project-ID"] = x_enbor_project_id





    params: dict[str, Any] = {}

    params["search"] = search

    json_created_from: str | Unset = UNSET
    if not isinstance(created_from, Unset):
        json_created_from = created_from.isoformat()
    params["createdFrom"] = json_created_from

    json_created_to: str | Unset = UNSET
    if not isinstance(created_to, Unset):
        json_created_to = created_to.isoformat()
    params["createdTo"] = json_created_to

    params["limit"] = limit

    params["cursor"] = cursor

    json_identity_bound: str | Unset = UNSET
    if not isinstance(identity_bound, Unset):
        json_identity_bound = identity_bound.value

    params["identityBound"] = json_identity_bound

    params["identityAgentId"] = identity_agent_id

    json_runtime: str | Unset = UNSET
    if not isinstance(runtime, Unset):
        json_runtime = runtime.value

    params["runtime"] = json_runtime

    json_schedulable: str | Unset = UNSET
    if not isinstance(schedulable, Unset):
        json_schedulable = schedulable.value

    params["schedulable"] = json_schedulable


    params = {k: v for k, v in params.items() if v is not UNSET and v is not None}


    _kwargs: dict[str, Any] = {
        "method": "get",
        "url": "/api/v1/agents",
        "params": params,
    }


    _kwargs["headers"] = headers
    return _kwargs



def _parse_response(*, client: AuthenticatedClient | Client, response: httpx.Response) -> AgentListResponse | ErrorResponse | None:
    if response.status_code == 200:
        response_200 = AgentListResponse.from_dict(response.json())



        return response_200

    if response.status_code == 400:
        response_400 = ErrorResponse.from_dict(response.json())



        return response_400

    if response.status_code == 401:
        response_401 = ErrorResponse.from_dict(response.json())



        return response_401

    if response.status_code == 403:
        response_403 = ErrorResponse.from_dict(response.json())



        return response_403

    if response.status_code == 404:
        response_404 = ErrorResponse.from_dict(response.json())



        return response_404

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(*, client: AuthenticatedClient | Client, response: httpx.Response) -> Response[AgentListResponse | ErrorResponse]:
    return Response(
        status_code=HTTPStatus(response.status_code),
        content=response.content,
        headers=response.headers,
        parsed=_parse_response(client=client, response=response),
    )


def sync_detailed(
    *,
    client: AuthenticatedClient,
    search: str | Unset = UNSET,
    created_from: datetime.datetime | Unset = UNSET,
    created_to: datetime.datetime | Unset = UNSET,
    limit: int | Unset = UNSET,
    cursor: str | Unset = UNSET,
    identity_bound: ListAgentsIdentityBound | Unset = UNSET,
    identity_agent_id: str | Unset = UNSET,
    runtime: ListAgentsRuntime | Unset = UNSET,
    schedulable: ListAgentsSchedulable | Unset = UNSET,
    x_enbor_project_id: str | Unset = UNSET,

) -> Response[AgentListResponse | ErrorResponse]:
    """ List agents

    Args:
        search (str | Unset):  Example: research.
        created_from (datetime.datetime | Unset):  Example: 2026-05-01T00:00:00.000Z.
        created_to (datetime.datetime | Unset):  Example: 2026-05-31T23:59:59.999Z.
        limit (int | Unset):  Example: 50.
        cursor (str | Unset):  Example:
            eyJjcmVhdGVkQXQiOiIyMDI2LTA1LTIyVDAwOjAwOjAwLjAwMFoiLCJpZCI6ImFnZW50X2FiYzEyMyJ9.
        identity_bound (ListAgentsIdentityBound | Unset): Filter by whether an Identity is bound,
            independently of scheduling readiness. Example: true.
        identity_agent_id (str | Unset): Exact Realmroot Agent actor id bound through the Agent
            Identity. Example: 019ff41a-7da6-708f-8b05-44d4d0373685.
        runtime (ListAgentsRuntime | Unset): Exact runtime of the bound Realmroot Identity.
            Example: codex.
        schedulable (ListAgentsSchedulable | Unset): Filter by current Inbox scheduling readiness.
            Example: true.
        x_enbor_project_id (str | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[AgentListResponse | ErrorResponse]
     """


    kwargs = _get_kwargs(
        search=search,
created_from=created_from,
created_to=created_to,
limit=limit,
cursor=cursor,
identity_bound=identity_bound,
identity_agent_id=identity_agent_id,
runtime=runtime,
schedulable=schedulable,
x_enbor_project_id=x_enbor_project_id,

    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)

def sync(
    *,
    client: AuthenticatedClient,
    search: str | Unset = UNSET,
    created_from: datetime.datetime | Unset = UNSET,
    created_to: datetime.datetime | Unset = UNSET,
    limit: int | Unset = UNSET,
    cursor: str | Unset = UNSET,
    identity_bound: ListAgentsIdentityBound | Unset = UNSET,
    identity_agent_id: str | Unset = UNSET,
    runtime: ListAgentsRuntime | Unset = UNSET,
    schedulable: ListAgentsSchedulable | Unset = UNSET,
    x_enbor_project_id: str | Unset = UNSET,

) -> AgentListResponse | ErrorResponse | None:
    """ List agents

    Args:
        search (str | Unset):  Example: research.
        created_from (datetime.datetime | Unset):  Example: 2026-05-01T00:00:00.000Z.
        created_to (datetime.datetime | Unset):  Example: 2026-05-31T23:59:59.999Z.
        limit (int | Unset):  Example: 50.
        cursor (str | Unset):  Example:
            eyJjcmVhdGVkQXQiOiIyMDI2LTA1LTIyVDAwOjAwOjAwLjAwMFoiLCJpZCI6ImFnZW50X2FiYzEyMyJ9.
        identity_bound (ListAgentsIdentityBound | Unset): Filter by whether an Identity is bound,
            independently of scheduling readiness. Example: true.
        identity_agent_id (str | Unset): Exact Realmroot Agent actor id bound through the Agent
            Identity. Example: 019ff41a-7da6-708f-8b05-44d4d0373685.
        runtime (ListAgentsRuntime | Unset): Exact runtime of the bound Realmroot Identity.
            Example: codex.
        schedulable (ListAgentsSchedulable | Unset): Filter by current Inbox scheduling readiness.
            Example: true.
        x_enbor_project_id (str | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        AgentListResponse | ErrorResponse
     """


    return sync_detailed(
        client=client,
search=search,
created_from=created_from,
created_to=created_to,
limit=limit,
cursor=cursor,
identity_bound=identity_bound,
identity_agent_id=identity_agent_id,
runtime=runtime,
schedulable=schedulable,
x_enbor_project_id=x_enbor_project_id,

    ).parsed

async def asyncio_detailed(
    *,
    client: AuthenticatedClient,
    search: str | Unset = UNSET,
    created_from: datetime.datetime | Unset = UNSET,
    created_to: datetime.datetime | Unset = UNSET,
    limit: int | Unset = UNSET,
    cursor: str | Unset = UNSET,
    identity_bound: ListAgentsIdentityBound | Unset = UNSET,
    identity_agent_id: str | Unset = UNSET,
    runtime: ListAgentsRuntime | Unset = UNSET,
    schedulable: ListAgentsSchedulable | Unset = UNSET,
    x_enbor_project_id: str | Unset = UNSET,

) -> Response[AgentListResponse | ErrorResponse]:
    """ List agents

    Args:
        search (str | Unset):  Example: research.
        created_from (datetime.datetime | Unset):  Example: 2026-05-01T00:00:00.000Z.
        created_to (datetime.datetime | Unset):  Example: 2026-05-31T23:59:59.999Z.
        limit (int | Unset):  Example: 50.
        cursor (str | Unset):  Example:
            eyJjcmVhdGVkQXQiOiIyMDI2LTA1LTIyVDAwOjAwOjAwLjAwMFoiLCJpZCI6ImFnZW50X2FiYzEyMyJ9.
        identity_bound (ListAgentsIdentityBound | Unset): Filter by whether an Identity is bound,
            independently of scheduling readiness. Example: true.
        identity_agent_id (str | Unset): Exact Realmroot Agent actor id bound through the Agent
            Identity. Example: 019ff41a-7da6-708f-8b05-44d4d0373685.
        runtime (ListAgentsRuntime | Unset): Exact runtime of the bound Realmroot Identity.
            Example: codex.
        schedulable (ListAgentsSchedulable | Unset): Filter by current Inbox scheduling readiness.
            Example: true.
        x_enbor_project_id (str | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[AgentListResponse | ErrorResponse]
     """


    kwargs = _get_kwargs(
        search=search,
created_from=created_from,
created_to=created_to,
limit=limit,
cursor=cursor,
identity_bound=identity_bound,
identity_agent_id=identity_agent_id,
runtime=runtime,
schedulable=schedulable,
x_enbor_project_id=x_enbor_project_id,

    )

    response = await client.get_async_httpx_client().request(
        **kwargs
    )

    return _build_response(client=client, response=response)

async def asyncio(
    *,
    client: AuthenticatedClient,
    search: str | Unset = UNSET,
    created_from: datetime.datetime | Unset = UNSET,
    created_to: datetime.datetime | Unset = UNSET,
    limit: int | Unset = UNSET,
    cursor: str | Unset = UNSET,
    identity_bound: ListAgentsIdentityBound | Unset = UNSET,
    identity_agent_id: str | Unset = UNSET,
    runtime: ListAgentsRuntime | Unset = UNSET,
    schedulable: ListAgentsSchedulable | Unset = UNSET,
    x_enbor_project_id: str | Unset = UNSET,

) -> AgentListResponse | ErrorResponse | None:
    """ List agents

    Args:
        search (str | Unset):  Example: research.
        created_from (datetime.datetime | Unset):  Example: 2026-05-01T00:00:00.000Z.
        created_to (datetime.datetime | Unset):  Example: 2026-05-31T23:59:59.999Z.
        limit (int | Unset):  Example: 50.
        cursor (str | Unset):  Example:
            eyJjcmVhdGVkQXQiOiIyMDI2LTA1LTIyVDAwOjAwOjAwLjAwMFoiLCJpZCI6ImFnZW50X2FiYzEyMyJ9.
        identity_bound (ListAgentsIdentityBound | Unset): Filter by whether an Identity is bound,
            independently of scheduling readiness. Example: true.
        identity_agent_id (str | Unset): Exact Realmroot Agent actor id bound through the Agent
            Identity. Example: 019ff41a-7da6-708f-8b05-44d4d0373685.
        runtime (ListAgentsRuntime | Unset): Exact runtime of the bound Realmroot Identity.
            Example: codex.
        schedulable (ListAgentsSchedulable | Unset): Filter by current Inbox scheduling readiness.
            Example: true.
        x_enbor_project_id (str | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        AgentListResponse | ErrorResponse
     """


    return (await asyncio_detailed(
        client=client,
search=search,
created_from=created_from,
created_to=created_to,
limit=limit,
cursor=cursor,
identity_bound=identity_bound,
identity_agent_id=identity_agent_id,
runtime=runtime,
schedulable=schedulable,
x_enbor_project_id=x_enbor_project_id,

    )).parsed
