from http import HTTPStatus
from typing import Any, cast
from urllib.parse import quote

import httpx

from ...client import AuthenticatedClient, Client
from ...types import Response, UNSET
from ... import errors

from ...models.error_response import ErrorResponse
from ...models.trigger_run import TriggerRun
from ...types import UNSET, Unset
from typing import cast



def _get_kwargs(
    trigger_id: str,
    run_id: str,
    *,
    x_enbor_project_id: str | Unset = UNSET,

) -> dict[str, Any]:
    headers: dict[str, Any] = {}
    if not isinstance(x_enbor_project_id, Unset):
        headers["X-Enbor-Project-ID"] = x_enbor_project_id







    _kwargs: dict[str, Any] = {
        "method": "get",
        "url": "/api/v1/triggers/{trigger_id}/runs/{run_id}".format(trigger_id=quote(str(trigger_id), safe=""),run_id=quote(str(run_id), safe=""),),
    }


    _kwargs["headers"] = headers
    return _kwargs



def _parse_response(*, client: AuthenticatedClient | Client, response: httpx.Response) -> ErrorResponse | TriggerRun | None:
    if response.status_code == 200:
        response_200 = TriggerRun.from_dict(response.json())



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


def _build_response(*, client: AuthenticatedClient | Client, response: httpx.Response) -> Response[ErrorResponse | TriggerRun]:
    return Response(
        status_code=HTTPStatus(response.status_code),
        content=response.content,
        headers=response.headers,
        parsed=_parse_response(client=client, response=response),
    )


def sync_detailed(
    trigger_id: str,
    run_id: str,
    *,
    client: AuthenticatedClient,
    x_enbor_project_id: str | Unset = UNSET,

) -> Response[ErrorResponse | TriggerRun]:
    """ Read a trigger run

    Args:
        trigger_id (str):  Example: 0195f5d6-7c20-7000-8000-00000000000c.
        run_id (str):  Example: 0195f5d6-7c20-7000-8000-00000000000d.
        x_enbor_project_id (str | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[ErrorResponse | TriggerRun]
     """


    kwargs = _get_kwargs(
        trigger_id=trigger_id,
run_id=run_id,
x_enbor_project_id=x_enbor_project_id,

    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)

def sync(
    trigger_id: str,
    run_id: str,
    *,
    client: AuthenticatedClient,
    x_enbor_project_id: str | Unset = UNSET,

) -> ErrorResponse | TriggerRun | None:
    """ Read a trigger run

    Args:
        trigger_id (str):  Example: 0195f5d6-7c20-7000-8000-00000000000c.
        run_id (str):  Example: 0195f5d6-7c20-7000-8000-00000000000d.
        x_enbor_project_id (str | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        ErrorResponse | TriggerRun
     """


    return sync_detailed(
        trigger_id=trigger_id,
run_id=run_id,
client=client,
x_enbor_project_id=x_enbor_project_id,

    ).parsed

async def asyncio_detailed(
    trigger_id: str,
    run_id: str,
    *,
    client: AuthenticatedClient,
    x_enbor_project_id: str | Unset = UNSET,

) -> Response[ErrorResponse | TriggerRun]:
    """ Read a trigger run

    Args:
        trigger_id (str):  Example: 0195f5d6-7c20-7000-8000-00000000000c.
        run_id (str):  Example: 0195f5d6-7c20-7000-8000-00000000000d.
        x_enbor_project_id (str | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[ErrorResponse | TriggerRun]
     """


    kwargs = _get_kwargs(
        trigger_id=trigger_id,
run_id=run_id,
x_enbor_project_id=x_enbor_project_id,

    )

    response = await client.get_async_httpx_client().request(
        **kwargs
    )

    return _build_response(client=client, response=response)

async def asyncio(
    trigger_id: str,
    run_id: str,
    *,
    client: AuthenticatedClient,
    x_enbor_project_id: str | Unset = UNSET,

) -> ErrorResponse | TriggerRun | None:
    """ Read a trigger run

    Args:
        trigger_id (str):  Example: 0195f5d6-7c20-7000-8000-00000000000c.
        run_id (str):  Example: 0195f5d6-7c20-7000-8000-00000000000d.
        x_enbor_project_id (str | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        ErrorResponse | TriggerRun
     """


    return (await asyncio_detailed(
        trigger_id=trigger_id,
run_id=run_id,
client=client,
x_enbor_project_id=x_enbor_project_id,

    )).parsed
