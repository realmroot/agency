from http import HTTPStatus
from typing import Any, cast
from urllib.parse import quote

import httpx

from ...client import AuthenticatedClient, Client
from ...types import Response, UNSET
from ... import errors

from ...models.error_response import ErrorResponse
from ...models.list_vault_credential_versions_state import ListVaultCredentialVersionsState
from ...models.vault_credential_version_list_response import VaultCredentialVersionListResponse
from ...types import UNSET, Unset
from typing import cast
import datetime



def _get_kwargs(
    vault_id: str,
    credential_id: str,
    *,
    created_from: datetime.datetime | Unset = UNSET,
    created_to: datetime.datetime | Unset = UNSET,
    limit: int | Unset = UNSET,
    cursor: str | Unset = UNSET,
    state: ListVaultCredentialVersionsState | Unset = UNSET,

) -> dict[str, Any]:
    

    

    params: dict[str, Any] = {}

    json_created_from: str | Unset = UNSET
    if not isinstance(created_from, Unset):
        json_created_from = created_from.isoformat()
    params["createdFrom"] = json_created_from

    json_created_to: str | Unset = UNSET
    if not isinstance(created_to, Unset):
        json_created_to = created_to.isoformat()
    params["createdTo"] = json_created_to

    params["limit"] = limit

    params["cursor"] = cursor

    json_state: str | Unset = UNSET
    if not isinstance(state, Unset):
        json_state = state.value

    params["state"] = json_state


    params = {k: v for k, v in params.items() if v is not UNSET and v is not None}


    _kwargs: dict[str, Any] = {
        "method": "get",
        "url": "/api/v1/vaults/{vault_id}/credentials/{credential_id}/versions".format(vault_id=quote(str(vault_id), safe=""),credential_id=quote(str(credential_id), safe=""),),
        "params": params,
    }


    return _kwargs



def _parse_response(*, client: AuthenticatedClient | Client, response: httpx.Response) -> ErrorResponse | VaultCredentialVersionListResponse | None:
    if response.status_code == 200:
        response_200 = VaultCredentialVersionListResponse.from_dict(response.json())



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

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(*, client: AuthenticatedClient | Client, response: httpx.Response) -> Response[ErrorResponse | VaultCredentialVersionListResponse]:
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
    created_from: datetime.datetime | Unset = UNSET,
    created_to: datetime.datetime | Unset = UNSET,
    limit: int | Unset = UNSET,
    cursor: str | Unset = UNSET,
    state: ListVaultCredentialVersionsState | Unset = UNSET,

) -> Response[ErrorResponse | VaultCredentialVersionListResponse]:
    """ List vault credential versions

    Args:
        vault_id (str):  Example: vault_abc123.
        credential_id (str):  Example: vaultcred_abc123.
        created_from (datetime.datetime | Unset):  Example: 2026-05-01T00:00:00.000Z.
        created_to (datetime.datetime | Unset):  Example: 2026-05-31T23:59:59.999Z.
        limit (int | Unset):  Example: 50.
        cursor (str | Unset):  Example:
            eyJjcmVhdGVkQXQiOiIyMDI2LTA1LTIyVDAwOjAwOjAwLjAwMFoiLCJpZCI6ImFnZW50X2FiYzEyMyJ9.
        state (ListVaultCredentialVersionsState | Unset):  Example: active.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[ErrorResponse | VaultCredentialVersionListResponse]
     """


    kwargs = _get_kwargs(
        vault_id=vault_id,
credential_id=credential_id,
created_from=created_from,
created_to=created_to,
limit=limit,
cursor=cursor,
state=state,

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
    created_from: datetime.datetime | Unset = UNSET,
    created_to: datetime.datetime | Unset = UNSET,
    limit: int | Unset = UNSET,
    cursor: str | Unset = UNSET,
    state: ListVaultCredentialVersionsState | Unset = UNSET,

) -> ErrorResponse | VaultCredentialVersionListResponse | None:
    """ List vault credential versions

    Args:
        vault_id (str):  Example: vault_abc123.
        credential_id (str):  Example: vaultcred_abc123.
        created_from (datetime.datetime | Unset):  Example: 2026-05-01T00:00:00.000Z.
        created_to (datetime.datetime | Unset):  Example: 2026-05-31T23:59:59.999Z.
        limit (int | Unset):  Example: 50.
        cursor (str | Unset):  Example:
            eyJjcmVhdGVkQXQiOiIyMDI2LTA1LTIyVDAwOjAwOjAwLjAwMFoiLCJpZCI6ImFnZW50X2FiYzEyMyJ9.
        state (ListVaultCredentialVersionsState | Unset):  Example: active.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        ErrorResponse | VaultCredentialVersionListResponse
     """


    return sync_detailed(
        vault_id=vault_id,
credential_id=credential_id,
client=client,
created_from=created_from,
created_to=created_to,
limit=limit,
cursor=cursor,
state=state,

    ).parsed

