from http import HTTPStatus
from typing import Any, cast
from urllib.parse import quote

import httpx

from ...client import AuthenticatedClient, Client
from ...types import Response, UNSET
from ... import errors

from ...models.error_response import ErrorResponse
from ...models.list_triggers_archived import ListTriggersArchived
from ...models.list_triggers_suspend import ListTriggersSuspend
from ...models.trigger_list_response import TriggerListResponse
from ...types import UNSET, Unset
from typing import cast
import datetime



def _get_kwargs(
    *,
    archived: ListTriggersArchived | Unset = UNSET,
    search: str | Unset = UNSET,
    created_from: datetime.datetime | Unset = UNSET,
    created_to: datetime.datetime | Unset = UNSET,
    limit: int | Unset = UNSET,
    cursor: str | Unset = UNSET,
    suspend: ListTriggersSuspend | Unset = UNSET,
    x_ama_project_id: str | Unset = UNSET,

) -> dict[str, Any]:
    headers: dict[str, Any] = {}
    if not isinstance(x_ama_project_id, Unset):
        headers["X-AMA-Project-ID"] = x_ama_project_id





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

    json_suspend: str | Unset = UNSET
    if not isinstance(suspend, Unset):
        json_suspend = suspend.value

    params["suspend"] = json_suspend


    params = {k: v for k, v in params.items() if v is not UNSET and v is not None}


    _kwargs: dict[str, Any] = {
        "method": "get",
        "url": "/api/v1/triggers",
        "params": params,
    }


    _kwargs["headers"] = headers
    return _kwargs



def _parse_response(*, client: AuthenticatedClient | Client, response: httpx.Response) -> ErrorResponse | TriggerListResponse | None:
    if response.status_code == 200:
        response_200 = TriggerListResponse.from_dict(response.json())



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


def _build_response(*, client: AuthenticatedClient | Client, response: httpx.Response) -> Response[ErrorResponse | TriggerListResponse]:
    return Response(
        status_code=HTTPStatus(response.status_code),
        content=response.content,
        headers=response.headers,
        parsed=_parse_response(client=client, response=response),
    )


def sync_detailed(
    *,
    client: AuthenticatedClient,
    archived: ListTriggersArchived | Unset = UNSET,
    search: str | Unset = UNSET,
    created_from: datetime.datetime | Unset = UNSET,
    created_to: datetime.datetime | Unset = UNSET,
    limit: int | Unset = UNSET,
    cursor: str | Unset = UNSET,
    suspend: ListTriggersSuspend | Unset = UNSET,
    x_ama_project_id: str | Unset = UNSET,

) -> Response[ErrorResponse | TriggerListResponse]:
    """ List triggers

    Args:
        archived (ListTriggersArchived | Unset): Filter by lifecycle. Defaults to false (live
            resources only). Example: false.
        search (str | Unset):  Example: research.
        created_from (datetime.datetime | Unset):  Example: 2026-05-01T00:00:00.000Z.
        created_to (datetime.datetime | Unset):  Example: 2026-05-31T23:59:59.999Z.
        limit (int | Unset):  Example: 50.
        cursor (str | Unset):  Example:
            eyJjcmVhdGVkQXQiOiIyMDI2LTA1LTIyVDAwOjAwOjAwLjAwMFoiLCJpZCI6ImFnZW50X2FiYzEyMyJ9.
        suspend (ListTriggersSuspend | Unset): Filter by the operational toggle. Example: false.
        x_ama_project_id (str | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[ErrorResponse | TriggerListResponse]
     """


    kwargs = _get_kwargs(
        archived=archived,
search=search,
created_from=created_from,
created_to=created_to,
limit=limit,
cursor=cursor,
suspend=suspend,
x_ama_project_id=x_ama_project_id,

    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)

