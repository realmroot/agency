from http import HTTPStatus
from typing import Any, cast
from urllib.parse import quote

import httpx

from ...client import AuthenticatedClient, Client
from ...types import Response, UNSET
from ... import errors

from ...models.error_response import ErrorResponse
from ...models.put_runner_heartbeat_request import PutRunnerHeartbeatRequest
from ...models.runner_heartbeat import RunnerHeartbeat
from ...types import UNSET, Unset
from typing import cast



def _get_kwargs(
    runner_id: str,
    *,
    body: PutRunnerHeartbeatRequest,
    x_enbor_project_id: str | Unset = UNSET,

) -> dict[str, Any]:
    headers: dict[str, Any] = {}
    if not isinstance(x_enbor_project_id, Unset):
        headers["X-Enbor-Project-ID"] = x_enbor_project_id







    _kwargs: dict[str, Any] = {
        "method": "put",
        "url": "/api/v1/runners/{runner_id}/heartbeat".format(runner_id=quote(str(runner_id), safe=""),),
    }

    _kwargs["json"] = body.to_dict()

    headers["Content-Type"] = "application/json"

    _kwargs["headers"] = headers
    return _kwargs



def _parse_response(*, client: AuthenticatedClient | Client, response: httpx.Response) -> ErrorResponse | RunnerHeartbeat | None:
    if response.status_code == 200:
        response_200 = RunnerHeartbeat.from_dict(response.json())



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


def _build_response(*, client: AuthenticatedClient | Client, response: httpx.Response) -> Response[ErrorResponse | RunnerHeartbeat]:
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
    body: PutRunnerHeartbeatRequest,
    x_enbor_project_id: str | Unset = UNSET,

) -> Response[ErrorResponse | RunnerHeartbeat]:
    """ Replace the current runner heartbeat state

    Args:
        runner_id (str):  Example: 0195f5d6-7c20-7000-8000-000000000011.
        x_enbor_project_id (str | Unset):
        body (PutRunnerHeartbeatRequest):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[ErrorResponse | RunnerHeartbeat]
     """


    kwargs = _get_kwargs(
        runner_id=runner_id,
body=body,
x_enbor_project_id=x_enbor_project_id,

    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)

def sync(
    runner_id: str,
    *,
    client: AuthenticatedClient,
    body: PutRunnerHeartbeatRequest,
    x_enbor_project_id: str | Unset = UNSET,

) -> ErrorResponse | RunnerHeartbeat | None:
    """ Replace the current runner heartbeat state

    Args:
        runner_id (str):  Example: 0195f5d6-7c20-7000-8000-000000000011.
        x_enbor_project_id (str | Unset):
        body (PutRunnerHeartbeatRequest):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        ErrorResponse | RunnerHeartbeat
     """


    return sync_detailed(
        runner_id=runner_id,
client=client,
body=body,
x_enbor_project_id=x_enbor_project_id,

    ).parsed

async def asyncio_detailed(
    runner_id: str,
    *,
    client: AuthenticatedClient,
    body: PutRunnerHeartbeatRequest,
    x_enbor_project_id: str | Unset = UNSET,

) -> Response[ErrorResponse | RunnerHeartbeat]:
    """ Replace the current runner heartbeat state

    Args:
        runner_id (str):  Example: 0195f5d6-7c20-7000-8000-000000000011.
        x_enbor_project_id (str | Unset):
        body (PutRunnerHeartbeatRequest):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[ErrorResponse | RunnerHeartbeat]
     """


    kwargs = _get_kwargs(
        runner_id=runner_id,
body=body,
x_enbor_project_id=x_enbor_project_id,

    )

    response = await client.get_async_httpx_client().request(
        **kwargs
    )

    return _build_response(client=client, response=response)

async def asyncio(
    runner_id: str,
    *,
    client: AuthenticatedClient,
    body: PutRunnerHeartbeatRequest,
    x_enbor_project_id: str | Unset = UNSET,

) -> ErrorResponse | RunnerHeartbeat | None:
    """ Replace the current runner heartbeat state

    Args:
        runner_id (str):  Example: 0195f5d6-7c20-7000-8000-000000000011.
        x_enbor_project_id (str | Unset):
        body (PutRunnerHeartbeatRequest):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        ErrorResponse | RunnerHeartbeat
     """


    return (await asyncio_detailed(
        runner_id=runner_id,
client=client,
body=body,
x_enbor_project_id=x_enbor_project_id,

    )).parsed
