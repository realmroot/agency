from http import HTTPStatus
from typing import Any, cast
from urllib.parse import quote

import httpx

from ...client import AuthenticatedClient, Client
from ...types import Response, UNSET
from ... import errors

from ...models.environment import Environment
from ...models.error_response import ErrorResponse
from ...models.update_environment_request import UpdateEnvironmentRequest
from ...types import UNSET, Unset
from typing import cast



def _get_kwargs(
    environment_id: str,
    *,
    body: UpdateEnvironmentRequest,
    x_ama_project_id: str | Unset = UNSET,

) -> dict[str, Any]:
    headers: dict[str, Any] = {}
    if not isinstance(x_ama_project_id, Unset):
        headers["X-AMA-Project-ID"] = x_ama_project_id







    _kwargs: dict[str, Any] = {
        "method": "patch",
        "url": "/api/v1/environments/{environment_id}".format(environment_id=quote(str(environment_id), safe=""),),
    }

    _kwargs["json"] = body.to_dict()

    headers["Content-Type"] = "application/json"

    _kwargs["headers"] = headers
    return _kwargs



def _parse_response(*, client: AuthenticatedClient | Client, response: httpx.Response) -> Environment | ErrorResponse | None:
    if response.status_code == 200:
        response_200 = Environment.from_dict(response.json())



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


def _build_response(*, client: AuthenticatedClient | Client, response: httpx.Response) -> Response[Environment | ErrorResponse]:
    return Response(
        status_code=HTTPStatus(response.status_code),
        content=response.content,
        headers=response.headers,
        parsed=_parse_response(client=client, response=response),
    )


def sync_detailed(
    environment_id: str,
    *,
    client: AuthenticatedClient,
    body: UpdateEnvironmentRequest,
    x_ama_project_id: str | Unset = UNSET,

) -> Response[Environment | ErrorResponse]:
    """ Update an environment

     Partial update. Lifecycle transitions use the archived flag: {archived: true} archives, {archived:
    false} unarchives. Field updates on an archived environment are rejected with 409.

    Args:
        environment_id (str):  Example: 0195f5d6-7c20-7000-8000-000000000005.
        x_ama_project_id (str | Unset):
        body (UpdateEnvironmentRequest):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[Environment | ErrorResponse]
     """


    kwargs = _get_kwargs(
        environment_id=environment_id,
body=body,
x_ama_project_id=x_ama_project_id,

    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)

def sync(
    environment_id: str,
    *,
    client: AuthenticatedClient,
    body: UpdateEnvironmentRequest,
    x_ama_project_id: str | Unset = UNSET,

) -> Environment | ErrorResponse | None:
    """ Update an environment

     Partial update. Lifecycle transitions use the archived flag: {archived: true} archives, {archived:
    false} unarchives. Field updates on an archived environment are rejected with 409.

    Args:
        environment_id (str):  Example: 0195f5d6-7c20-7000-8000-000000000005.
        x_ama_project_id (str | Unset):
        body (UpdateEnvironmentRequest):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Environment | ErrorResponse
     """


    return sync_detailed(
        environment_id=environment_id,
client=client,
body=body,
x_ama_project_id=x_ama_project_id,

    ).parsed

async def asyncio_detailed(
    environment_id: str,
    *,
    client: AuthenticatedClient,
    body: UpdateEnvironmentRequest,
    x_ama_project_id: str | Unset = UNSET,

) -> Response[Environment | ErrorResponse]:
    """ Update an environment

     Partial update. Lifecycle transitions use the archived flag: {archived: true} archives, {archived:
    false} unarchives. Field updates on an archived environment are rejected with 409.

    Args:
        environment_id (str):  Example: 0195f5d6-7c20-7000-8000-000000000005.
        x_ama_project_id (str | Unset):
        body (UpdateEnvironmentRequest):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[Environment | ErrorResponse]
     """


    kwargs = _get_kwargs(
        environment_id=environment_id,
body=body,
x_ama_project_id=x_ama_project_id,

    )

    response = await client.get_async_httpx_client().request(
        **kwargs
    )

    return _build_response(client=client, response=response)

async def asyncio(
    environment_id: str,
    *,
    client: AuthenticatedClient,
    body: UpdateEnvironmentRequest,
    x_ama_project_id: str | Unset = UNSET,

) -> Environment | ErrorResponse | None:
    """ Update an environment

     Partial update. Lifecycle transitions use the archived flag: {archived: true} archives, {archived:
    false} unarchives. Field updates on an archived environment are rejected with 409.

    Args:
        environment_id (str):  Example: 0195f5d6-7c20-7000-8000-000000000005.
        x_ama_project_id (str | Unset):
        body (UpdateEnvironmentRequest):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Environment | ErrorResponse
     """


    return (await asyncio_detailed(
        environment_id=environment_id,
client=client,
body=body,
x_ama_project_id=x_ama_project_id,

    )).parsed
