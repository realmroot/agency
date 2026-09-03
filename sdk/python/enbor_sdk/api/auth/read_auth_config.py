from http import HTTPStatus
from typing import Any, cast
from urllib.parse import quote

import httpx

from ...client import AuthenticatedClient, Client
from ...types import Response, UNSET
from ... import errors

from ...models.auth_config import AuthConfig
from ...types import UNSET, Unset
from typing import cast



def _get_kwargs(
    *,
    organization: str | Unset = UNSET,

) -> dict[str, Any]:




    params: dict[str, Any] = {}

    params["organization"] = organization


    params = {k: v for k, v in params.items() if v is not UNSET and v is not None}


    _kwargs: dict[str, Any] = {
        "method": "get",
        "url": "/api/v1/auth/config",
        "params": params,
    }


    return _kwargs



def _parse_response(*, client: AuthenticatedClient | Client, response: httpx.Response) -> AuthConfig | None:
    if response.status_code == 200:
        response_200 = AuthConfig.from_dict(response.json())



        return response_200

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(*, client: AuthenticatedClient | Client, response: httpx.Response) -> Response[AuthConfig]:
    return Response(
        status_code=HTTPStatus(response.status_code),
        content=response.content,
        headers=response.headers,
        parsed=_parse_response(client=client, response=response),
    )


def sync_detailed(
    *,
    client: AuthenticatedClient | Client,
    organization: str | Unset = UNSET,

) -> Response[AuthConfig]:
    """ Discover available sign-in methods for an organization

    Args:
        organization (str | Unset):  Example: example-org.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[AuthConfig]
     """


    kwargs = _get_kwargs(
        organization=organization,

    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)

def sync(
    *,
    client: AuthenticatedClient | Client,
    organization: str | Unset = UNSET,

) -> AuthConfig | None:
    """ Discover available sign-in methods for an organization

    Args:
        organization (str | Unset):  Example: example-org.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        AuthConfig
     """


    return sync_detailed(
        client=client,
organization=organization,

    ).parsed

async def asyncio_detailed(
    *,
    client: AuthenticatedClient | Client,
    organization: str | Unset = UNSET,

) -> Response[AuthConfig]:
    """ Discover available sign-in methods for an organization

    Args:
        organization (str | Unset):  Example: example-org.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[AuthConfig]
     """


    kwargs = _get_kwargs(
        organization=organization,

    )

    response = await client.get_async_httpx_client().request(
        **kwargs
    )

    return _build_response(client=client, response=response)

async def asyncio(
    *,
    client: AuthenticatedClient | Client,
    organization: str | Unset = UNSET,

) -> AuthConfig | None:
    """ Discover available sign-in methods for an organization

    Args:
        organization (str | Unset):  Example: example-org.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        AuthConfig
     """


    return (await asyncio_detailed(
        client=client,
organization=organization,

    )).parsed
