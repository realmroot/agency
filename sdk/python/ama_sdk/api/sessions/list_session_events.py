from http import HTTPStatus
from typing import Any, cast
from urllib.parse import quote

import httpx

from ...client import AuthenticatedClient, Client
from ...types import Response, UNSET
from ... import errors

from ...models.error_response import ErrorResponse
from ...models.list_session_events_order import ListSessionEventsOrder
from ...models.list_session_events_type import ListSessionEventsType
from ...models.session_event_list_response import SessionEventListResponse
from ...types import UNSET, Unset
from typing import cast
import datetime



def _get_kwargs(
    session_id: str,
    *,
    cursor: int | None | Unset = UNSET,
    order: ListSessionEventsOrder | Unset = UNSET,
    limit: int | Unset = UNSET,
    type_: ListSessionEventsType | Unset = UNSET,
    created_from: datetime.datetime | Unset = UNSET,
    created_to: datetime.datetime | Unset = UNSET,
    x_ama_project_id: str | Unset = UNSET,

) -> dict[str, Any]:
    headers: dict[str, Any] = {}
    if not isinstance(x_ama_project_id, Unset):
        headers["X-AMA-Project-ID"] = x_ama_project_id





    params: dict[str, Any] = {}

    json_cursor: int | None | Unset
    if isinstance(cursor, Unset):
        json_cursor = UNSET
    else:
        json_cursor = cursor
    params["cursor"] = json_cursor

    json_order: str | Unset = UNSET
    if not isinstance(order, Unset):
        json_order = order.value

    params["order"] = json_order

    params["limit"] = limit

    json_type_: str | Unset = UNSET
    if not isinstance(type_, Unset):
        json_type_ = type_.value

    params["type"] = json_type_

    json_created_from: str | Unset = UNSET
    if not isinstance(created_from, Unset):
        json_created_from = created_from.isoformat()
    params["createdFrom"] = json_created_from

    json_created_to: str | Unset = UNSET
    if not isinstance(created_to, Unset):
        json_created_to = created_to.isoformat()
    params["createdTo"] = json_created_to


    params = {k: v for k, v in params.items() if v is not UNSET and v is not None}


    _kwargs: dict[str, Any] = {
        "method": "get",
        "url": "/api/v1/sessions/{session_id}/events".format(session_id=quote(str(session_id), safe=""),),
        "params": params,
    }


    _kwargs["headers"] = headers
    return _kwargs



def _parse_response(*, client: AuthenticatedClient | Client, response: httpx.Response) -> ErrorResponse | SessionEventListResponse | None:
    if response.status_code == 200:
        response_200 = SessionEventListResponse.from_dict(response.json())



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


def _build_response(*, client: AuthenticatedClient | Client, response: httpx.Response) -> Response[ErrorResponse | SessionEventListResponse]:
    return Response(
        status_code=HTTPStatus(response.status_code),
        content=response.content,
        headers=response.headers,
        parsed=_parse_response(client=client, response=response),
    )


def sync_detailed(
    session_id: str,
    *,
    client: AuthenticatedClient,
    cursor: int | None | Unset = UNSET,
    order: ListSessionEventsOrder | Unset = UNSET,
    limit: int | Unset = UNSET,
    type_: ListSessionEventsType | Unset = UNSET,
    created_from: datetime.datetime | Unset = UNSET,
    created_to: datetime.datetime | Unset = UNSET,
    x_ama_project_id: str | Unset = UNSET,

) -> Response[ErrorResponse | SessionEventListResponse]:
    """ List session events

     Content negotiation: application/json returns a paginated list, text/csv exports the filtered
    events, text/event-stream streams new events as SSE.

    Args:
        session_id (str):  Example: 0195f5d6-7c20-7000-8000-00000000000e.
        cursor (int | None | Unset):  Example: 42.
        order (ListSessionEventsOrder | Unset):  Example: asc.
        limit (int | Unset):  Example: 100.
        type_ (ListSessionEventsType | Unset):  Example: message.completed.
        created_from (datetime.datetime | Unset):  Example: 2026-05-01T00:00:00.000Z.
        created_to (datetime.datetime | Unset):  Example: 2026-05-31T23:59:59.999Z.
        x_ama_project_id (str | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[ErrorResponse | SessionEventListResponse]
     """


    kwargs = _get_kwargs(
        session_id=session_id,
cursor=cursor,
order=order,
limit=limit,
type_=type_,
created_from=created_from,
created_to=created_to,
x_ama_project_id=x_ama_project_id,

    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)

