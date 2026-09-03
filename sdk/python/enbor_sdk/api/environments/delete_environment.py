from http import HTTPStatus
from typing import Any, cast
from urllib.parse import quote

import httpx

from ...client import AuthenticatedClient, Client
from ...types import Response, UNSET
from ... import errors

from ...models.error_response import ErrorResponse
from ...types import UNSET, Unset
from typing import cast



def _get_kwargs(
    environment_id: str,
    *,
    x_ama_project_id: str | Unset = UNSET,

) -> dict[str, Any]:
    headers: dict[str, Any] = {}
    if not isinstance(x_ama_project_id, Unset):
        headers["X-AMA-Project-ID"] = x_ama_project_id







    _kwargs: dict[str, Any] = {
        "method": "delete",
        "url": "/api/v1/environments/{environment_id}".format(environment_id=quote(str(environment_id), safe=""),),
    }


    _kwargs["headers"] = headers
    return _kwargs



def _parse_response(*, client: AuthenticatedClient | Client, response: httpx.Response) -> Any | ErrorResponse | None:
    if response.status_code == 204:
        response_204 = cast(Any, None)
        return response_204

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


def _build_response(*, client: AuthenticatedClient | Client, response: httpx.Response) -> Response[Any | ErrorResponse]:
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
    x_ama_project_id: str | Unset = UNSET,

) -> Response[Any | ErrorResponse]:
    """ Delete an environment

     Soft-deletes the environment and its associated idle Runners atomically. The retained tombstones
    cannot be restored through the API. Deletion is rejected while an associated Runner has load or an
    active lease.

    Args:
        environment_id (str):  Example: 0195f5d6-7c20-7000-8000-000000000005.
        x_ama_project_id (str | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[Any | ErrorResponse]
     """


    kwargs = _get_kwargs(
        environment_id=environment_id,
x_ama_project_id=x_ama_project_id,

    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)

def sync(
    environment_id: str,
    *,
    client: AuthenticatedClient,
    x_ama_project_id: str | Unset = UNSET,

) -> Any | ErrorResponse | None:
    """ Delete an environment

     Soft-deletes the environment and its associated idle Runners atomically. The retained tombstones
    cannot be restored through the API. Deletion is rejected while an associated Runner has load or an
    active lease.

    Args:
        environment_id (str):  Example: 0195f5d6-7c20-7000-8000-000000000005.
        x_ama_project_id (str | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Any | ErrorResponse
     """


    return sync_detailed(
        environment_id=environment_id,
client=client,
x_ama_project_id=x_ama_project_id,

    ).parsed

async def asyncio_detailed(
    environment_id: str,
    *,
    client: AuthenticatedClient,
    x_ama_project_id: str | Unset = UNSET,

) -> Response[Any | ErrorResponse]:
    """ Delete an environment

     Soft-deletes the environment and its associated idle Runners atomically. The retained tombstones
    cannot be restored through the API. Deletion is rejected while an associated Runner has load or an
    active lease.

    Args:
        environment_id (str):  Example: 0195f5d6-7c20-7000-8000-000000000005.
        x_ama_project_id (str | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[Any | ErrorResponse]
     """


    kwargs = _get_kwargs(
        environment_id=environment_id,
x_ama_project_id=x_ama_project_id,

    )

    response = await client.get_async_httpx_client().request(
        **kwargs
    )

    return _build_response(client=client, response=response)

async def asyncio(
    environment_id: str,
    *,
    client: AuthenticatedClient,
    x_ama_project_id: str | Unset = UNSET,

) -> Any | ErrorResponse | None:
    """ Delete an environment

     Soft-deletes the environment and its associated idle Runners atomically. The retained tombstones
    cannot be restored through the API. Deletion is rejected while an associated Runner has load or an
    active lease.

    Args:
        environment_id (str):  Example: 0195f5d6-7c20-7000-8000-000000000005.
        x_ama_project_id (str | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Any | ErrorResponse
     """


    return (await asyncio_detailed(
        environment_id=environment_id,
client=client,
x_ama_project_id=x_ama_project_id,

    )).parsed
