from http import HTTPStatus
from typing import Any, cast
from urllib.parse import quote

import httpx

from ...client import AuthenticatedClient, Client
from ...types import Response, UNSET
from ... import errors

from ...models.agent import Agent
from ...models.create_agent_request import CreateAgentRequest
from ...models.error_response import ErrorResponse
from ...types import UNSET, Unset
from typing import cast



def _get_kwargs(
    *,
    body: CreateAgentRequest,
    idempotency_key: str,
    x_ama_realmroot_authorization: str | Unset = UNSET,

) -> dict[str, Any]:
    headers: dict[str, Any] = {}
    headers["Idempotency-Key"] = idempotency_key

    if not isinstance(x_ama_realmroot_authorization, Unset):
        headers["X-AMA-Realmroot-Authorization"] = x_ama_realmroot_authorization



    

    

    _kwargs: dict[str, Any] = {
        "method": "post",
        "url": "/api/v1/agents",
    }

    _kwargs["json"] = body.to_dict()

    headers["Content-Type"] = "application/json"

    _kwargs["headers"] = headers
    return _kwargs



def _parse_response(*, client: AuthenticatedClient | Client, response: httpx.Response) -> Agent | ErrorResponse | None:
    if response.status_code == 201:
        response_201 = Agent.from_dict(response.json())



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

    if response.status_code == 409:
        response_409 = ErrorResponse.from_dict(response.json())



        return response_409

    if response.status_code == 502:
        response_502 = ErrorResponse.from_dict(response.json())



        return response_502

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(*, client: AuthenticatedClient | Client, response: httpx.Response) -> Response[Agent | ErrorResponse]:
    return Response(
        status_code=HTTPStatus(response.status_code),
        content=response.content,
        headers=response.headers,
        parsed=_parse_response(client=client, response=response),
    )


def sync_detailed(
    *,
    client: AuthenticatedClient,
    body: CreateAgentRequest,
    idempotency_key: str,
    x_ama_realmroot_authorization: str | Unset = UNSET,

) -> Response[Agent | ErrorResponse]:
    """ Create an agent

    Args:
        idempotency_key (str):
        x_ama_realmroot_authorization (str | Unset): Internal BFF boundary: a Realmroot /api
            audience User Bearer for the same subject and Application as the primary AMA token.
        body (CreateAgentRequest):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[Agent | ErrorResponse]
     """


    kwargs = _get_kwargs(
        body=body,
idempotency_key=idempotency_key,
x_ama_realmroot_authorization=x_ama_realmroot_authorization,

    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)

def sync(
    *,
    client: AuthenticatedClient,
    body: CreateAgentRequest,
    idempotency_key: str,
    x_ama_realmroot_authorization: str | Unset = UNSET,

) -> Agent | ErrorResponse | None:
    """ Create an agent

    Args:
        idempotency_key (str):
        x_ama_realmroot_authorization (str | Unset): Internal BFF boundary: a Realmroot /api
            audience User Bearer for the same subject and Application as the primary AMA token.
        body (CreateAgentRequest):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Agent | ErrorResponse
     """


    return sync_detailed(
        client=client,
body=body,
idempotency_key=idempotency_key,
x_ama_realmroot_authorization=x_ama_realmroot_authorization,

    ).parsed

async def asyncio_detailed(
    *,
    client: AuthenticatedClient,
    body: CreateAgentRequest,
    idempotency_key: str,
    x_ama_realmroot_authorization: str | Unset = UNSET,

) -> Response[Agent | ErrorResponse]:
    """ Create an agent

    Args:
        idempotency_key (str):
        x_ama_realmroot_authorization (str | Unset): Internal BFF boundary: a Realmroot /api
            audience User Bearer for the same subject and Application as the primary AMA token.
        body (CreateAgentRequest):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[Agent | ErrorResponse]
     """


    kwargs = _get_kwargs(
        body=body,
idempotency_key=idempotency_key,
x_ama_realmroot_authorization=x_ama_realmroot_authorization,

    )

    response = await client.get_async_httpx_client().request(
        **kwargs
    )

    return _build_response(client=client, response=response)

async def asyncio(
    *,
    client: AuthenticatedClient,
    body: CreateAgentRequest,
    idempotency_key: str,
    x_ama_realmroot_authorization: str | Unset = UNSET,

) -> Agent | ErrorResponse | None:
    """ Create an agent

    Args:
        idempotency_key (str):
        x_ama_realmroot_authorization (str | Unset): Internal BFF boundary: a Realmroot /api
            audience User Bearer for the same subject and Application as the primary AMA token.
        body (CreateAgentRequest):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Agent | ErrorResponse
     """


    return (await asyncio_detailed(
        client=client,
body=body,
idempotency_key=idempotency_key,
x_ama_realmroot_authorization=x_ama_realmroot_authorization,

    )).parsed
