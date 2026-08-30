from http import HTTPStatus
from typing import Any, cast
from urllib.parse import quote

import httpx

from ...client import AuthenticatedClient, Client
from ...types import Response, UNSET
from ... import errors

from ...models.error_response import ErrorResponse
from ...models.list_work_items_state import ListWorkItemsState
from ...models.work_item_list_response import WorkItemListResponse
from ...types import UNSET, Unset
from typing import cast
import datetime



def _get_kwargs(
    *,
    state: ListWorkItemsState | Unset = UNSET,
    session_id: str | Unset = UNSET,
    runner_id: str | Unset = UNSET,
    search: str | Unset = UNSET,
    created_from: datetime.datetime | Unset = UNSET,
    created_to: datetime.datetime | Unset = UNSET,
    limit: int | Unset = UNSET,
    cursor: str | Unset = UNSET,

) -> dict[str, Any]:




    params: dict[str, Any] = {}

    json_state: str | Unset = UNSET
    if not isinstance(state, Unset):
        json_state = state.value

    params["state"] = json_state

    params["sessionId"] = session_id

    params["runnerId"] = runner_id

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


    params = {k: v for k, v in params.items() if v is not UNSET and v is not None}


    _kwargs: dict[str, Any] = {
        "method": "get",
        "url": "/api/v1/work-items",
        "params": params,
    }


    return _kwargs



def _parse_response(*, client: AuthenticatedClient | Client, response: httpx.Response) -> ErrorResponse | WorkItemListResponse | None:
    if response.status_code == 200:
        response_200 = WorkItemListResponse.from_dict(response.json())



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


def _build_response(*, client: AuthenticatedClient | Client, response: httpx.Response) -> Response[ErrorResponse | WorkItemListResponse]:
    return Response(
        status_code=HTTPStatus(response.status_code),
        content=response.content,
        headers=response.headers,
        parsed=_parse_response(client=client, response=response),
    )


def sync_detailed(
    *,
    client: AuthenticatedClient,
    state: ListWorkItemsState | Unset = UNSET,
    session_id: str | Unset = UNSET,
    runner_id: str | Unset = UNSET,
    search: str | Unset = UNSET,
    created_from: datetime.datetime | Unset = UNSET,
    created_to: datetime.datetime | Unset = UNSET,
    limit: int | Unset = UNSET,
    cursor: str | Unset = UNSET,

) -> Response[ErrorResponse | WorkItemListResponse]:
    """ List queued self-hosted work items

    Args:
        state (ListWorkItemsState | Unset):  Example: available.
        session_id (str | Unset):  Example: 0195f5d6-7c20-7000-8000-00000000000e.
        runner_id (str | Unset):  Example: 0195f5d6-7c20-7000-8000-000000000011.
        search (str | Unset):  Example: session.start.
        created_from (datetime.datetime | Unset):  Example: 2026-05-01T00:00:00.000Z.
        created_to (datetime.datetime | Unset):  Example: 2026-05-31T23:59:59.999Z.
        limit (int | Unset):  Example: 50.
        cursor (str | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[ErrorResponse | WorkItemListResponse]
     """


    kwargs = _get_kwargs(
        state=state,
session_id=session_id,
runner_id=runner_id,
search=search,
created_from=created_from,
created_to=created_to,
limit=limit,
cursor=cursor,

    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)

def sync(
    *,
    client: AuthenticatedClient,
    state: ListWorkItemsState | Unset = UNSET,
    session_id: str | Unset = UNSET,
    runner_id: str | Unset = UNSET,
    search: str | Unset = UNSET,
    created_from: datetime.datetime | Unset = UNSET,
    created_to: datetime.datetime | Unset = UNSET,
    limit: int | Unset = UNSET,
    cursor: str | Unset = UNSET,

) -> ErrorResponse | WorkItemListResponse | None:
    """ List queued self-hosted work items

    Args:
        state (ListWorkItemsState | Unset):  Example: available.
        session_id (str | Unset):  Example: 0195f5d6-7c20-7000-8000-00000000000e.
        runner_id (str | Unset):  Example: 0195f5d6-7c20-7000-8000-000000000011.
        search (str | Unset):  Example: session.start.
        created_from (datetime.datetime | Unset):  Example: 2026-05-01T00:00:00.000Z.
        created_to (datetime.datetime | Unset):  Example: 2026-05-31T23:59:59.999Z.
        limit (int | Unset):  Example: 50.
        cursor (str | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        ErrorResponse | WorkItemListResponse
     """


    return sync_detailed(
        client=client,
state=state,
session_id=session_id,
runner_id=runner_id,
search=search,
created_from=created_from,
created_to=created_to,
limit=limit,
cursor=cursor,

    ).parsed

async def asyncio_detailed(
    *,
    client: AuthenticatedClient,
    state: ListWorkItemsState | Unset = UNSET,
    session_id: str | Unset = UNSET,
    runner_id: str | Unset = UNSET,
    search: str | Unset = UNSET,
    created_from: datetime.datetime | Unset = UNSET,
    created_to: datetime.datetime | Unset = UNSET,
    limit: int | Unset = UNSET,
    cursor: str | Unset = UNSET,

) -> Response[ErrorResponse | WorkItemListResponse]:
    """ List queued self-hosted work items

    Args:
        state (ListWorkItemsState | Unset):  Example: available.
        session_id (str | Unset):  Example: 0195f5d6-7c20-7000-8000-00000000000e.
        runner_id (str | Unset):  Example: 0195f5d6-7c20-7000-8000-000000000011.
        search (str | Unset):  Example: session.start.
        created_from (datetime.datetime | Unset):  Example: 2026-05-01T00:00:00.000Z.
        created_to (datetime.datetime | Unset):  Example: 2026-05-31T23:59:59.999Z.
        limit (int | Unset):  Example: 50.
        cursor (str | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[ErrorResponse | WorkItemListResponse]
     """


    kwargs = _get_kwargs(
        state=state,
session_id=session_id,
runner_id=runner_id,
search=search,
created_from=created_from,
created_to=created_to,
limit=limit,
cursor=cursor,

    )

    response = await client.get_async_httpx_client().request(
        **kwargs
    )

    return _build_response(client=client, response=response)

async def asyncio(
    *,
    client: AuthenticatedClient,
    state: ListWorkItemsState | Unset = UNSET,
    session_id: str | Unset = UNSET,
    runner_id: str | Unset = UNSET,
    search: str | Unset = UNSET,
    created_from: datetime.datetime | Unset = UNSET,
    created_to: datetime.datetime | Unset = UNSET,
    limit: int | Unset = UNSET,
    cursor: str | Unset = UNSET,

) -> ErrorResponse | WorkItemListResponse | None:
    """ List queued self-hosted work items

    Args:
        state (ListWorkItemsState | Unset):  Example: available.
        session_id (str | Unset):  Example: 0195f5d6-7c20-7000-8000-00000000000e.
        runner_id (str | Unset):  Example: 0195f5d6-7c20-7000-8000-000000000011.
        search (str | Unset):  Example: session.start.
        created_from (datetime.datetime | Unset):  Example: 2026-05-01T00:00:00.000Z.
        created_to (datetime.datetime | Unset):  Example: 2026-05-31T23:59:59.999Z.
        limit (int | Unset):  Example: 50.
        cursor (str | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        ErrorResponse | WorkItemListResponse
     """


    return (await asyncio_detailed(
        client=client,
state=state,
session_id=session_id,
runner_id=runner_id,
search=search,
created_from=created_from,
created_to=created_to,
limit=limit,
cursor=cursor,

    )).parsed
