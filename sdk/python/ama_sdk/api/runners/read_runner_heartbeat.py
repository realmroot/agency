from http import HTTPStatus
from typing import Any, cast
from urllib.parse import quote

import httpx

from ...client import AuthenticatedClient, Client
from ...types import Response, UNSET
from ... import errors

from ...models.error_response import ErrorResponse
from ...models.runner_heartbeat import RunnerHeartbeat
from typing import cast



def _get_kwargs(
    runner_id: str,

) -> dict[str, Any]:






    _kwargs: dict[str, Any] = {
        "method": "get",
        "url": "/api/v1/runners/{runner_id}/heartbeat".format(runner_id=quote(str(runner_id), safe=""),),
    }


    return _kwargs



def _parse_response(*, client: AuthenticatedClient | Client, response: httpx.Response) -> ErrorResponse | RunnerHeartbeat | None:
    if response.status_code == 200:
        response_200 = RunnerHeartbeat.from_dict(response.json())



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


def _build_response(*, client: AuthenticatedClient | Client, response: httpx.Response) -> Response[ErrorResponse | RunnerHeartbeat]:
    return Response(
        status_code=HTTPStatus(response.status_code),
        content=response.content,
        headers=response.headers,
        parsed=_parse_response(client=client, response=response),
    )


def sync_detailed(
    runner_id: str,
    *,
    client: AuthenticatedClient,

) -> Response[ErrorResponse | RunnerHeartbeat]:
    """ Read the current runner heartbeat state

    Args:
        runner_id (str):  Example: 0195f5d6-7c20-7000-8000-000000000011.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[ErrorResponse | RunnerHeartbeat]
     """


    kwargs = _get_kwargs(
        runner_id=runner_id,

    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)

def sync(
    runner_id: str,
    *,
    client: AuthenticatedClient,

) -> ErrorResponse | RunnerHeartbeat | None:
    """ Read the current runner heartbeat state

    Args:
        runner_id (str):  Example: 0195f5d6-7c20-7000-8000-000000000011.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        ErrorResponse | RunnerHeartbeat
     """


    return sync_detailed(
        runner_id=runner_id,
client=client,

    ).parsed

async def asyncio_detailed(
    runner_id: str,
    *,
    client: AuthenticatedClient,

) -> Response[ErrorResponse | RunnerHeartbeat]:
    """ Read the current runner heartbeat state

    Args:
        runner_id (str):  Example: 0195f5d6-7c20-7000-8000-000000000011.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[ErrorResponse | RunnerHeartbeat]
     """


    kwargs = _get_kwargs(
        runner_id=runner_id,

    )

    response = await client.get_async_httpx_client().request(
        **kwargs
    )

    return _build_response(client=client, response=response)

async def asyncio(
    runner_id: str,
    *,
    client: AuthenticatedClient,

) -> ErrorResponse | RunnerHeartbeat | None:
    """ Read the current runner heartbeat state

    Args:
        runner_id (str):  Example: 0195f5d6-7c20-7000-8000-000000000011.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        ErrorResponse | RunnerHeartbeat
     """


    return (await asyncio_detailed(
        runner_id=runner_id,
client=client,

    )).parsed
