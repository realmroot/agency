from http import HTTPStatus
from typing import Any, cast
from urllib.parse import quote

import httpx

from ...client import AuthenticatedClient, Client
from ...types import Response, UNSET
from ... import errors

from ...models.create_session_events_request import CreateSessionEventsRequest
from ...models.error_response import ErrorResponse
from ...models.session_events_accepted import SessionEventsAccepted
from typing import cast



def _get_kwargs(
    session_id: str,
    *,
    body: CreateSessionEventsRequest,

) -> dict[str, Any]:
    headers: dict[str, Any] = {}






    _kwargs: dict[str, Any] = {
        "method": "post",
        "url": "/api/v1/sessions/{session_id}/events".format(session_id=quote(str(session_id), safe=""),),
    }

    _kwargs["json"] = body.to_dict()

    headers["Content-Type"] = "application/json"

    _kwargs["headers"] = headers
    return _kwargs



def _parse_response(*, client: AuthenticatedClient | Client, response: httpx.Response) -> ErrorResponse | SessionEventsAccepted | None:
    if response.status_code == 201:
        response_201 = SessionEventsAccepted.from_dict(response.json())



        return response_201

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


def _build_response(*, client: AuthenticatedClient | Client, response: httpx.Response) -> Response[ErrorResponse | SessionEventsAccepted]:
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
    body: CreateSessionEventsRequest,

) -> Response[ErrorResponse | SessionEventsAccepted]:
    """ Batch-create session events

     Event ingest for runners and clients. Runner OIDC tokens are accepted only while the runner holds an
    active lease attached to the session.

    Args:
        session_id (str):  Example: 0195f5d6-7c20-7000-8000-00000000000e.
        body (CreateSessionEventsRequest):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[ErrorResponse | SessionEventsAccepted]
     """


    kwargs = _get_kwargs(
        session_id=session_id,
body=body,

    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)

def sync(
    session_id: str,
    *,
    client: AuthenticatedClient,
    body: CreateSessionEventsRequest,

) -> ErrorResponse | SessionEventsAccepted | None:
    """ Batch-create session events

     Event ingest for runners and clients. Runner OIDC tokens are accepted only while the runner holds an
    active lease attached to the session.

    Args:
        session_id (str):  Example: 0195f5d6-7c20-7000-8000-00000000000e.
        body (CreateSessionEventsRequest):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        ErrorResponse | SessionEventsAccepted
     """


    return sync_detailed(
        session_id=session_id,
client=client,
body=body,

    ).parsed

async def asyncio_detailed(
    session_id: str,
    *,
    client: AuthenticatedClient,
    body: CreateSessionEventsRequest,

) -> Response[ErrorResponse | SessionEventsAccepted]:
    """ Batch-create session events

     Event ingest for runners and clients. Runner OIDC tokens are accepted only while the runner holds an
    active lease attached to the session.

    Args:
        session_id (str):  Example: 0195f5d6-7c20-7000-8000-00000000000e.
        body (CreateSessionEventsRequest):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[ErrorResponse | SessionEventsAccepted]
     """


    kwargs = _get_kwargs(
        session_id=session_id,
body=body,

    )

    response = await client.get_async_httpx_client().request(
        **kwargs
    )

    return _build_response(client=client, response=response)

async def asyncio(
    session_id: str,
    *,
    client: AuthenticatedClient,
    body: CreateSessionEventsRequest,

) -> ErrorResponse | SessionEventsAccepted | None:
    """ Batch-create session events

     Event ingest for runners and clients. Runner OIDC tokens are accepted only while the runner holds an
    active lease attached to the session.

    Args:
        session_id (str):  Example: 0195f5d6-7c20-7000-8000-00000000000e.
        body (CreateSessionEventsRequest):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        ErrorResponse | SessionEventsAccepted
     """


    return (await asyncio_detailed(
        session_id=session_id,
client=client,
body=body,

    )).parsed
