from http import HTTPStatus
from typing import Any, cast
from urllib.parse import quote

import httpx

from ...client import AuthenticatedClient, Client
from ...types import Response, UNSET
from ... import errors

from ...models.audit_record_list_response import AuditRecordListResponse
from ...models.error_response import ErrorResponse
from ...types import UNSET, Unset
from typing import cast
import datetime



def _get_kwargs(
    *,
    actor_id: str | Unset = UNSET,
    project_id: str | Unset = UNSET,
    action: str | Unset = UNSET,
    resource_type: str | Unset = UNSET,
    resource_id: str | Unset = UNSET,
    outcome: str | Unset = UNSET,
    from_: datetime.datetime | Unset = UNSET,
    to: datetime.datetime | Unset = UNSET,
    limit: int | Unset = UNSET,
    cursor: str | Unset = UNSET,

) -> dict[str, Any]:
    

    

    params: dict[str, Any] = {}

    params["actorId"] = actor_id

    params["projectId"] = project_id

    params["action"] = action

    params["resourceType"] = resource_type

    params["resourceId"] = resource_id

    params["outcome"] = outcome

    json_from_: str | Unset = UNSET
    if not isinstance(from_, Unset):
        json_from_ = from_.isoformat()
    params["from"] = json_from_

    json_to: str | Unset = UNSET
    if not isinstance(to, Unset):
        json_to = to.isoformat()
    params["to"] = json_to

    params["limit"] = limit

    params["cursor"] = cursor


    params = {k: v for k, v in params.items() if v is not UNSET and v is not None}


    _kwargs: dict[str, Any] = {
        "method": "get",
        "url": "/api/v1/audit-records",
        "params": params,
    }


    return _kwargs



def _parse_response(*, client: AuthenticatedClient | Client, response: httpx.Response) -> AuditRecordListResponse | ErrorResponse | None:
    if response.status_code == 200:
        response_200 = AuditRecordListResponse.from_dict(response.json())



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


def _build_response(*, client: AuthenticatedClient | Client, response: httpx.Response) -> Response[AuditRecordListResponse | ErrorResponse]:
    return Response(
        status_code=HTTPStatus(response.status_code),
        content=response.content,
        headers=response.headers,
        parsed=_parse_response(client=client, response=response),
    )


def sync_detailed(
    *,
    client: AuthenticatedClient,
    actor_id: str | Unset = UNSET,
    project_id: str | Unset = UNSET,
    action: str | Unset = UNSET,
    resource_type: str | Unset = UNSET,
    resource_id: str | Unset = UNSET,
    outcome: str | Unset = UNSET,
    from_: datetime.datetime | Unset = UNSET,
    to: datetime.datetime | Unset = UNSET,
    limit: int | Unset = UNSET,
    cursor: str | Unset = UNSET,

) -> Response[AuditRecordListResponse | ErrorResponse]:
    """ List audit records

     Lists audit records for the organization. Send Accept: text/csv to export the filtered records as
    CSV.

    Args:
        actor_id (str | Unset):
        project_id (str | Unset):
        action (str | Unset):  Example: policy.evaluate.
        resource_type (str | Unset):
        resource_id (str | Unset):
        outcome (str | Unset):  Example: denied.
        from_ (datetime.datetime | Unset):
        to (datetime.datetime | Unset):
        limit (int | Unset):  Example: 50.
        cursor (str | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[AuditRecordListResponse | ErrorResponse]
     """


    kwargs = _get_kwargs(
        actor_id=actor_id,
project_id=project_id,
action=action,
resource_type=resource_type,
resource_id=resource_id,
outcome=outcome,
from_=from_,
to=to,
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
    actor_id: str | Unset = UNSET,
    project_id: str | Unset = UNSET,
    action: str | Unset = UNSET,
    resource_type: str | Unset = UNSET,
    resource_id: str | Unset = UNSET,
    outcome: str | Unset = UNSET,
    from_: datetime.datetime | Unset = UNSET,
    to: datetime.datetime | Unset = UNSET,
    limit: int | Unset = UNSET,
    cursor: str | Unset = UNSET,

) -> AuditRecordListResponse | ErrorResponse | None:
    """ List audit records

     Lists audit records for the organization. Send Accept: text/csv to export the filtered records as
    CSV.

    Args:
        actor_id (str | Unset):
        project_id (str | Unset):
        action (str | Unset):  Example: policy.evaluate.
        resource_type (str | Unset):
        resource_id (str | Unset):
        outcome (str | Unset):  Example: denied.
        from_ (datetime.datetime | Unset):
        to (datetime.datetime | Unset):
        limit (int | Unset):  Example: 50.
        cursor (str | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        AuditRecordListResponse | ErrorResponse
     """


    return sync_detailed(
        client=client,
actor_id=actor_id,
project_id=project_id,
action=action,
resource_type=resource_type,
resource_id=resource_id,
outcome=outcome,
from_=from_,
to=to,
limit=limit,
cursor=cursor,

    ).parsed

async def asyncio_detailed(
    *,
    client: AuthenticatedClient,
    actor_id: str | Unset = UNSET,
    project_id: str | Unset = UNSET,
    action: str | Unset = UNSET,
    resource_type: str | Unset = UNSET,
    resource_id: str | Unset = UNSET,
    outcome: str | Unset = UNSET,
    from_: datetime.datetime | Unset = UNSET,
    to: datetime.datetime | Unset = UNSET,
    limit: int | Unset = UNSET,
    cursor: str | Unset = UNSET,

) -> Response[AuditRecordListResponse | ErrorResponse]:
    """ List audit records

     Lists audit records for the organization. Send Accept: text/csv to export the filtered records as
    CSV.

    Args:
        actor_id (str | Unset):
        project_id (str | Unset):
        action (str | Unset):  Example: policy.evaluate.
        resource_type (str | Unset):
        resource_id (str | Unset):
        outcome (str | Unset):  Example: denied.
        from_ (datetime.datetime | Unset):
        to (datetime.datetime | Unset):
        limit (int | Unset):  Example: 50.
        cursor (str | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[AuditRecordListResponse | ErrorResponse]
     """


    kwargs = _get_kwargs(
        actor_id=actor_id,
project_id=project_id,
action=action,
resource_type=resource_type,
resource_id=resource_id,
outcome=outcome,
from_=from_,
to=to,
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
    actor_id: str | Unset = UNSET,
    project_id: str | Unset = UNSET,
    action: str | Unset = UNSET,
    resource_type: str | Unset = UNSET,
    resource_id: str | Unset = UNSET,
    outcome: str | Unset = UNSET,
    from_: datetime.datetime | Unset = UNSET,
    to: datetime.datetime | Unset = UNSET,
    limit: int | Unset = UNSET,
    cursor: str | Unset = UNSET,

) -> AuditRecordListResponse | ErrorResponse | None:
    """ List audit records

     Lists audit records for the organization. Send Accept: text/csv to export the filtered records as
    CSV.

    Args:
        actor_id (str | Unset):
        project_id (str | Unset):
        action (str | Unset):  Example: policy.evaluate.
        resource_type (str | Unset):
        resource_id (str | Unset):
        outcome (str | Unset):  Example: denied.
        from_ (datetime.datetime | Unset):
        to (datetime.datetime | Unset):
        limit (int | Unset):  Example: 50.
        cursor (str | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        AuditRecordListResponse | ErrorResponse
     """


    return (await asyncio_detailed(
        client=client,
actor_id=actor_id,
project_id=project_id,
action=action,
resource_type=resource_type,
resource_id=resource_id,
outcome=outcome,
from_=from_,
to=to,
limit=limit,
cursor=cursor,

    )).parsed
