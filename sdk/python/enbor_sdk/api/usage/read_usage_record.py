from http import HTTPStatus
from typing import Any, cast
from urllib.parse import quote

import httpx

from ...client import AuthenticatedClient, Client
from ...types import Response, UNSET
from ... import errors

from ...models.error_response import ErrorResponse
from ...models.usage_record import UsageRecord
from ...types import UNSET, Unset
from typing import cast



def _get_kwargs(
    record_id: str,
    *,
    x_ama_project_id: str | Unset = UNSET,

) -> dict[str, Any]:
    headers: dict[str, Any] = {}
    if not isinstance(x_ama_project_id, Unset):
        headers["X-AMA-Project-ID"] = x_ama_project_id







    _kwargs: dict[str, Any] = {
        "method": "get",
        "url": "/api/v1/usage-records/{record_id}".format(record_id=quote(str(record_id), safe=""),),
    }


    _kwargs["headers"] = headers
    return _kwargs



def _parse_response(*, client: AuthenticatedClient | Client, response: httpx.Response) -> ErrorResponse | UsageRecord | None:
    if response.status_code == 200:
        response_200 = UsageRecord.from_dict(response.json())



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


def _build_response(*, client: AuthenticatedClient | Client, response: httpx.Response) -> Response[ErrorResponse | UsageRecord]:
    return Response(
        status_code=HTTPStatus(response.status_code),
        content=response.content,
        headers=response.headers,
        parsed=_parse_response(client=client, response=response),
    )


def sync_detailed(
    record_id: str,
    *,
    client: AuthenticatedClient,
    x_ama_project_id: str | Unset = UNSET,

) -> Response[ErrorResponse | UsageRecord]:
    """ Read a usage record

    Args:
        record_id (str):  Example: 0195f5d6-7c20-7000-8000-000000000016.
        x_ama_project_id (str | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[ErrorResponse | UsageRecord]
     """


    kwargs = _get_kwargs(
        record_id=record_id,
x_ama_project_id=x_ama_project_id,

    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)

def sync(
    record_id: str,
    *,
    client: AuthenticatedClient,
    x_ama_project_id: str | Unset = UNSET,

) -> ErrorResponse | UsageRecord | None:
    """ Read a usage record

    Args:
        record_id (str):  Example: 0195f5d6-7c20-7000-8000-000000000016.
        x_ama_project_id (str | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        ErrorResponse | UsageRecord
     """


    return sync_detailed(
        record_id=record_id,
client=client,
x_ama_project_id=x_ama_project_id,

    ).parsed

async def asyncio_detailed(
    record_id: str,
    *,
    client: AuthenticatedClient,
    x_ama_project_id: str | Unset = UNSET,

) -> Response[ErrorResponse | UsageRecord]:
    """ Read a usage record

    Args:
        record_id (str):  Example: 0195f5d6-7c20-7000-8000-000000000016.
        x_ama_project_id (str | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[ErrorResponse | UsageRecord]
     """


    kwargs = _get_kwargs(
        record_id=record_id,
x_ama_project_id=x_ama_project_id,

    )

    response = await client.get_async_httpx_client().request(
        **kwargs
    )

    return _build_response(client=client, response=response)

async def asyncio(
    record_id: str,
    *,
    client: AuthenticatedClient,
    x_ama_project_id: str | Unset = UNSET,

) -> ErrorResponse | UsageRecord | None:
    """ Read a usage record

    Args:
        record_id (str):  Example: 0195f5d6-7c20-7000-8000-000000000016.
        x_ama_project_id (str | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        ErrorResponse | UsageRecord
     """


    return (await asyncio_detailed(
        record_id=record_id,
client=client,
x_ama_project_id=x_ama_project_id,

    )).parsed
