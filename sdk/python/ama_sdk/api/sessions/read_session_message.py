from http import HTTPStatus
from typing import Any, cast
from urllib.parse import quote

import httpx

from ...client import AuthenticatedClient, Client
from ...types import Response, UNSET
from ... import errors

from ...models.error_response import ErrorResponse
from ...models.session_message import SessionMessage
from typing import cast



def _get_kwargs(
    session_id: str,
    message_id: str,

) -> dict[str, Any]:






    _kwargs: dict[str, Any] = {
        "method": "get",
        "url": "/api/v1/sessions/{session_id}/messages/{message_id}".format(session_id=quote(str(session_id), safe=""),message_id=quote(str(message_id), safe=""),),
    }


    return _kwargs



def _parse_response(*, client: AuthenticatedClient | Client, response: httpx.Response) -> ErrorResponse | SessionMessage | None:
    if response.status_code == 200:
        response_200 = SessionMessage.from_dict(response.json())



        return response_200

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


def _build_response(*, client: AuthenticatedClient | Client, response: httpx.Response) -> Response[ErrorResponse | SessionMessage]:
    return Response(
        status_code=HTTPStatus(response.status_code),
        content=response.content,
        headers=response.headers,
        parsed=_parse_response(client=client, response=response),
    )


def sync_detailed(
    session_id: str,
    message_id: str,
    *,
    client: AuthenticatedClient,

) -> Response[ErrorResponse | SessionMessage]:
    """ Read a session message delivery state

    Args:
        session_id (str):  Example: 0195f5d6-7c20-7000-8000-00000000000e.
        message_id (str):  Example: 0195f5d6-7c20-7000-8000-00000000000f.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[ErrorResponse | SessionMessage]
     """


    kwargs = _get_kwargs(
        session_id=session_id,
message_id=message_id,

    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)

def sync(
    session_id: str,
    message_id: str,
    *,
    client: AuthenticatedClient,

) -> ErrorResponse | SessionMessage | None:
    """ Read a session message delivery state

    Args:
        session_id (str):  Example: 0195f5d6-7c20-7000-8000-00000000000e.
        message_id (str):  Example: 0195f5d6-7c20-7000-8000-00000000000f.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        ErrorResponse | SessionMessage
     """


    return sync_detailed(
        session_id=session_id,
message_id=message_id,
client=client,

    ).parsed

async def asyncio_detailed(
    session_id: str,
    message_id: str,
    *,
    client: AuthenticatedClient,

) -> Response[ErrorResponse | SessionMessage]:
    """ Read a session message delivery state

    Args:
        session_id (str):  Example: 0195f5d6-7c20-7000-8000-00000000000e.
        message_id (str):  Example: 0195f5d6-7c20-7000-8000-00000000000f.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[ErrorResponse | SessionMessage]
     """


    kwargs = _get_kwargs(
        session_id=session_id,
message_id=message_id,

    )

    response = await client.get_async_httpx_client().request(
        **kwargs
    )

    return _build_response(client=client, response=response)

async def asyncio(
    session_id: str,
    message_id: str,
    *,
    client: AuthenticatedClient,

) -> ErrorResponse | SessionMessage | None:
    """ Read a session message delivery state

    Args:
        session_id (str):  Example: 0195f5d6-7c20-7000-8000-00000000000e.
        message_id (str):  Example: 0195f5d6-7c20-7000-8000-00000000000f.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        ErrorResponse | SessionMessage
     """


    return (await asyncio_detailed(
        session_id=session_id,
message_id=message_id,
client=client,

    )).parsed
