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
    store_id: str,
    memory_id: str,
    *,
    x_ama_project_id: str | Unset = UNSET,

) -> dict[str, Any]:
    headers: dict[str, Any] = {}
    if not isinstance(x_ama_project_id, Unset):
        headers["X-AMA-Project-ID"] = x_ama_project_id







    _kwargs: dict[str, Any] = {
        "method": "delete",
        "url": "/api/v1/memory-stores/{store_id}/memories/{memory_id}".format(store_id=quote(str(store_id), safe=""),memory_id=quote(str(memory_id), safe=""),),
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
    store_id: str,
    memory_id: str,
    *,
    client: AuthenticatedClient,
    x_ama_project_id: str | Unset = UNSET,

) -> Response[Any | ErrorResponse]:
    """ Delete a memory

     Soft-deletes the memory. The retained tombstone cannot be restored through the API.

    Args:
        store_id (str):  Example: 0195f5d6-7c20-7000-8000-00000000000a.
        memory_id (str):  Example: 0195f5d6-7c20-7000-8000-00000000000b.
        x_ama_project_id (str | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[Any | ErrorResponse]
     """


    kwargs = _get_kwargs(
        store_id=store_id,
memory_id=memory_id,
x_ama_project_id=x_ama_project_id,

    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)

def sync(
    store_id: str,
    memory_id: str,
    *,
    client: AuthenticatedClient,
    x_ama_project_id: str | Unset = UNSET,

) -> Any | ErrorResponse | None:
    """ Delete a memory

     Soft-deletes the memory. The retained tombstone cannot be restored through the API.

    Args:
        store_id (str):  Example: 0195f5d6-7c20-7000-8000-00000000000a.
        memory_id (str):  Example: 0195f5d6-7c20-7000-8000-00000000000b.
        x_ama_project_id (str | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Any | ErrorResponse
     """


    return sync_detailed(
        store_id=store_id,
memory_id=memory_id,
client=client,
x_ama_project_id=x_ama_project_id,

    ).parsed

async def asyncio_detailed(
    store_id: str,
    memory_id: str,
    *,
    client: AuthenticatedClient,
    x_ama_project_id: str | Unset = UNSET,

) -> Response[Any | ErrorResponse]:
    """ Delete a memory

     Soft-deletes the memory. The retained tombstone cannot be restored through the API.

    Args:
        store_id (str):  Example: 0195f5d6-7c20-7000-8000-00000000000a.
        memory_id (str):  Example: 0195f5d6-7c20-7000-8000-00000000000b.
        x_ama_project_id (str | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[Any | ErrorResponse]
     """


    kwargs = _get_kwargs(
        store_id=store_id,
memory_id=memory_id,
x_ama_project_id=x_ama_project_id,

    )

    response = await client.get_async_httpx_client().request(
        **kwargs
    )

    return _build_response(client=client, response=response)

async def asyncio(
    store_id: str,
    memory_id: str,
    *,
    client: AuthenticatedClient,
    x_ama_project_id: str | Unset = UNSET,

) -> Any | ErrorResponse | None:
    """ Delete a memory

     Soft-deletes the memory. The retained tombstone cannot be restored through the API.

    Args:
        store_id (str):  Example: 0195f5d6-7c20-7000-8000-00000000000a.
        memory_id (str):  Example: 0195f5d6-7c20-7000-8000-00000000000b.
        x_ama_project_id (str | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Any | ErrorResponse
     """


    return (await asyncio_detailed(
        store_id=store_id,
memory_id=memory_id,
client=client,
x_ama_project_id=x_ama_project_id,

    )).parsed
