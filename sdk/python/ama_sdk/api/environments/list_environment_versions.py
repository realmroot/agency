from http import HTTPStatus
from typing import Any, cast
from urllib.parse import quote

import httpx

from ...client import AuthenticatedClient, Client
from ...types import Response, UNSET
from ... import errors

from ...models.environment_version_list_response import EnvironmentVersionListResponse
from ...models.error_response import ErrorResponse
from typing import cast



def _get_kwargs(
    environment_id: str,

) -> dict[str, Any]:






    _kwargs: dict[str, Any] = {
        "method": "get",
        "url": "/api/v1/environments/{environment_id}/versions".format(environment_id=quote(str(environment_id), safe=""),),
    }


    return _kwargs



def _parse_response(*, client: AuthenticatedClient | Client, response: httpx.Response) -> EnvironmentVersionListResponse | ErrorResponse | None:
    if response.status_code == 200:
        response_200 = EnvironmentVersionListResponse.from_dict(response.json())



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


def _build_response(*, client: AuthenticatedClient | Client, response: httpx.Response) -> Response[EnvironmentVersionListResponse | ErrorResponse]:
    return Response(
        status_code=HTTPStatus(response.status_code),
        content=response.content,
        headers=response.headers,
        parsed=_parse_response(client=client, response=response),
    )


def sync_detailed(
    environment_id: str,
    *,
    client: AuthenticatedClient,

) -> Response[EnvironmentVersionListResponse | ErrorResponse]:
    """ List environment versions

    Args:
        environment_id (str):  Example: 0195f5d6-7c20-7000-8000-000000000005.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[EnvironmentVersionListResponse | ErrorResponse]
     """


    kwargs = _get_kwargs(
        environment_id=environment_id,

    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)

def sync(
    environment_id: str,
    *,
    client: AuthenticatedClient,

) -> EnvironmentVersionListResponse | ErrorResponse | None:
    """ List environment versions

    Args:
        environment_id (str):  Example: 0195f5d6-7c20-7000-8000-000000000005.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        EnvironmentVersionListResponse | ErrorResponse
     """


    return sync_detailed(
        environment_id=environment_id,
client=client,

    ).parsed

async def asyncio_detailed(
    environment_id: str,
    *,
    client: AuthenticatedClient,

) -> Response[EnvironmentVersionListResponse | ErrorResponse]:
    """ List environment versions

    Args:
        environment_id (str):  Example: 0195f5d6-7c20-7000-8000-000000000005.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[EnvironmentVersionListResponse | ErrorResponse]
     """


    kwargs = _get_kwargs(
        environment_id=environment_id,

    )

    response = await client.get_async_httpx_client().request(
        **kwargs
    )

    return _build_response(client=client, response=response)

async def asyncio(
    environment_id: str,
    *,
    client: AuthenticatedClient,

) -> EnvironmentVersionListResponse | ErrorResponse | None:
    """ List environment versions

    Args:
        environment_id (str):  Example: 0195f5d6-7c20-7000-8000-000000000005.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        EnvironmentVersionListResponse | ErrorResponse
     """


    return (await asyncio_detailed(
        environment_id=environment_id,
client=client,

    )).parsed
