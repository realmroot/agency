from http import HTTPStatus
from typing import Any, cast
from urllib.parse import quote

import httpx

from ...client import AuthenticatedClient, Client
from ...types import Response, UNSET
from ... import errors

from ...models.connector_list_response import ConnectorListResponse
from ...models.error_response import ErrorResponse
from ...models.list_connectors_availability import ListConnectorsAvailability
from ...types import UNSET, Unset
from typing import cast



def _get_kwargs(
    *,
    search: str | Unset = UNSET,
    category: str | Unset = UNSET,
    trust_level: str | Unset = UNSET,
    capability: str | Unset = UNSET,
    availability: ListConnectorsAvailability | Unset = UNSET,
    limit: int | Unset = UNSET,
    cursor: str | Unset = UNSET,

) -> dict[str, Any]:
    

    

    params: dict[str, Any] = {}

    params["search"] = search

    params["category"] = category

    params["trustLevel"] = trust_level

    params["capability"] = capability

    json_availability: str | Unset = UNSET
    if not isinstance(availability, Unset):
        json_availability = availability.value

    params["availability"] = json_availability

    params["limit"] = limit

    params["cursor"] = cursor


    params = {k: v for k, v in params.items() if v is not UNSET and v is not None}


    _kwargs: dict[str, Any] = {
        "method": "get",
        "url": "/api/v1/connectors",
        "params": params,
    }


    return _kwargs



def _parse_response(*, client: AuthenticatedClient | Client, response: httpx.Response) -> ConnectorListResponse | ErrorResponse | None:
    if response.status_code == 200:
        response_200 = ConnectorListResponse.from_dict(response.json())



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

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(*, client: AuthenticatedClient | Client, response: httpx.Response) -> Response[ConnectorListResponse | ErrorResponse]:
    return Response(
        status_code=HTTPStatus(response.status_code),
        content=response.content,
        headers=response.headers,
        parsed=_parse_response(client=client, response=response),
    )


def sync_detailed(
    *,
    client: AuthenticatedClient,
    search: str | Unset = UNSET,
    category: str | Unset = UNSET,
    trust_level: str | Unset = UNSET,
    capability: str | Unset = UNSET,
    availability: ListConnectorsAvailability | Unset = UNSET,
    limit: int | Unset = UNSET,
    cursor: str | Unset = UNSET,

) -> Response[ConnectorListResponse | ErrorResponse]:
    """ List connectors

    Args:
        search (str | Unset):
        category (str | Unset):
        trust_level (str | Unset):
        capability (str | Unset):
        availability (ListConnectorsAvailability | Unset):
        limit (int | Unset):
        cursor (str | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[ConnectorListResponse | ErrorResponse]
     """


    kwargs = _get_kwargs(
        search=search,
category=category,
trust_level=trust_level,
capability=capability,
availability=availability,
limit=limit,
cursor=cursor,

    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)

def sync(
    *,
    client: AuthenticatedClient,
    search: str | Unset = UNSET,
    category: str | Unset = UNSET,
    trust_level: str | Unset = UNSET,
    capability: str | Unset = UNSET,
    availability: ListConnectorsAvailability | Unset = UNSET,
    limit: int | Unset = UNSET,
    cursor: str | Unset = UNSET,

) -> ConnectorListResponse | ErrorResponse | None:
    """ List connectors

    Args:
        search (str | Unset):
        category (str | Unset):
        trust_level (str | Unset):
        capability (str | Unset):
        availability (ListConnectorsAvailability | Unset):
        limit (int | Unset):
        cursor (str | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        ConnectorListResponse | ErrorResponse
     """


    return sync_detailed(
        client=client,
search=search,
category=category,
trust_level=trust_level,
capability=capability,
availability=availability,
limit=limit,
cursor=cursor,

    ).parsed

async def asyncio_detailed(
    *,
    client: AuthenticatedClient,
    search: str | Unset = UNSET,
    category: str | Unset = UNSET,
    trust_level: str | Unset = UNSET,
    capability: str | Unset = UNSET,
    availability: ListConnectorsAvailability | Unset = UNSET,
    limit: int | Unset = UNSET,
    cursor: str | Unset = UNSET,

) -> Response[ConnectorListResponse | ErrorResponse]:
    """ List connectors

    Args:
        search (str | Unset):
        category (str | Unset):
        trust_level (str | Unset):
        capability (str | Unset):
        availability (ListConnectorsAvailability | Unset):
        limit (int | Unset):
        cursor (str | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[ConnectorListResponse | ErrorResponse]
     """


    kwargs = _get_kwargs(
        search=search,
category=category,
trust_level=trust_level,
capability=capability,
availability=availability,
limit=limit,
cursor=cursor,

    )

    response = await client.get_async_httpx_client().request(
        **kwargs
    )

    return _build_response(client=client, response=response)

async def asyncio(
    *,
    client: AuthenticatedClient,
    search: str | Unset = UNSET,
    category: str | Unset = UNSET,
    trust_level: str | Unset = UNSET,
    capability: str | Unset = UNSET,
    availability: ListConnectorsAvailability | Unset = UNSET,
    limit: int | Unset = UNSET,
    cursor: str | Unset = UNSET,

) -> ConnectorListResponse | ErrorResponse | None:
    """ List connectors

    Args:
        search (str | Unset):
        category (str | Unset):
        trust_level (str | Unset):
        capability (str | Unset):
        availability (ListConnectorsAvailability | Unset):
        limit (int | Unset):
        cursor (str | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        ConnectorListResponse | ErrorResponse
     """


    return (await asyncio_detailed(
        client=client,
search=search,
category=category,
trust_level=trust_level,
capability=capability,
availability=availability,
limit=limit,
cursor=cursor,

    )).parsed
