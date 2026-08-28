from http import HTTPStatus
from typing import Any, cast
from urllib.parse import quote

import httpx

from ...client import AuthenticatedClient, Client
from ...types import Response, UNSET
from ... import errors

from ...models.agent_list_response import AgentListResponse
from ...models.error_response import ErrorResponse
from ...models.list_agents_archived import ListAgentsArchived
from ...models.list_agents_has_identity import ListAgentsHasIdentity
from ...types import UNSET, Unset
from typing import cast
import datetime



def _get_kwargs(
    *,
    archived: ListAgentsArchived | Unset = UNSET,
    search: str | Unset = UNSET,
    created_from: datetime.datetime | Unset = UNSET,
    created_to: datetime.datetime | Unset = UNSET,
    limit: int | Unset = UNSET,
    cursor: str | Unset = UNSET,
    has_identity: ListAgentsHasIdentity | Unset = UNSET,

) -> dict[str, Any]:
    

    

    params: dict[str, Any] = {}

    json_archived: str | Unset = UNSET
    if not isinstance(archived, Unset):
        json_archived = archived.value

    params["archived"] = json_archived

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

    json_has_identity: str | Unset = UNSET
    if not isinstance(has_identity, Unset):
        json_has_identity = has_identity.value

    params["hasIdentity"] = json_has_identity


    params = {k: v for k, v in params.items() if v is not UNSET and v is not None}


    _kwargs: dict[str, Any] = {
        "method": "get",
        "url": "/api/v1/agents",
        "params": params,
    }


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
    archived: ListAgentsArchived | Unset = UNSET,
    search: str | Unset = UNSET,
    created_from: datetime.datetime | Unset = UNSET,
    created_to: datetime.datetime | Unset = UNSET,
    limit: int | Unset = UNSET,
    cursor: str | Unset = UNSET,
    has_identity: ListAgentsHasIdentity | Unset = UNSET,

) -> Response[AgentListResponse | ErrorResponse]:
    """ List agents

    Args:
        archived (ListAgentsArchived | Unset): Filter by lifecycle. Defaults to false (live
            resources only). Example: false.
        search (str | Unset):  Example: research.
        created_from (datetime.datetime | Unset):  Example: 2026-05-01T00:00:00.000Z.
        created_to (datetime.datetime | Unset):  Example: 2026-05-31T23:59:59.999Z.
        limit (int | Unset):  Example: 50.
        cursor (str | Unset):  Example:
            eyJjcmVhdGVkQXQiOiIyMDI2LTA1LTIyVDAwOjAwOjAwLjAwMFoiLCJpZCI6ImFnZW50X2FiYzEyMyJ9.
        has_identity (ListAgentsHasIdentity | Unset): Filter Agents by whether a Realmroot
            identity is present. Example: true.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[AgentListResponse | ErrorResponse]
     """


    kwargs = _get_kwargs(
        archived=archived,
search=search,
created_from=created_from,
created_to=created_to,
limit=limit,
cursor=cursor,
has_identity=has_identity,

    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)

def sync(
    *,
    client: AuthenticatedClient,
    archived: ListAgentsArchived | Unset = UNSET,
    search: str | Unset = UNSET,
    created_from: datetime.datetime | Unset = UNSET,
    created_to: datetime.datetime | Unset = UNSET,
    limit: int | Unset = UNSET,
    cursor: str | Unset = UNSET,
    has_identity: ListAgentsHasIdentity | Unset = UNSET,

) -> AgentListResponse | ErrorResponse | None:
    """ List agents

    Args:
        archived (ListAgentsArchived | Unset): Filter by lifecycle. Defaults to false (live
            resources only). Example: false.
        search (str | Unset):  Example: research.
        created_from (datetime.datetime | Unset):  Example: 2026-05-01T00:00:00.000Z.
        created_to (datetime.datetime | Unset):  Example: 2026-05-31T23:59:59.999Z.
        limit (int | Unset):  Example: 50.
        cursor (str | Unset):  Example:
            eyJjcmVhdGVkQXQiOiIyMDI2LTA1LTIyVDAwOjAwOjAwLjAwMFoiLCJpZCI6ImFnZW50X2FiYzEyMyJ9.
        has_identity (ListAgentsHasIdentity | Unset): Filter Agents by whether a Realmroot
            identity is present. Example: true.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        AgentListResponse | ErrorResponse
     """


    return sync_detailed(
        client=client,
archived=archived,
search=search,
created_from=created_from,
created_to=created_to,
limit=limit,
cursor=cursor,
has_identity=has_identity,

    ).parsed