def sync(
    *,
    client: AuthenticatedClient,
    archived: ListTriggersArchived | Unset = UNSET,
    search: str | Unset = UNSET,
    created_from: datetime.datetime | Unset = UNSET,
    created_to: datetime.datetime | Unset = UNSET,
    limit: int | Unset = UNSET,
    cursor: str | Unset = UNSET,
    suspend: ListTriggersSuspend | Unset = UNSET,
    x_ama_project_id: str | Unset = UNSET,

) -> ErrorResponse | TriggerListResponse | None:
    """ List triggers

    Args:
        archived (ListTriggersArchived | Unset): Filter by lifecycle. Defaults to false (live
            resources only). Example: false.
        search (str | Unset):  Example: research.
        created_from (datetime.datetime | Unset):  Example: 2026-05-01T00:00:00.000Z.
        created_to (datetime.datetime | Unset):  Example: 2026-05-31T23:59:59.999Z.
        limit (int | Unset):  Example: 50.
        cursor (str | Unset):  Example:
            eyJjcmVhdGVkQXQiOiIyMDI2LTA1LTIyVDAwOjAwOjAwLjAwMFoiLCJpZCI6ImFnZW50X2FiYzEyMyJ9.
        suspend (ListTriggersSuspend | Unset): Filter by the operational toggle. Example: false.
        x_ama_project_id (str | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        ErrorResponse | TriggerListResponse
     """


    return sync_detailed(
        client=client,
archived=archived,
search=search,
created_from=created_from,
created_to=created_to,
limit=limit,
cursor=cursor,
suspend=suspend,
x_ama_project_id=x_ama_project_id,

    ).parsed

async def asyncio_detailed(
    *,
    client: AuthenticatedClient,
    archived: ListTriggersArchived | Unset = UNSET,
    search: str | Unset = UNSET,
    created_from: datetime.datetime | Unset = UNSET,
    created_to: datetime.datetime | Unset = UNSET,
    limit: int | Unset = UNSET,
    cursor: str | Unset = UNSET,
    suspend: ListTriggersSuspend | Unset = UNSET,
    x_ama_project_id: str | Unset = UNSET,

) -> Response[ErrorResponse | TriggerListResponse]:
    """ List triggers

    Args:
        archived (ListTriggersArchived | Unset): Filter by lifecycle. Defaults to false (live
            resources only). Example: false.
        search (str | Unset):  Example: research.
        created_from (datetime.datetime | Unset):  Example: 2026-05-01T00:00:00.000Z.
        created_to (datetime.datetime | Unset):  Example: 2026-05-31T23:59:59.999Z.
        limit (int | Unset):  Example: 50.
        cursor (str | Unset):  Example:
            eyJjcmVhdGVkQXQiOiIyMDI2LTA1LTIyVDAwOjAwOjAwLjAwMFoiLCJpZCI6ImFnZW50X2FiYzEyMyJ9.
        suspend (ListTriggersSuspend | Unset): Filter by the operational toggle. Example: false.
        x_ama_project_id (str | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[ErrorResponse | TriggerListResponse]
     """


    kwargs = _get_kwargs(
        archived=archived,
search=search,
created_from=created_from,
created_to=created_to,
limit=limit,
cursor=cursor,
suspend=suspend,
x_ama_project_id=x_ama_project_id,

    )

    response = await client.get_async_httpx_client().request(
        **kwargs
    )

    return _build_response(client=client, response=response)

async def asyncio(
    *,
    client: AuthenticatedClient,
    archived: ListTriggersArchived | Unset = UNSET,
    search: str | Unset = UNSET,
    created_from: datetime.datetime | Unset = UNSET,
    created_to: datetime.datetime | Unset = UNSET,
    limit: int | Unset = UNSET,
    cursor: str | Unset = UNSET,
    suspend: ListTriggersSuspend | Unset = UNSET,
    x_ama_project_id: str | Unset = UNSET,

) -> ErrorResponse | TriggerListResponse | None:
    """ List triggers

    Args:
        archived (ListTriggersArchived | Unset): Filter by lifecycle. Defaults to false (live
            resources only). Example: false.
        search (str | Unset):  Example: research.
        created_from (datetime.datetime | Unset):  Example: 2026-05-01T00:00:00.000Z.
        created_to (datetime.datetime | Unset):  Example: 2026-05-31T23:59:59.999Z.
        limit (int | Unset):  Example: 50.
        cursor (str | Unset):  Example:
            eyJjcmVhdGVkQXQiOiIyMDI2LTA1LTIyVDAwOjAwOjAwLjAwMFoiLCJpZCI6ImFnZW50X2FiYzEyMyJ9.
        suspend (ListTriggersSuspend | Unset): Filter by the operational toggle. Example: false.
        x_ama_project_id (str | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        ErrorResponse | TriggerListResponse
     """


    return (await asyncio_detailed(
        client=client,
archived=archived,
search=search,
created_from=created_from,
created_to=created_to,
limit=limit,
cursor=cursor,
suspend=suspend,
x_ama_project_id=x_ama_project_id,

    )).parsed
