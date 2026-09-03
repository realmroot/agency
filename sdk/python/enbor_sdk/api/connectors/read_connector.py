from http import HTTPStatus
from typing import Any, cast
from urllib.parse import quote

import httpx

from ...client import AuthenticatedClient, Client
from ...types import Response, UNSET
from ... import errors

from ...models.connector import Connector
from ...models.error_response import ErrorResponse
from typing import cast



def _get_kwargs(
    connector_id: str,

) -> dict[str, Any]:






    _kwargs: dict[str, Any] = {
        "method": "get",
        "url": "/api/v1/connectors/{connector_id}".format(connector_id=quote(str(connector_id), safe=""),),
    }


    return _kwargs



def _parse_response(*, client: AuthenticatedClient | Client, response: httpx.Response) -> Connector | ErrorResponse | None:
    if response.status_code == 200:
        response_200 = Connector.from_dict(response.json())



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


def _build_response(*, client: AuthenticatedClient | Client, response: httpx.Response) -> Response[Connector | ErrorResponse]:
    return Response(
        status_code=HTTPStatus(response.status_code),
        content=response.content,
        headers=response.headers,
        parsed=_parse_response(client=client, response=response),
    )


def sync_detailed(
    connector_id: str,
    *,
    client: AuthenticatedClient,

) -> Response[Connector | ErrorResponse]:
    """ Read connector

    Args:
        connector_id (str):  Example: github.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[Connector | ErrorResponse]
     """


    kwargs = _get_kwargs(
        connector_id=connector_id,

    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)

def sync(
    connector_id: str,
    *,
    client: AuthenticatedClient,

) -> Connector | ErrorResponse | None:
    """ Read connector

    Args:
        connector_id (str):  Example: github.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Connector | ErrorResponse
     """


    return sync_detailed(
        connector_id=connector_id,
client=client,

    ).parsed

async def asyncio_detailed(
    connector_id: str,
    *,
    client: AuthenticatedClient,

) -> Response[Connector | ErrorResponse]:
    """ Read connector

    Args:
        connector_id (str):  Example: github.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[Connector | ErrorResponse]
     """


    kwargs = _get_kwargs(
        connector_id=connector_id,

    )

    response = await client.get_async_httpx_client().request(
        **kwargs
    )

    return _build_response(client=client, response=response)

async def asyncio(
    connector_id: str,
    *,
    client: AuthenticatedClient,

) -> Connector | ErrorResponse | None:
    """ Read connector

    Args:
        connector_id (str):  Example: github.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Connector | ErrorResponse
     """


    return (await asyncio_detailed(
        connector_id=connector_id,
client=client,

    )).parsed
