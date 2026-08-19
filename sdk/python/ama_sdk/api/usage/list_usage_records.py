from http import HTTPStatus
from typing import Any, cast
from urllib.parse import quote

import httpx

from ...client import AuthenticatedClient, Client
from ...types import Response, UNSET
from ... import errors

from ...models.error_response import ErrorResponse
from ...models.usage_record_list_response import UsageRecordListResponse
from ...types import UNSET, Unset
from typing import cast
import datetime



def _get_kwargs(
    *,
    from_: datetime.datetime | Unset = UNSET,
    to: datetime.datetime | Unset = UNSET,
    provider_id: str | Unset = UNSET,
    model_id: str | Unset = UNSET,
    agent_id: str | Unset = UNSET,
    session_id: str | Unset = UNSET,
    limit: int | Unset = UNSET,
    cursor: str | Unset = UNSET,

) -> dict[str, Any]:
    

    

    params: dict[str, Any] = {}

    json_from_: str | Unset = UNSET
    if not isinstance(from_, Unset):
        json_from_ = from_.isoformat()
    params["from"] = json_from_

    json_to: str | Unset = UNSET
    if not isinstance(to, Unset):
        json_to = to.isoformat()
    params["to"] = json_to

    params["providerId"] = provider_id

    params["modelId"] = model_id

    params["agentId"] = agent_id

    params["sessionId"] = session_id

    params["limit"] = limit

    params["cursor"] = cursor


    params = {k: v for k, v in params.items() if v is not UNSET and v is not None}


    _kwargs: dict[str, Any] = {
        "method": "get",
        "url": "/api/v1/usage-records",
        "params": params,
    }


    return _kwargs



def _parse_response(*, client: AuthenticatedClient | Client, response: httpx.Response) -> ErrorResponse | UsageRecordListResponse | None:
    if response.status_code == 200:
        response_200 = UsageRecordListResponse.from_dict(response.json())



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

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(*, client: AuthenticatedClient | Client, response: httpx.Response) -> Response[ErrorResponse | UsageRecordListResponse]:
    return Response(
        status_code=HTTPStatus(response.status_code),
        content=response.content,
        headers=response.headers,
        parsed=_parse_response(client=client, response=response),
    )


def sync_detailed(
    *,
    client: AuthenticatedClient,
    from_: datetime.datetime | Unset = UNSET,
    to: datetime.datetime | Unset = UNSET,
    provider_id: str | Unset = UNSET,
    model_id: str | Unset = UNSET,
    agent_id: str | Unset = UNSET,
    session_id: str | Unset = UNSET,
    limit: int | Unset = UNSET,
    cursor: str | Unset = UNSET,

) -> Response[ErrorResponse | UsageRecordListResponse]:
    """ List usage records

     Lists usage records for the project. Send Accept: text/csv to export the filtered records as CSV.

    Args:
        from_ (datetime.datetime | Unset):  Example: 2026-05-01T00:00:00.000Z.
        to (datetime.datetime | Unset):  Example: 2026-05-31T23:59:59.999Z.
        provider_id (str | Unset):  Example: workers-ai.
        model_id (str | Unset):  Example: @cf/moonshotai/kimi-k2.6.
        agent_id (str | Unset):  Example: agent_abc123.
        session_id (str | Unset):  Example: session_abc123.
        limit (int | Unset):  Example: 50.
        cursor (str | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[ErrorResponse | UsageRecordListResponse]
     """


    kwargs = _get_kwargs(
        from_=from_,
to=to,
provider_id=provider_id,
model_id=model_id,
agent_id=agent_id,
session_id=session_id,
limit=limit,
cursor=cursor,

    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)

