from http import HTTPStatus
from typing import Any, cast
from urllib.parse import quote

import httpx

from ...client import AuthenticatedClient, Client
from ...types import Response, UNSET
from ... import errors

from ...models.create_vault_credential_request import CreateVaultCredentialRequest
from ...models.error_response import ErrorResponse
from ...models.vault_credential import VaultCredential
from typing import cast



def _get_kwargs(
    vault_id: str,
    *,
    body: CreateVaultCredentialRequest,

) -> dict[str, Any]:
    headers: dict[str, Any] = {}






    _kwargs: dict[str, Any] = {
        "method": "post",
        "url": "/api/v1/vaults/{vault_id}/credentials".format(vault_id=quote(str(vault_id), safe=""),),
    }

    _kwargs["json"] = body.to_dict()

    headers["Content-Type"] = "application/json"

    _kwargs["headers"] = headers
    return _kwargs



def _parse_response(*, client: AuthenticatedClient | Client, response: httpx.Response) -> ErrorResponse | VaultCredential | None:
    if response.status_code == 201:
        response_201 = VaultCredential.from_dict(response.json())



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


def _build_response(*, client: AuthenticatedClient | Client, response: httpx.Response) -> Response[ErrorResponse | VaultCredential]:
    return Response(
        status_code=HTTPStatus(response.status_code),
        content=response.content,
        headers=response.headers,
        parsed=_parse_response(client=client, response=response),
    )


def sync_detailed(
    vault_id: str,
    *,
    client: AuthenticatedClient,
    body: CreateVaultCredentialRequest,

) -> Response[ErrorResponse | VaultCredential]:
    """ Create vault credential metadata

    Args:
        vault_id (str):  Example: 0195f5d6-7c20-7000-8000-000000000007.
        body (CreateVaultCredentialRequest):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[ErrorResponse | VaultCredential]
     """


    kwargs = _get_kwargs(
        vault_id=vault_id,
body=body,

    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)

def sync(
    vault_id: str,
    *,
    client: AuthenticatedClient,
    body: CreateVaultCredentialRequest,

) -> ErrorResponse | VaultCredential | None:
    """ Create vault credential metadata

    Args:
        vault_id (str):  Example: 0195f5d6-7c20-7000-8000-000000000007.
        body (CreateVaultCredentialRequest):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        ErrorResponse | VaultCredential
     """


    return sync_detailed(
        vault_id=vault_id,
client=client,
body=body,

    ).parsed

async def asyncio_detailed(
    vault_id: str,
    *,
    client: AuthenticatedClient,
    body: CreateVaultCredentialRequest,

) -> Response[ErrorResponse | VaultCredential]:
    """ Create vault credential metadata

    Args:
        vault_id (str):  Example: 0195f5d6-7c20-7000-8000-000000000007.
        body (CreateVaultCredentialRequest):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[ErrorResponse | VaultCredential]
     """


    kwargs = _get_kwargs(
        vault_id=vault_id,
body=body,

    )

    response = await client.get_async_httpx_client().request(
        **kwargs
    )

    return _build_response(client=client, response=response)

async def asyncio(
    vault_id: str,
    *,
    client: AuthenticatedClient,
    body: CreateVaultCredentialRequest,

) -> ErrorResponse | VaultCredential | None:
    """ Create vault credential metadata

    Args:
        vault_id (str):  Example: 0195f5d6-7c20-7000-8000-000000000007.
        body (CreateVaultCredentialRequest):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        ErrorResponse | VaultCredential
     """


    return (await asyncio_detailed(
        vault_id=vault_id,
client=client,
body=body,

    )).parsed
