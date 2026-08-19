from http import HTTPStatus
from typing import Any, cast
from urllib.parse import quote

import httpx

from ...client import AuthenticatedClient, Client
from ...types import Response, UNSET
from ... import errors

from ...models.error_response import ErrorResponse
from ...models.vault_credential import VaultCredential
from typing import cast



def _get_kwargs(
    vault_id: str,
    credential_id: str,

) -> dict[str, Any]:
    

    

    

    _kwargs: dict[str, Any] = {
        "method": "get",
        "url": "/api/v1/vaults/{vault_id}/credentials/{credential_id}".format(vault_id=quote(str(vault_id), safe=""),credential_id=quote(str(credential_id), safe=""),),
    }


    return _kwargs



def _parse_response(*, client: AuthenticatedClient | Client, response: httpx.Response) -> ErrorResponse | VaultCredential | None:
    if response.status_code == 200:
        response_200 = VaultCredential.from_dict(response.json())



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


def _build_response(*, client: AuthenticatedClient | Client, response: httpx.Response) -> Response[ErrorResponse | VaultCredential]:
    return Response(
        status_code=HTTPStatus(response.status_code),
        content=response.content,
        headers=response.headers,
        parsed=_parse_response(client=client, response=response),
    )


def sync_detailed(
    vault_id: str,
    credential_id: str,
    *,
    client: AuthenticatedClient,

) -> Response[ErrorResponse | VaultCredential]:
    """ Read vault credential metadata

    Args:
        vault_id (str):  Example: vault_abc123.
        credential_id (str):  Example: vaultcred_abc123.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[ErrorResponse | VaultCredential]
     """


    kwargs = _get_kwargs(
        vault_id=vault_id,
credential_id=credential_id,

    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)

def sync(
    vault_id: str,
    credential_id: str,
    *,
    client: AuthenticatedClient,

) -> ErrorResponse | VaultCredential | None:
    """ Read vault credential metadata

    Args:
        vault_id (str):  Example: vault_abc123.
        credential_id (str):  Example: vaultcred_abc123.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        ErrorResponse | VaultCredential
     """


    return sync_detailed(
        vault_id=vault_id,
credential_id=credential_id,
client=client,

    ).parsed

async def asyncio_detailed(
    vault_id: str,
    credential_id: str,
    *,
    client: AuthenticatedClient,

) -> Response[ErrorResponse | VaultCredential]:
    """ Read vault credential metadata

    Args:
        vault_id (str):  Example: vault_abc123.
        credential_id (str):  Example: vaultcred_abc123.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[ErrorResponse | VaultCredential]
     """


    kwargs = _get_kwargs(
        vault_id=vault_id,
credential_id=credential_id,

    )

    response = await client.get_async_httpx_client().request(
        **kwargs
    )

    return _build_response(client=client, response=response)

async def asyncio(
    vault_id: str,
    credential_id: str,
    *,
    client: AuthenticatedClient,

) -> ErrorResponse | VaultCredential | None:
    """ Read vault credential metadata

    Args:
        vault_id (str):  Example: vault_abc123.
        credential_id (str):  Example: vaultcred_abc123.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        ErrorResponse | VaultCredential
     """


    return (await asyncio_detailed(
        vault_id=vault_id,
credential_id=credential_id,
client=client,

    )).parsed
