from http import HTTPStatus
from typing import Any, cast
from urllib.parse import quote

import httpx

from ...client import AuthenticatedClient, Client
from ...types import Response, UNSET
from ... import errors

from ...models.create_memory_store_memory_request import CreateMemoryStoreMemoryRequest
from ...models.error_response import ErrorResponse
from ...models.memory_store_memory import MemoryStoreMemory
from ...types import UNSET, Unset
from typing import cast



def _get_kwargs(
    store_id: str,
    *,
    body: CreateMemoryStoreMemoryRequest,
    x_enbor_project_id: str | Unset = UNSET,

) -> dict[str, Any]:
    headers: dict[str, Any] = {}
    if not isinstance(x_enbor_project_id, Unset):
        headers["X-Enbor-Project-ID"] = x_enbor_project_id







    _kwargs: dict[str, Any] = {
        "method": "post",
        "url": "/api/v1/memory-stores/{store_id}/memories".format(store_id=quote(str(store_id), safe=""),),
    }

    _kwargs["json"] = body.to_dict()

    headers["Content-Type"] = "application/json"

    _kwargs["headers"] = headers
    return _kwargs



def _parse_response(*, client: AuthenticatedClient | Client, response: httpx.Response) -> ErrorResponse | MemoryStoreMemory | None:
    if response.status_code == 201:
        response_201 = MemoryStoreMemory.from_dict(response.json())



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


def _build_response(*, client: AuthenticatedClient | Client, response: httpx.Response) -> Response[ErrorResponse | MemoryStoreMemory]:
    return Response(
        status_code=HTTPStatus(response.status_code),
        content=response.content,
        headers=response.headers,
        parsed=_parse_response(client=client, response=response),
    )


def sync_detailed(
    store_id: str,
    *,
    client: AuthenticatedClient,
    body: CreateMemoryStoreMemoryRequest,
    x_enbor_project_id: str | Unset = UNSET,

) -> Response[ErrorResponse | MemoryStoreMemory]:
    """ Create a memory in a memory store

    Args:
        store_id (str):  Example: 0195f5d6-7c20-7000-8000-00000000000a.
        x_enbor_project_id (str | Unset):
        body (CreateMemoryStoreMemoryRequest):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[ErrorResponse | MemoryStoreMemory]
     """


    kwargs = _get_kwargs(
        store_id=store_id,
body=body,
x_enbor_project_id=x_enbor_project_id,

    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)

def sync(
    store_id: str,
    *,
    client: AuthenticatedClient,
    body: CreateMemoryStoreMemoryRequest,
    x_enbor_project_id: str | Unset = UNSET,

) -> ErrorResponse | MemoryStoreMemory | None:
    """ Create a memory in a memory store

    Args:
        store_id (str):  Example: 0195f5d6-7c20-7000-8000-00000000000a.
        x_enbor_project_id (str | Unset):
        body (CreateMemoryStoreMemoryRequest):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        ErrorResponse | MemoryStoreMemory
     """


    return sync_detailed(
        store_id=store_id,
client=client,
body=body,
x_enbor_project_id=x_enbor_project_id,

    ).parsed

async def asyncio_detailed(
    store_id: str,
    *,
    client: AuthenticatedClient,
    body: CreateMemoryStoreMemoryRequest,
    x_enbor_project_id: str | Unset = UNSET,

) -> Response[ErrorResponse | MemoryStoreMemory]:
    """ Create a memory in a memory store

    Args:
        store_id (str):  Example: 0195f5d6-7c20-7000-8000-00000000000a.
        x_enbor_project_id (str | Unset):
        body (CreateMemoryStoreMemoryRequest):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[ErrorResponse | MemoryStoreMemory]
     """


    kwargs = _get_kwargs(
        store_id=store_id,
body=body,
x_enbor_project_id=x_enbor_project_id,

    )

    response = await client.get_async_httpx_client().request(
        **kwargs
    )

    return _build_response(client=client, response=response)

async def asyncio(
    store_id: str,
    *,
    client: AuthenticatedClient,
    body: CreateMemoryStoreMemoryRequest,
    x_enbor_project_id: str | Unset = UNSET,

) -> ErrorResponse | MemoryStoreMemory | None:
    """ Create a memory in a memory store

    Args:
        store_id (str):  Example: 0195f5d6-7c20-7000-8000-00000000000a.
        x_enbor_project_id (str | Unset):
        body (CreateMemoryStoreMemoryRequest):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        ErrorResponse | MemoryStoreMemory
     """


    return (await asyncio_detailed(
        store_id=store_id,
client=client,
body=body,
x_enbor_project_id=x_enbor_project_id,

    )).parsed
