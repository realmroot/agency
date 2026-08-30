from http import HTTPStatus
from typing import Any, cast
from urllib.parse import quote

import httpx

from ...client import AuthenticatedClient, Client
from ...types import Response, UNSET
from ... import errors

from ...models.error_response import ErrorResponse
from typing import cast



def _get_kwargs(
    budget_id: str,

) -> dict[str, Any]:






    _kwargs: dict[str, Any] = {
        "method": "delete",
        "url": "/api/v1/budgets/{budget_id}".format(budget_id=quote(str(budget_id), safe=""),),
    }


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
    budget_id: str,
    *,
    client: AuthenticatedClient,

) -> Response[Any | ErrorResponse]:
    """ Delete a budget

    Args:
        budget_id (str):  Example: 0195f5d6-7c20-7000-8000-000000000014.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[Any | ErrorResponse]
     """


    kwargs = _get_kwargs(
        budget_id=budget_id,

    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)

def sync(
    budget_id: str,
    *,
    client: AuthenticatedClient,

) -> Any | ErrorResponse | None:
    """ Delete a budget

    Args:
        budget_id (str):  Example: 0195f5d6-7c20-7000-8000-000000000014.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Any | ErrorResponse
     """


    return sync_detailed(
        budget_id=budget_id,
client=client,

    ).parsed

async def asyncio_detailed(
    budget_id: str,
    *,
    client: AuthenticatedClient,

) -> Response[Any | ErrorResponse]:
    """ Delete a budget

    Args:
        budget_id (str):  Example: 0195f5d6-7c20-7000-8000-000000000014.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[Any | ErrorResponse]
     """


    kwargs = _get_kwargs(
        budget_id=budget_id,

    )

    response = await client.get_async_httpx_client().request(
        **kwargs
    )

    return _build_response(client=client, response=response)

async def asyncio(
    budget_id: str,
    *,
    client: AuthenticatedClient,

) -> Any | ErrorResponse | None:
    """ Delete a budget

    Args:
        budget_id (str):  Example: 0195f5d6-7c20-7000-8000-000000000014.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Any | ErrorResponse
     """


    return (await asyncio_detailed(
        budget_id=budget_id,
client=client,

    )).parsed
