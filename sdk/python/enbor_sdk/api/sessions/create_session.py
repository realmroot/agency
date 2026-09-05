from http import HTTPStatus
from typing import Any, cast
from urllib.parse import quote

import httpx

from ...client import AuthenticatedClient, Client
from ...types import Response, UNSET
from ... import errors

from ...models.create_session_request import CreateSessionRequest
from ...models.error_response import ErrorResponse
from ...models.session import Session
from ...types import UNSET, Unset
from typing import cast



def _get_kwargs(
    *,
    body: CreateSessionRequest,
    idempotency_key: str | Unset = UNSET,
    x_enbor_project_id: str | Unset = UNSET,

) -> dict[str, Any]:
    headers: dict[str, Any] = {}
    if not isinstance(idempotency_key, Unset):
        headers["idempotency-key"] = idempotency_key

    if not isinstance(x_enbor_project_id, Unset):
        headers["X-Enbor-Project-ID"] = x_enbor_project_id







    _kwargs: dict[str, Any] = {
        "method": "post",
        "url": "/api/v1/sessions",
    }

    _kwargs["json"] = body.to_dict()

    headers["Content-Type"] = "application/json"

    _kwargs["headers"] = headers
    return _kwargs



def _parse_response(*, client: AuthenticatedClient | Client, response: httpx.Response) -> ErrorResponse | Session | None:
    if response.status_code == 201:
        response_201 = Session.from_dict(response.json())



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
    *,
    client: AuthenticatedClient,
    body: CreateSessionRequest,
    idempotency_key: str | Unset = UNSET,
    x_enbor_project_id: str | Unset = UNSET,

) -> Response[ErrorResponse | Session]:
    """ Create a session

    Args:
        idempotency_key (str | Unset):
        x_enbor_project_id (str | Unset):
        body (CreateSessionRequest):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[ErrorResponse | Session]
     """


    kwargs = _get_kwargs(
        body=body,
idempotency_key=idempotency_key,
x_enbor_project_id=x_enbor_project_id,

    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)

def sync(
    *,
    client: AuthenticatedClient,
    body: CreateSessionRequest,
    idempotency_key: str | Unset = UNSET,
    x_enbor_project_id: str | Unset = UNSET,

) -> ErrorResponse | Session | None:
    """ Create a session

    Args:
        idempotency_key (str | Unset):
        x_enbor_project_id (str | Unset):
        body (CreateSessionRequest):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        ErrorResponse | Session
     """


    return sync_detailed(
        client=client,
body=body,
idempotency_key=idempotency_key,
x_enbor_project_id=x_enbor_project_id,

    ).parsed

async def asyncio_detailed(
    *,
    client: AuthenticatedClient,
    body: CreateSessionRequest,
    idempotency_key: str | Unset = UNSET,
    x_enbor_project_id: str | Unset = UNSET,

) -> Response[ErrorResponse | Session]:
    """ Create a session

    Args:
        idempotency_key (str | Unset):
        x_enbor_project_id (str | Unset):
        body (CreateSessionRequest):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[ErrorResponse | Session]
     """


    kwargs = _get_kwargs(
        body=body,
idempotency_key=idempotency_key,
x_enbor_project_id=x_enbor_project_id,

    )

    response = await client.get_async_httpx_client().request(
        **kwargs
    )

    return _build_response(client=client, response=response)

async def asyncio(
    *,
    client: AuthenticatedClient,
    body: CreateSessionRequest,
    idempotency_key: str | Unset = UNSET,
    x_enbor_project_id: str | Unset = UNSET,

) -> ErrorResponse | Session | None:
    """ Create a session

    Args:
        idempotency_key (str | Unset):
        x_enbor_project_id (str | Unset):
        body (CreateSessionRequest):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        ErrorResponse | Session
     """


    return (await asyncio_detailed(
        client=client,
body=body,
idempotency_key=idempotency_key,
x_enbor_project_id=x_enbor_project_id,

    )).parsed