def sync(
    session_id: str,
    *,
    client: AuthenticatedClient,
    cursor: int | None | Unset = UNSET,
    order: ListSessionEventsOrder | Unset = UNSET,
    limit: int | Unset = UNSET,
    type_: ListSessionEventsType | Unset = UNSET,
    created_from: datetime.datetime | Unset = UNSET,
    created_to: datetime.datetime | Unset = UNSET,
    x_ama_project_id: str | Unset = UNSET,

) -> ErrorResponse | SessionEventListResponse | None:
    """ List session events

     Content negotiation: application/json returns a paginated list, text/csv exports the filtered
    events, text/event-stream streams new events as SSE.

    Args:
        session_id (str):  Example: 0195f5d6-7c20-7000-8000-00000000000e.
        cursor (int | None | Unset):  Example: 42.
        order (ListSessionEventsOrder | Unset):  Example: asc.
        limit (int | Unset):  Example: 100.
        type_ (ListSessionEventsType | Unset):  Example: message.completed.
        created_from (datetime.datetime | Unset):  Example: 2026-05-01T00:00:00.000Z.
        created_to (datetime.datetime | Unset):  Example: 2026-05-31T23:59:59.999Z.
        x_ama_project_id (str | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        ErrorResponse | SessionEventListResponse
     """


    return sync_detailed(
        session_id=session_id,
client=client,
cursor=cursor,
order=order,
limit=limit,
type_=type_,
created_from=created_from,
created_to=created_to,
x_ama_project_id=x_ama_project_id,

    ).parsed

async def asyncio_detailed(
    session_id: str,
    *,
    client: AuthenticatedClient,
    cursor: int | None | Unset = UNSET,
    order: ListSessionEventsOrder | Unset = UNSET,
    limit: int | Unset = UNSET,
    type_: ListSessionEventsType | Unset = UNSET,
    created_from: datetime.datetime | Unset = UNSET,
    created_to: datetime.datetime | Unset = UNSET,
    x_ama_project_id: str | Unset = UNSET,

) -> Response[ErrorResponse | SessionEventListResponse]:
    """ List session events

     Content negotiation: application/json returns a paginated list, text/csv exports the filtered
    events, text/event-stream streams new events as SSE.

    Args:
        session_id (str):  Example: 0195f5d6-7c20-7000-8000-00000000000e.
        cursor (int | None | Unset):  Example: 42.
        order (ListSessionEventsOrder | Unset):  Example: asc.
        limit (int | Unset):  Example: 100.
        type_ (ListSessionEventsType | Unset):  Example: message.completed.
        created_from (datetime.datetime | Unset):  Example: 2026-05-01T00:00:00.000Z.
        created_to (datetime.datetime | Unset):  Example: 2026-05-31T23:59:59.999Z.
        x_ama_project_id (str | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[ErrorResponse | SessionEventListResponse]
     """


    kwargs = _get_kwargs(
        session_id=session_id,
cursor=cursor,
order=order,
limit=limit,
type_=type_,
created_from=created_from,
created_to=created_to,
x_ama_project_id=x_ama_project_id,

    )

    response = await client.get_async_httpx_client().request(
        **kwargs
    )

    return _build_response(client=client, response=response)

async def asyncio(
    session_id: str,
    *,
    client: AuthenticatedClient,
    cursor: int | None | Unset = UNSET,
    order: ListSessionEventsOrder | Unset = UNSET,
    limit: int | Unset = UNSET,
    type_: ListSessionEventsType | Unset = UNSET,
    created_from: datetime.datetime | Unset = UNSET,
    created_to: datetime.datetime | Unset = UNSET,
    x_ama_project_id: str | Unset = UNSET,

) -> ErrorResponse | SessionEventListResponse | None:
    """ List session events

     Content negotiation: application/json returns a paginated list, text/csv exports the filtered
    events, text/event-stream streams new events as SSE.

    Args:
        session_id (str):  Example: 0195f5d6-7c20-7000-8000-00000000000e.
        cursor (int | None | Unset):  Example: 42.
        order (ListSessionEventsOrder | Unset):  Example: asc.
        limit (int | Unset):  Example: 100.
        type_ (ListSessionEventsType | Unset):  Example: message.completed.
        created_from (datetime.datetime | Unset):  Example: 2026-05-01T00:00:00.000Z.
        created_to (datetime.datetime | Unset):  Example: 2026-05-31T23:59:59.999Z.
        x_ama_project_id (str | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        ErrorResponse | SessionEventListResponse
     """


    return (await asyncio_detailed(
        session_id=session_id,
client=client,
cursor=cursor,
order=order,
limit=limit,
type_=type_,
created_from=created_from,
created_to=created_to,
x_ama_project_id=x_ama_project_id,

    )).parsed
