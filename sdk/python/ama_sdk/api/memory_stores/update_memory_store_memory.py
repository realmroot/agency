from http import HTTPStatus
from typing import Any, cast
from urllib.parse import quote

import httpx

from ...client import AuthenticatedClient, Client
from ...types import Response, UNSET
from ... import errors

from ...models.error_response import ErrorResponse
from ...models.memory_store_memory import MemoryStoreMemory
from ...models.update_memory_store_memory_request import UpdateMemoryStoreMemoryRequest
from typing import cast



def _get_kwargs(
    store_id: str,
    memory_id: str,
    *,
    body: UpdateMemoryStoreMemoryRequest,

) -> dict[str, Any]:
    headers: dict[str, Any] = {}






    _kwargs: dict[str, Any] = {
        "method": "patch",
        "url": "/api/v1/memory-stores/{store_id}/memories/{memory_id}".format(store_id=quote(str(store_id), safe=""),memory_id=quote(str(memory_id), safe=""),),
    }

    _kwargs["json"] = body.to_dict()

    headers["Content-Type"] = "application/json"

    _kwargs["headers"] = headers
    return _kwargs



def _parse_response(*, client: AuthenticatedClient | Client, response: httpx.Response) -> ErrorResponse | MemoryStoreMemory | None:
    if response.status_code == 200:
        response_200 = MemoryStoreMemory.from_dict(response.json())



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


def _build_response(*, client: AuthenticatedClient | Client, response: httpx.Response) -> Response[ErrorResponse | MemoryStoreMemory]:
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
    body: UpdateMemoryStoreMemoryRequest,

) -> Response[ErrorResponse | MemoryStoreMemory]:
    """ Update a memory

    Args:
        store_id (str):  Example: 0195f5d6-7c20-7000-8000-00000000000a.
        memory_id (str):  Example: 0195f5d6-7c20-7000-8000-00000000000b.
        body (UpdateMemoryStoreMemoryRequest):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[ErrorResponse | MemoryStoreMemory]
     """


    kwargs = _get_kwargs(
        store_id=store_id,
memory_id=memory_id,
body=body,

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
    body: UpdateMemoryStoreMemoryRequest,

) -> ErrorResponse | MemoryStoreMemory | None:
    """ Update a memory

    Args:
        store_id (str):  Example: 0195f5d6-7c20-7000-8000-00000000000a.
        memory_id (str):  Example: 0195f5d6-7c20-7000-8000-00000000000b.
        body (UpdateMemoryStoreMemoryRequest):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        ErrorResponse | MemoryStoreMemory
     """


    return sync_detailed(
        store_id=store_id,
memory_id=memory_id,
client=client,
body=body,

    ).parsed

async def asyncio_detailed(
    store_id: str,
    memory_id: str,
    *,
    client: AuthenticatedClient,
    body: UpdateMemoryStoreMemoryRequest,

) -> Response[ErrorResponse | MemoryStoreMemory]:
    """ Update a memory

    Args:
        store_id (str):  Example: 0195f5d6-7c20-7000-8000-00000000000a.
        memory_id (str):  Example: 0195f5d6-7c20-7000-8000-00000000000b.
        body (UpdateMemoryStoreMemoryRequest):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[ErrorResponse | MemoryStoreMemory]
     """


    kwargs = _get_kwargs(
        store_id=store_id,
memory_id=memory_id,
body=body,

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
    body: UpdateMemoryStoreMemoryRequest,

) -> ErrorResponse | MemoryStoreMemory | None:
    """ Update a memory

    Args:
        store_id (str):  Example: 0195f5d6-7c20-7000-8000-00000000000a.
        memory_id (str):  Example: 0195f5d6-7c20-7000-8000-00000000000b.
        body (UpdateMemoryStoreMemoryRequest):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        ErrorResponse | MemoryStoreMemory
     """


    return (await asyncio_detailed(
        store_id=store_id,
memory_id=memory_id,
client=client,
body=body,

    )).parsed