async def asyncio_detailed(
    *,
    client: AuthenticatedClient,
    archived: ListAgentsArchived | Unset = UNSET,
    search: str | Unset = UNSET,
    created_from: datetime.datetime | Unset = UNSET,
    created_to: datetime.datetime | Unset = UNSET,
    limit: int | Unset = UNSET,
    cursor: str | Unset = UNSET,
    has_identity: ListAgentsHasIdentity | Unset = UNSET,

) -> Response[AgentListResponse | ErrorResponse]:
    """ List agents

    Args:
        archived (ListAgentsArchived | Unset): Filter by lifecycle. Defaults to false (live
            resources only). Example: false.
        search (str | Unset):  Example: research.
        created_from (datetime.datetime | Unset):  Example: 2026-05-01T00:00:00.000Z.
        created_to (datetime.datetime | Unset):  Example: 2026-05-31T23:59:59.999Z.
        limit (int | Unset):  Example: 50.
        cursor (str | Unset):  Example:
            eyJjcmVhdGVkQXQiOiIyMDI2LTA1LTIyVDAwOjAwOjAwLjAwMFoiLCJpZCI6ImFnZW50X2FiYzEyMyJ9.
        has_identity (ListAgentsHasIdentity | Unset): Filter Agents by whether a Realmroot
            identity is present. Example: true.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[AgentListResponse | ErrorResponse]
     """


    kwargs = _get_kwargs(
        archived=archived,
search=search,
created_from=created_from,
created_to=created_to,
limit=limit,
cursor=cursor,
has_identity=has_identity,

    )

    response = await client.get_async_httpx_client().request(
        **kwargs
    )

    return _build_response(client=client, response=response)

async def asyncio(
    *,
    client: AuthenticatedClient,
    archived: ListAgentsArchived | Unset = UNSET,
    search: str | Unset = UNSET,
    created_from: datetime.datetime | Unset = UNSET,
    created_to: datetime.datetime | Unset = UNSET,
    limit: int | Unset = UNSET,
    cursor: str | Unset = UNSET,
    has_identity: ListAgentsHasIdentity | Unset = UNSET,

) -> AgentListResponse | ErrorResponse | None:
    """ List agents

    Args:
        archived (ListAgentsArchived | Unset): Filter by lifecycle. Defaults to false (live
            resources only). Example: false.
        search (str | Unset):  Example: research.
        created_from (datetime.datetime | Unset):  Example: 2026-05-01T00:00:00.000Z.
        created_to (datetime.datetime | Unset):  Example: 2026-05-31T23:59:59.999Z.
        limit (int | Unset):  Example: 50.
        cursor (str | Unset):  Example:
            eyJjcmVhdGVkQXQiOiIyMDI2LTA1LTIyVDAwOjAwOjAwLjAwMFoiLCJpZCI6ImFnZW50X2FiYzEyMyJ9.
        has_identity (ListAgentsHasIdentity | Unset): Filter Agents by whether a Realmroot
            identity is present. Example: true.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        AgentListResponse | ErrorResponse
     """


    return (await asyncio_detailed(
        client=client,
archived=archived,
search=search,
created_from=created_from,
created_to=created_to,
limit=limit,
cursor=cursor,
has_identity=has_identity,

    )).parsed