async def asyncio_detailed(
    vault_id: str,
    credential_id: str,
    *,
    client: AuthenticatedClient,
    created_from: datetime.datetime | Unset = UNSET,
    created_to: datetime.datetime | Unset = UNSET,
    limit: int | Unset = UNSET,
    cursor: str | Unset = UNSET,
    state: ListVaultCredentialVersionsState | Unset = UNSET,

) -> Response[ErrorResponse | VaultCredentialVersionListResponse]:
    """ List vault credential versions

    Args:
        vault_id (str):  Example: vault_abc123.
        credential_id (str):  Example: vaultcred_abc123.
        created_from (datetime.datetime | Unset):  Example: 2026-05-01T00:00:00.000Z.
        created_to (datetime.datetime | Unset):  Example: 2026-05-31T23:59:59.999Z.
        limit (int | Unset):  Example: 50.
        cursor (str | Unset):  Example:
            eyJjcmVhdGVkQXQiOiIyMDI2LTA1LTIyVDAwOjAwOjAwLjAwMFoiLCJpZCI6ImFnZW50X2FiYzEyMyJ9.
        state (ListVaultCredentialVersionsState | Unset):  Example: active.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[ErrorResponse | VaultCredentialVersionListResponse]
     """


    kwargs = _get_kwargs(
        vault_id=vault_id,
credential_id=credential_id,
created_from=created_from,
created_to=created_to,
limit=limit,
cursor=cursor,
state=state,

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
    created_from: datetime.datetime | Unset = UNSET,
    created_to: datetime.datetime | Unset = UNSET,
    limit: int | Unset = UNSET,
    cursor: str | Unset = UNSET,
    state: ListVaultCredentialVersionsState | Unset = UNSET,

) -> ErrorResponse | VaultCredentialVersionListResponse | None:
    """ List vault credential versions

    Args:
        vault_id (str):  Example: vault_abc123.
        credential_id (str):  Example: vaultcred_abc123.
        created_from (datetime.datetime | Unset):  Example: 2026-05-01T00:00:00.000Z.
        created_to (datetime.datetime | Unset):  Example: 2026-05-31T23:59:59.999Z.
        limit (int | Unset):  Example: 50.
        cursor (str | Unset):  Example:
            eyJjcmVhdGVkQXQiOiIyMDI2LTA1LTIyVDAwOjAwOjAwLjAwMFoiLCJpZCI6ImFnZW50X2FiYzEyMyJ9.
        state (ListVaultCredentialVersionsState | Unset):  Example: active.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        ErrorResponse | VaultCredentialVersionListResponse
     """


    return (await asyncio_detailed(
        vault_id=vault_id,
credential_id=credential_id,
client=client,
created_from=created_from,
created_to=created_to,
limit=limit,
cursor=cursor,
state=state,

    )).parsed