def sync(
    *,
    client: AuthenticatedClient,
    from_: datetime.datetime | Unset = UNSET,
    to: datetime.datetime | Unset = UNSET,
    provider_id: str | Unset = UNSET,
    model_id: str | Unset = UNSET,
    agent_id: str | Unset = UNSET,
    session_id: str | Unset = UNSET,
    limit: int | Unset = UNSET,
    cursor: str | Unset = UNSET,

) -> ErrorResponse | UsageRecordListResponse | None:
    """ List usage records

     Lists usage records for the project. Send Accept: text/csv to export the filtered records as CSV.

    Args:
        from_ (datetime.datetime | Unset):  Example: 2026-05-01T00:00:00.000Z.
        to (datetime.datetime | Unset):  Example: 2026-05-31T23:59:59.999Z.
        provider_id (str | Unset):  Example: workers-ai.
        model_id (str | Unset):  Example: @cf/moonshotai/kimi-k2.6.
        agent_id (str | Unset):  Example: agent_abc123.
        session_id (str | Unset):  Example: session_abc123.
        limit (int | Unset):  Example: 50.
        cursor (str | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        ErrorResponse | UsageRecordListResponse
     """


    return sync_detailed(
        client=client,
from_=from_,
to=to,
provider_id=provider_id,
model_id=model_id,
agent_id=agent_id,
session_id=session_id,
limit=limit,
cursor=cursor,

    ).parsed

async def asyncio_detailed(
    *,
    client: AuthenticatedClient,
    from_: datetime.datetime | Unset = UNSET,
    to: datetime.datetime | Unset = UNSET,
    provider_id: str | Unset = UNSET,
    model_id: str | Unset = UNSET,
    agent_id: str | Unset = UNSET,
    session_id: str | Unset = UNSET,
    limit: int | Unset = UNSET,
    cursor: str | Unset = UNSET,

) -> Response[ErrorResponse | UsageRecordListResponse]:
    """ List usage records

     Lists usage records for the project. Send Accept: text/csv to export the filtered records as CSV.

    Args:
        from_ (datetime.datetime | Unset):  Example: 2026-05-01T00:00:00.000Z.
        to (datetime.datetime | Unset):  Example: 2026-05-31T23:59:59.999Z.
        provider_id (str | Unset):  Example: workers-ai.
        model_id (str | Unset):  Example: @cf/moonshotai/kimi-k2.6.
        agent_id (str | Unset):  Example: agent_abc123.
        session_id (str | Unset):  Example: session_abc123.
        limit (int | Unset):  Example: 50.
        cursor (str | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[ErrorResponse | UsageRecordListResponse]
     """


    kwargs = _get_kwargs(
        from_=from_,
to=to,
provider_id=provider_id,
model_id=model_id,
agent_id=agent_id,
session_id=session_id,
limit=limit,
cursor=cursor,

    )

    response = await client.get_async_httpx_client().request(
        **kwargs
    )

    return _build_response(client=client, response=response)

async def asyncio(
    *,
    client: AuthenticatedClient,
    from_: datetime.datetime | Unset = UNSET,
    to: datetime.datetime | Unset = UNSET,
    provider_id: str | Unset = UNSET,
    model_id: str | Unset = UNSET,
    agent_id: str | Unset = UNSET,
    session_id: str | Unset = UNSET,
    limit: int | Unset = UNSET,
    cursor: str | Unset = UNSET,

) -> ErrorResponse | UsageRecordListResponse | None:
    """ List usage records

     Lists usage records for the project. Send Accept: text/csv to export the filtered records as CSV.

    Args:
        from_ (datetime.datetime | Unset):  Example: 2026-05-01T00:00:00.000Z.
        to (datetime.datetime | Unset):  Example: 2026-05-31T23:59:59.999Z.
        provider_id (str | Unset):  Example: workers-ai.
        model_id (str | Unset):  Example: @cf/moonshotai/kimi-k2.6.
        agent_id (str | Unset):  Example: agent_abc123.
        session_id (str | Unset):  Example: session_abc123.
        limit (int | Unset):  Example: 50.
        cursor (str | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        ErrorResponse | UsageRecordListResponse
     """


    return (await asyncio_detailed(
        client=client,
from_=from_,
to=to,
provider_id=provider_id,
model_id=model_id,
agent_id=agent_id,
session_id=session_id,
limit=limit,
cursor=cursor,

    )).parsed
