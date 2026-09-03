from http import HTTPStatus
from typing import Any, cast
from urllib.parse import quote

import httpx

from ...client import AuthenticatedClient, Client
from ...types import Response, UNSET
from ... import errors

from ...models.error_response import ErrorResponse
from ...models.runner import Runner
from ...models.update_runner_request import UpdateRunnerRequest
from ...types import UNSET, Unset
from typing import cast



def _get_kwargs(
    runner_id: str,
    *,
    body: UpdateRunnerRequest,
    x_ama_project_id: str | Unset = UNSET,

) -> dict[str, Any]:
    headers: dict[str, Any] = {}
    if not isinstance(x_ama_project_id, Unset):
        headers["X-AMA-Project-ID"] = x_ama_project_id







    _kwargs: dict[str, Any] = {
        "method": "patch",
        "url": "/api/v1/runners/{runner_id}".format(runner_id=quote(str(runner_id), safe=""),),
    }

    _kwargs["json"] = body.to_dict()

    headers["Content-Type"] = "application/json"

    _kwargs["headers"] = headers
    return _kwargs



def _parse_response(*, client: AuthenticatedClient | Client, response: httpx.Response) -> ErrorResponse | Runner | None:
    if response.status_code == 200:
        response_200 = Runner.from_dict(response.json())



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


def _build_response(*, client: AuthenticatedClient | Client, response: httpx.Response) -> Response[ErrorResponse | Runner]:
    return Response(
        status_code=HTTPStatus(response.status_code),
        content=response.content,
        headers=response.headers,
        parsed=_parse_response(client=client, response=response),
    )


def sync_detailed(
    runner_id: str,
    *,
    client: AuthenticatedClient,
    body: UpdateRunnerRequest,
    x_ama_project_id: str | Unset = UNSET,

) -> Response[ErrorResponse | Runner]:
    """ Update or archive a self-hosted runner

    Args:
        runner_id (str):  Example: 0195f5d6-7c20-7000-8000-000000000011.
        x_ama_project_id (str | Unset):
        body (UpdateRunnerRequest):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[ErrorResponse | Runner]
     """


    kwargs = _get_kwargs(
        runner_id=runner_id,
body=body,
x_ama_project_id=x_ama_project_id,

    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)

def sync(
    runner_id: str,
    *,
    client: AuthenticatedClient,
    body: UpdateRunnerRequest,
    x_ama_project_id: str | Unset = UNSET,

) -> ErrorResponse | Runner | None:
    """ Update or archive a self-hosted runner

    Args:
        runner_id (str):  Example: 0195f5d6-7c20-7000-8000-000000000011.
        x_ama_project_id (str | Unset):
        body (UpdateRunnerRequest):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        ErrorResponse | Runner
     """


    return sync_detailed(
        runner_id=runner_id,
client=client,
body=body,
x_ama_project_id=x_ama_project_id,

    ).parsed

async def asyncio_detailed(
    runner_id: str,
    *,
    client: AuthenticatedClient,
    body: UpdateRunnerRequest,
    x_ama_project_id: str | Unset = UNSET,

) -> Response[ErrorResponse | Runner]:
    """ Update or archive a self-hosted runner

    Args:
        runner_id (str):  Example: 0195f5d6-7c20-7000-8000-000000000011.
        x_ama_project_id (str | Unset):
        body (UpdateRunnerRequest):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[ErrorResponse | Runner]
     """


    kwargs = _get_kwargs(
        runner_id=runner_id,
body=body,
x_ama_project_id=x_ama_project_id,

    )

    response = await client.get_async_httpx_client().request(
        **kwargs
    )

    return _build_response(client=client, response=response)

async def asyncio(
    runner_id: str,
    *,
    client: AuthenticatedClient,
    body: UpdateRunnerRequest,
    x_ama_project_id: str | Unset = UNSET,

) -> ErrorResponse | Runner | None:
    """ Update or archive a self-hosted runner

    Args:
        runner_id (str):  Example: 0195f5d6-7c20-7000-8000-000000000011.
        x_ama_project_id (str | Unset):
        body (UpdateRunnerRequest):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        ErrorResponse | Runner
     """


    return (await asyncio_detailed(
        runner_id=runner_id,
client=client,
body=body,
x_ama_project_id=x_ama_project_id,

    )).parsed
