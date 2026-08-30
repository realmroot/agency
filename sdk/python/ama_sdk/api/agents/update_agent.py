from http import HTTPStatus
from typing import Any, cast
from urllib.parse import quote

import httpx

from ...client import AuthenticatedClient, Client
from ...types import Response, UNSET
from ... import errors

from ...models.agent import Agent
from ...models.error_response import ErrorResponse
from ...models.update_agent_request import UpdateAgentRequest
from typing import cast



def _get_kwargs(
    agent_id: str,
    *,
    body: UpdateAgentRequest,

) -> dict[str, Any]:
    headers: dict[str, Any] = {}






    _kwargs: dict[str, Any] = {
        "method": "patch",
        "url": "/api/v1/agents/{agent_id}".format(agent_id=quote(str(agent_id), safe=""),),
    }

    _kwargs["json"] = body.to_dict()

    headers["Content-Type"] = "application/json"

    _kwargs["headers"] = headers
    return _kwargs



def _parse_response(*, client: AuthenticatedClient | Client, response: httpx.Response) -> Agent | ErrorResponse | None:
    if response.status_code == 200:
        response_200 = Agent.from_dict(response.json())



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

    if response.status_code == 409:
        response_409 = ErrorResponse.from_dict(response.json())



        return response_409

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
    agent_id: str,
    *,
    client: AuthenticatedClient,
    body: UpdateAgentRequest,

) -> Response[Agent | ErrorResponse]:
    """ Update an agent

     Partial update. Lifecycle transitions use the archived flag: {archived: true} archives, {archived:
    false} unarchives. Field updates on an archived agent are rejected with 409.

    Args:
        agent_id (str):  Example: 0195f5d6-7c20-7000-8000-000000000002.
        body (UpdateAgentRequest):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[Agent | ErrorResponse]
     """


    kwargs = _get_kwargs(
        agent_id=agent_id,
body=body,

    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)

def sync(
    agent_id: str,
    *,
    client: AuthenticatedClient,
    body: UpdateAgentRequest,

) -> Agent | ErrorResponse | None:
    """ Update an agent

     Partial update. Lifecycle transitions use the archived flag: {archived: true} archives, {archived:
    false} unarchives. Field updates on an archived agent are rejected with 409.

    Args:
        agent_id (str):  Example: 0195f5d6-7c20-7000-8000-000000000002.
        body (UpdateAgentRequest):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Agent | ErrorResponse
     """


    return sync_detailed(
        agent_id=agent_id,
client=client,
body=body,

    ).parsed

async def asyncio_detailed(
    agent_id: str,
    *,
    client: AuthenticatedClient,
    body: UpdateAgentRequest,

) -> Response[Agent | ErrorResponse]:
    """ Update an agent

     Partial update. Lifecycle transitions use the archived flag: {archived: true} archives, {archived:
    false} unarchives. Field updates on an archived agent are rejected with 409.

    Args:
        agent_id (str):  Example: 0195f5d6-7c20-7000-8000-000000000002.
        body (UpdateAgentRequest):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[Agent | ErrorResponse]
     """


    kwargs = _get_kwargs(
        agent_id=agent_id,
body=body,

    )

    response = await client.get_async_httpx_client().request(
        **kwargs
    )

    return _build_response(client=client, response=response)

async def asyncio(
    agent_id: str,
    *,
    client: AuthenticatedClient,
    body: UpdateAgentRequest,

) -> Agent | ErrorResponse | None:
    """ Update an agent

     Partial update. Lifecycle transitions use the archived flag: {archived: true} archives, {archived:
    false} unarchives. Field updates on an archived agent are rejected with 409.

    Args:
        agent_id (str):  Example: 0195f5d6-7c20-7000-8000-000000000002.
        body (UpdateAgentRequest):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Agent | ErrorResponse
     """


    return (await asyncio_detailed(
        agent_id=agent_id,
client=client,
body=body,

    )).parsed
