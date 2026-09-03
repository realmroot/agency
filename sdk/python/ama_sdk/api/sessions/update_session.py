from http import HTTPStatus
from typing import Any, cast
from urllib.parse import quote

import httpx

from ...client import AuthenticatedClient, Client
from ...types import Response, UNSET
from ... import errors

from ...models.error_response import ErrorResponse
from ...models.session import Session
from ...models.update_session_request import UpdateSessionRequest
from ...types import UNSET, Unset
from typing import cast



def _get_kwargs(
    session_id: str,
    *,
    body: UpdateSessionRequest,
    x_ama_project_id: str | Unset = UNSET,

) -> dict[str, Any]:
    headers: dict[str, Any] = {}
    if not isinstance(x_ama_project_id, Unset):
        headers["X-AMA-Project-ID"] = x_ama_project_id







    _kwargs: dict[str, Any] = {
        "method": "patch",
        "url": "/api/v1/sessions/{session_id}".format(session_id=quote(str(session_id), safe=""),),
    }

    _kwargs["json"] = body.to_dict()

    headers["Content-Type"] = "application/json"

    _kwargs["headers"] = headers
    return _kwargs



def _parse_response(*, client: AuthenticatedClient | Client, response: httpx.Response) -> ErrorResponse | Session | None:
    if response.status_code == 200:
        response_200 = Session.from_dict(response.json())



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

    if response.status_code == 409:
        response_409 = ErrorResponse.from_dict(response.json())



        return response_409

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(*, client: AuthenticatedClient | Client, response: httpx.Response) -> Response[ErrorResponse | Session]:
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
    body: UpdateSessionRequest,
    x_ama_project_id: str | Unset = UNSET,

) -> Response[ErrorResponse | Session]:
    r""" Update a session

     Partial update: name and metadata edits, close/reopen transitions (state: \"closed\"|\"idle\"), and
    lifecycle archiving (archived: true|false).

    Args:
        session_id (str):  Example: 0195f5d6-7c20-7000-8000-00000000000e.
        x_ama_project_id (str | Unset):
        body (UpdateSessionRequest):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[ErrorResponse | Session]
     """


    kwargs = _get_kwargs(
        session_id=session_id,
body=body,
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
    body: UpdateSessionRequest,
    x_ama_project_id: str | Unset = UNSET,

) -> ErrorResponse | Session | None:
    r""" Update a session

     Partial update: name and metadata edits, close/reopen transitions (state: \"closed\"|\"idle\"), and
    lifecycle archiving (archived: true|false).

    Args:
        session_id (str):  Example: 0195f5d6-7c20-7000-8000-00000000000e.
        x_ama_project_id (str | Unset):
        body (UpdateSessionRequest):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        ErrorResponse | Session
     """


    return sync_detailed(
        session_id=session_id,
client=client,
body=body,
x_ama_project_id=x_ama_project_id,

    ).parsed

async def asyncio_detailed(
    session_id: str,
    *,
    client: AuthenticatedClient,
    body: UpdateSessionRequest,
    x_ama_project_id: str | Unset = UNSET,

) -> Response[ErrorResponse | Session]:
    r""" Update a session

     Partial update: name and metadata edits, close/reopen transitions (state: \"closed\"|\"idle\"), and
    lifecycle archiving (archived: true|false).

    Args:
        session_id (str):  Example: 0195f5d6-7c20-7000-8000-00000000000e.
        x_ama_project_id (str | Unset):
        body (UpdateSessionRequest):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[ErrorResponse | Session]
     """


    kwargs = _get_kwargs(
        session_id=session_id,
body=body,
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
    body: UpdateSessionRequest,
    x_ama_project_id: str | Unset = UNSET,

) -> ErrorResponse | Session | None:
    r""" Update a session

     Partial update: name and metadata edits, close/reopen transitions (state: \"closed\"|\"idle\"), and
    lifecycle archiving (archived: true|false).

    Args:
        session_id (str):  Example: 0195f5d6-7c20-7000-8000-00000000000e.
        x_ama_project_id (str | Unset):
        body (UpdateSessionRequest):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        ErrorResponse | Session
     """


    return (await asyncio_detailed(
        session_id=session_id,
client=client,
body=body,
x_ama_project_id=x_ama_project_id,

    )).parsed
