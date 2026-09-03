from http import HTTPStatus
from typing import Any, cast
from urllib.parse import quote

import httpx

from ...client import AuthenticatedClient, Client
from ...types import Response, UNSET
from ... import errors

from ...models.error_response import ErrorResponse
from ...models.read_usage_summary_group_by import ReadUsageSummaryGroupBy
from ...models.usage_summary import UsageSummary
from ...types import UNSET, Unset
from typing import cast
import datetime



def _get_kwargs(
    *,
    group_by: ReadUsageSummaryGroupBy | Unset = UNSET,
    from_: datetime.datetime | Unset = UNSET,
    to: datetime.datetime | Unset = UNSET,
    x_enbor_project_id: str | Unset = UNSET,

) -> dict[str, Any]:
    headers: dict[str, Any] = {}
    if not isinstance(x_enbor_project_id, Unset):
        headers["X-Enbor-Project-ID"] = x_enbor_project_id





    params: dict[str, Any] = {}

    json_group_by: str | Unset = UNSET
    if not isinstance(group_by, Unset):
        json_group_by = group_by.value

    params["groupBy"] = json_group_by

    json_from_: str | Unset = UNSET
    if not isinstance(from_, Unset):
        json_from_ = from_.isoformat()
    params["from"] = json_from_

    json_to: str | Unset = UNSET
    if not isinstance(to, Unset):
        json_to = to.isoformat()
    params["to"] = json_to


    params = {k: v for k, v in params.items() if v is not UNSET and v is not None}


    _kwargs: dict[str, Any] = {
        "method": "get",
        "url": "/api/v1/usage-summary",
        "params": params,
    }


    _kwargs["headers"] = headers
    return _kwargs



def _parse_response(*, client: AuthenticatedClient | Client, response: httpx.Response) -> ErrorResponse | UsageSummary | None:
    if response.status_code == 200:
        response_200 = UsageSummary.from_dict(response.json())



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


def _build_response(*, client: AuthenticatedClient | Client, response: httpx.Response) -> Response[ErrorResponse | UsageSummary]:
    return Response(
        status_code=HTTPStatus(response.status_code),
        content=response.content,
        headers=response.headers,
        parsed=_parse_response(client=client, response=response),
    )


def sync_detailed(
    *,
    client: AuthenticatedClient,
    group_by: ReadUsageSummaryGroupBy | Unset = UNSET,
    from_: datetime.datetime | Unset = UNSET,
    to: datetime.datetime | Unset = UNSET,
    x_enbor_project_id: str | Unset = UNSET,

) -> Response[ErrorResponse | UsageSummary]:
    """ Read aggregated usage

     Read-only aggregation of usage records grouped by provider, model, or agent.

    Args:
        group_by (ReadUsageSummaryGroupBy | Unset):  Example: provider.
        from_ (datetime.datetime | Unset):  Example: 2026-05-01T00:00:00.000Z.
        to (datetime.datetime | Unset):  Example: 2026-05-31T23:59:59.999Z.
        x_enbor_project_id (str | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[ErrorResponse | UsageSummary]
     """


    kwargs = _get_kwargs(
        group_by=group_by,
from_=from_,
to=to,
x_enbor_project_id=x_enbor_project_id,

    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)

def sync(
    *,
    client: AuthenticatedClient,
    group_by: ReadUsageSummaryGroupBy | Unset = UNSET,
    from_: datetime.datetime | Unset = UNSET,
    to: datetime.datetime | Unset = UNSET,
    x_enbor_project_id: str | Unset = UNSET,

) -> ErrorResponse | UsageSummary | None:
    """ Read aggregated usage

     Read-only aggregation of usage records grouped by provider, model, or agent.

    Args:
        group_by (ReadUsageSummaryGroupBy | Unset):  Example: provider.
        from_ (datetime.datetime | Unset):  Example: 2026-05-01T00:00:00.000Z.
        to (datetime.datetime | Unset):  Example: 2026-05-31T23:59:59.999Z.
        x_enbor_project_id (str | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        ErrorResponse | UsageSummary
     """


    return sync_detailed(
        client=client,
group_by=group_by,
from_=from_,
to=to,
x_enbor_project_id=x_enbor_project_id,

    ).parsed

async def asyncio_detailed(
    *,
    client: AuthenticatedClient,
    group_by: ReadUsageSummaryGroupBy | Unset = UNSET,
    from_: datetime.datetime | Unset = UNSET,
    to: datetime.datetime | Unset = UNSET,
    x_enbor_project_id: str | Unset = UNSET,

) -> Response[ErrorResponse | UsageSummary]:
    """ Read aggregated usage

     Read-only aggregation of usage records grouped by provider, model, or agent.

    Args:
        group_by (ReadUsageSummaryGroupBy | Unset):  Example: provider.
        from_ (datetime.datetime | Unset):  Example: 2026-05-01T00:00:00.000Z.
        to (datetime.datetime | Unset):  Example: 2026-05-31T23:59:59.999Z.
        x_enbor_project_id (str | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[ErrorResponse | UsageSummary]
     """


    kwargs = _get_kwargs(
        group_by=group_by,
from_=from_,
to=to,
x_enbor_project_id=x_enbor_project_id,

    )

    response = await client.get_async_httpx_client().request(
        **kwargs
    )

    return _build_response(client=client, response=response)

async def asyncio(
    *,
    client: AuthenticatedClient,
    group_by: ReadUsageSummaryGroupBy | Unset = UNSET,
    from_: datetime.datetime | Unset = UNSET,
    to: datetime.datetime | Unset = UNSET,
    x_enbor_project_id: str | Unset = UNSET,

) -> ErrorResponse | UsageSummary | None:
    """ Read aggregated usage

     Read-only aggregation of usage records grouped by provider, model, or agent.

    Args:
        group_by (ReadUsageSummaryGroupBy | Unset):  Example: provider.
        from_ (datetime.datetime | Unset):  Example: 2026-05-01T00:00:00.000Z.
        to (datetime.datetime | Unset):  Example: 2026-05-31T23:59:59.999Z.
        x_enbor_project_id (str | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        ErrorResponse | UsageSummary
     """


    return (await asyncio_detailed(
        client=client,
group_by=group_by,
from_=from_,
to=to,
x_enbor_project_id=x_enbor_project_id,

    )).parsed
