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
    agent_id: str,
    *,
    x_ama_realmroot_authorization: str | Unset = UNSET,

) -> dict[str, Any]:
    headers: dict[str, Any] = {}
    if not isinstance(x_ama_realmroot_authorization, Unset):
        headers["X-AMA-Realmroot-Authorization"] = x_ama_realmroot_authorization



    

    

    _kwargs: dict[str, Any] = {
        "method": "delete",
        "url": "/api/v1/agents/{agent_id}".format(agent_id=quote(str(agent_id), safe=""),),
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

    if response.status_code == 502:
        response_502 = ErrorResponse.from_dict(response.json())



        return response_502

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
    agent_id: str,
    *,
    client: AuthenticatedClient,
    x_ama_realmroot_authorization: str | Unset = UNSET,

) -> Response[Any | ErrorResponse]:
    """ Permanently retire an Agent identity and destroy its managed Vault

    Args:
        agent_id (str):  Example: agent_abc123.
        x_ama_realmroot_authorization (str | Unset): Internal BFF boundary: a Realmroot /api
            audience User Bearer for the same subject and Application as the primary AMA token.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[Any | ErrorResponse]
     """


    kwargs = _get_kwargs(
        agent_id=agent_id,
x_ama_realmroot_authorization=x_ama_realmroot_authorization,

    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)

def sync(
    agent_id: str,
    *,
    client: AuthenticatedClient,
    x_ama_realmroot_authorization: str | Unset = UNSET,

) -> Any | ErrorResponse | None:
    """ Permanently retire an Agent identity and destroy its managed Vault

    Args:
        agent_id (str):  Example: agent_abc123.
        x_ama_realmroot_authorization (str | Unset): Internal BFF boundary: a Realmroot /api
            audience User Bearer for the same subject and Application as the primary AMA token.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Any | ErrorResponse
     """


    return sync_detailed(
        agent_id=agent_id,
client=client,
x_ama_realmroot_authorization=x_ama_realmroot_authorization,

    ).parsed

async def asyncio_detailed(
    agent_id: str,
    *,
    client: AuthenticatedClient,
    x_ama_realmroot_authorization: str | Unset = UNSET,

) -> Response[Any | ErrorResponse]:
    """ Permanently retire an Agent identity and destroy its managed Vault

    Args:
        agent_id (str):  Example: agent_abc123.
        x_ama_realmroot_authorization (str | Unset): Internal BFF boundary: a Realmroot /api
            audience User Bearer for the same subject and Application as the primary AMA token.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[Any | ErrorResponse]
     """


    kwargs = _get_kwargs(
        agent_id=agent_id,
x_ama_realmroot_authorization=x_ama_realmroot_authorization,

    )

    response = await client.get_async_httpx_client().request(
        **kwargs
    )

    return _build_response(client=client, response=response)

async def asyncio(
    agent_id: str,
    *,
    client: AuthenticatedClient,
    x_ama_realmroot_authorization: str | Unset = UNSET,

) -> Any | ErrorResponse | None:
    """ Permanently retire an Agent identity and destroy its managed Vault

    Args:
        agent_id (str):  Example: agent_abc123.
        x_ama_realmroot_authorization (str | Unset): Internal BFF boundary: a Realmroot /api
            audience User Bearer for the same subject and Application as the primary AMA token.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Any | ErrorResponse
     """


    return (await asyncio_detailed(
        agent_id=agent_id,
client=client,
x_ama_realmroot_authorization=x_ama_realmroot_authorization,

    )).parsed
