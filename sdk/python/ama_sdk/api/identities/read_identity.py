from http import HTTPStatus
from typing import Any, cast
from urllib.parse import quote

import httpx

from ...client import AuthenticatedClient, Client
from ...types import Response, UNSET
from ... import errors

from ...models.error_response import ErrorResponse
from ...models.identity import Identity
from typing import cast



def _get_kwargs(
    identity_id: str,

) -> dict[str, Any]:






    _kwargs: dict[str, Any] = {
        "method": "get",
        "url": "/api/v1/identities/{identity_id}".format(identity_id=quote(str(identity_id), safe=""),),
    }


    return _kwargs



def _parse_response(*, client: AuthenticatedClient | Client, response: httpx.Response) -> ErrorResponse | Identity | None:
    if response.status_code == 200:
        response_200 = Identity.from_dict(response.json())



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


def _build_response(*, client: AuthenticatedClient | Client, response: httpx.Response) -> Response[ErrorResponse | Identity]:
    return Response(
        status_code=HTTPStatus(response.status_code),
        content=response.content,
        headers=response.headers,
        parsed=_parse_response(client=client, response=response),
    )


def sync_detailed(
    identity_id: str,
    *,
    client: AuthenticatedClient,

) -> Response[ErrorResponse | Identity]:
    """ Read an identity

    Args:
        identity_id (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[ErrorResponse | Identity]
     """


    kwargs = _get_kwargs(
        identity_id=identity_id,

    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)

def sync(
    identity_id: str,
    *,
    client: AuthenticatedClient,

) -> ErrorResponse | Identity | None:
    """ Read an identity

    Args:
        identity_id (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        ErrorResponse | Identity
     """


    return sync_detailed(
        identity_id=identity_id,
client=client,

    ).parsed

async def asyncio_detailed(
    identity_id: str,
    *,
    client: AuthenticatedClient,

) -> Response[ErrorResponse | Identity]:
    """ Read an identity

    Args:
        identity_id (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[ErrorResponse | Identity]
     """


    kwargs = _get_kwargs(
        identity_id=identity_id,

    )

    response = await client.get_async_httpx_client().request(
        **kwargs
    )

    return _build_response(client=client, response=response)

async def asyncio(
    identity_id: str,
    *,
    client: AuthenticatedClient,

) -> ErrorResponse | Identity | None:
    """ Read an identity

    Args:
        identity_id (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        ErrorResponse | Identity
     """


    return (await asyncio_detailed(
        identity_id=identity_id,
client=client,

    )).parsed
