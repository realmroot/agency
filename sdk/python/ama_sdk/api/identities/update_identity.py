from http import HTTPStatus
from typing import Any, cast
from urllib.parse import quote

import httpx

from ...client import AuthenticatedClient, Client
from ...types import Response, UNSET, Unset
from ... import errors

from ...models.error_response import ErrorResponse
from ...models.identity import Identity
from ...models.update_identity_request import UpdateIdentityRequest
from typing import cast



def _get_kwargs(
    identity_id: str,
    *,
    body:    UpdateIdentityRequest  |     UpdateIdentityRequest  | Unset = UNSET,

) -> dict[str, Any]:
    headers: dict[str, Any] = {}






    _kwargs: dict[str, Any] = {
        "method": "patch",
        "url": "/api/v1/identities/{identity_id}".format(identity_id=quote(str(identity_id), safe=""),),
    }

    if isinstance(body, UpdateIdentityRequest):
        _kwargs["json"] = body.to_dict()

        headers["Content-Type"] = "application/merge-patch+json"
    if isinstance(body, UpdateIdentityRequest):
        _kwargs["json"] = body.to_dict()

        headers["Content-Type"] = "application/json"

    _kwargs["headers"] = headers
    return _kwargs



def _parse_response(*, client: AuthenticatedClient | Client, response: httpx.Response) -> ErrorResponse | Identity | None:
    if response.status_code == 200:
        response_200 = Identity.from_dict(response.json())



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

    if response.status_code == 409:
        response_409 = ErrorResponse.from_dict(response.json())



        return response_409

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(*, client: AuthenticatedClient | Client, response: httpx.Response) -> Response[ErrorResponse | Identity]:
    return Response(
        status_code=HTTPStatus(response.status_code),
        content=response.content,
        headers=response.headers,
        parsed=_parse_response(client=client, response=response),
    )


def sync_detailed(
    identity_id: str,
    *,
    client: AuthenticatedClient,
    body:    UpdateIdentityRequest  |     UpdateIdentityRequest  | Unset = UNSET,

) -> Response[ErrorResponse | Identity]:
    """ Archive an identity

    Args:
        identity_id (str):
        body (UpdateIdentityRequest):
        body (UpdateIdentityRequest):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[ErrorResponse | Identity]
     """


    kwargs = _get_kwargs(
        identity_id=identity_id,
body=body,

    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)

def sync(
    identity_id: str,
    *,
    client: AuthenticatedClient,
    body:    UpdateIdentityRequest  |     UpdateIdentityRequest  | Unset = UNSET,

) -> ErrorResponse | Identity | None:
    """ Archive an identity

    Args:
        identity_id (str):
        body (UpdateIdentityRequest):
        body (UpdateIdentityRequest):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        ErrorResponse | Identity
     """


    return sync_detailed(
        identity_id=identity_id,
client=client,
body=body,

    ).parsed

async def asyncio_detailed(
    identity_id: str,
    *,
    client: AuthenticatedClient,
    body:    UpdateIdentityRequest  |     UpdateIdentityRequest  | Unset = UNSET,

) -> Response[ErrorResponse | Identity]:
    """ Archive an identity

    Args:
        identity_id (str):
        body (UpdateIdentityRequest):
        body (UpdateIdentityRequest):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[ErrorResponse | Identity]
     """


    kwargs = _get_kwargs(
        identity_id=identity_id,
body=body,

    )

    response = await client.get_async_httpx_client().request(
        **kwargs
    )

    return _build_response(client=client, response=response)

async def asyncio(
    identity_id: str,
    *,
    client: AuthenticatedClient,
    body:    UpdateIdentityRequest  |     UpdateIdentityRequest  | Unset = UNSET,

) -> ErrorResponse | Identity | None:
    """ Archive an identity

    Args:
        identity_id (str):
        body (UpdateIdentityRequest):
        body (UpdateIdentityRequest):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        ErrorResponse | Identity
     """


    return (await asyncio_detailed(
        identity_id=identity_id,
client=client,
body=body,

    )).parsed
