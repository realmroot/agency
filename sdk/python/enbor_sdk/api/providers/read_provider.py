from http import HTTPStatus
from typing import Any, cast
from urllib.parse import quote

import httpx

from ...client import AuthenticatedClient, Client
from ...types import Response, UNSET
from ... import errors

from ...models.error_response import ErrorResponse
from ...models.provider import Provider
from typing import cast



def _get_kwargs(
    provider_id: str,

) -> dict[str, Any]:






    _kwargs: dict[str, Any] = {
        "method": "get",
        "url": "/api/v1/providers/{provider_id}".format(provider_id=quote(str(provider_id), safe=""),),
    }


    return _kwargs



def _parse_response(*, client: AuthenticatedClient | Client, response: httpx.Response) -> ErrorResponse | Provider | None:
    if response.status_code == 200:
        response_200 = Provider.from_dict(response.json())



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


def _build_response(*, client: AuthenticatedClient | Client, response: httpx.Response) -> Response[ErrorResponse | Provider]:
    return Response(
        status_code=HTTPStatus(response.status_code),
        content=response.content,
        headers=response.headers,
        parsed=_parse_response(client=client, response=response),
    )


def sync_detailed(
    provider_id: str,
    *,
    client: AuthenticatedClient,

) -> Response[ErrorResponse | Provider]:
    """ Read a model vendor

    Args:
        provider_id (str):  Example: anthropic.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[ErrorResponse | Provider]
     """


    kwargs = _get_kwargs(
        provider_id=provider_id,

    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)

def sync(
    provider_id: str,
    *,
    client: AuthenticatedClient,

) -> ErrorResponse | Provider | None:
    """ Read a model vendor

    Args:
        provider_id (str):  Example: anthropic.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        ErrorResponse | Provider
     """


    return sync_detailed(
        provider_id=provider_id,
client=client,

    ).parsed

async def asyncio_detailed(
    provider_id: str,
    *,
    client: AuthenticatedClient,

) -> Response[ErrorResponse | Provider]:
    """ Read a model vendor

    Args:
        provider_id (str):  Example: anthropic.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[ErrorResponse | Provider]
     """


    kwargs = _get_kwargs(
        provider_id=provider_id,

    )

    response = await client.get_async_httpx_client().request(
        **kwargs
    )

    return _build_response(client=client, response=response)

async def asyncio(
    provider_id: str,
    *,
    client: AuthenticatedClient,

) -> ErrorResponse | Provider | None:
    """ Read a model vendor

    Args:
        provider_id (str):  Example: anthropic.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        ErrorResponse | Provider
     """


    return (await asyncio_detailed(
        provider_id=provider_id,
client=client,

    )).parsed
