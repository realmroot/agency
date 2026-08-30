from http import HTTPStatus
from typing import Any, cast
from urllib.parse import quote

import httpx

from ...client import AuthenticatedClient, Client
from ...types import Response, UNSET
from ... import errors

from ...models.error_response import ErrorResponse
from ...models.session_approval import SessionApproval
from ...models.session_approval_decision_request import SessionApprovalDecisionRequest
from typing import cast



def _get_kwargs(
    session_id: str,
    approval_id: str,
    *,
    body: SessionApprovalDecisionRequest,

) -> dict[str, Any]:
    headers: dict[str, Any] = {}






    _kwargs: dict[str, Any] = {
        "method": "patch",
        "url": "/api/v1/sessions/{session_id}/approvals/{approval_id}".format(session_id=quote(str(session_id), safe=""),approval_id=quote(str(approval_id), safe=""),),
    }

    _kwargs["json"] = body.to_dict()

    headers["Content-Type"] = "application/json"

    _kwargs["headers"] = headers
    return _kwargs



def _parse_response(*, client: AuthenticatedClient | Client, response: httpx.Response) -> ErrorResponse | SessionApproval | None:
    if response.status_code == 200:
        response_200 = SessionApproval.from_dict(response.json())



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


def _build_response(*, client: AuthenticatedClient | Client, response: httpx.Response) -> Response[ErrorResponse | SessionApproval]:
    return Response(
        status_code=HTTPStatus(response.status_code),
        content=response.content,
        headers=response.headers,
        parsed=_parse_response(client=client, response=response),
    )


def sync_detailed(
    session_id: str,
    approval_id: str,
    *,
    client: AuthenticatedClient,
    body: SessionApprovalDecisionRequest,

) -> Response[ErrorResponse | SessionApproval]:
    """ Approve or deny a pending tool call

     Records the human decision for a paused tool call. Approval resumes the runtime and executes the
    tool (or records the provided custom result); denial resumes the runtime with the denial.

    Args:
        session_id (str):  Example: 0195f5d6-7c20-7000-8000-00000000000e.
        approval_id (str):  Example: 0195f5d6-7c20-7000-8000-000000000010.
        body (SessionApprovalDecisionRequest):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[ErrorResponse | SessionApproval]
     """


    kwargs = _get_kwargs(
        session_id=session_id,
approval_id=approval_id,
body=body,

    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)

def sync(
    session_id: str,
    approval_id: str,
    *,
    client: AuthenticatedClient,
    body: SessionApprovalDecisionRequest,

) -> ErrorResponse | SessionApproval | None:
    """ Approve or deny a pending tool call

     Records the human decision for a paused tool call. Approval resumes the runtime and executes the
    tool (or records the provided custom result); denial resumes the runtime with the denial.

    Args:
        session_id (str):  Example: 0195f5d6-7c20-7000-8000-00000000000e.
        approval_id (str):  Example: 0195f5d6-7c20-7000-8000-000000000010.
        body (SessionApprovalDecisionRequest):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        ErrorResponse | SessionApproval
     """


    return sync_detailed(
        session_id=session_id,
approval_id=approval_id,
client=client,
body=body,

    ).parsed

async def asyncio_detailed(
    session_id: str,
    approval_id: str,
    *,
    client: AuthenticatedClient,
    body: SessionApprovalDecisionRequest,

) -> Response[ErrorResponse | SessionApproval]:
    """ Approve or deny a pending tool call

     Records the human decision for a paused tool call. Approval resumes the runtime and executes the
    tool (or records the provided custom result); denial resumes the runtime with the denial.

    Args:
        session_id (str):  Example: 0195f5d6-7c20-7000-8000-00000000000e.
        approval_id (str):  Example: 0195f5d6-7c20-7000-8000-000000000010.
        body (SessionApprovalDecisionRequest):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[ErrorResponse | SessionApproval]
     """


    kwargs = _get_kwargs(
        session_id=session_id,
approval_id=approval_id,
body=body,

    )

    response = await client.get_async_httpx_client().request(
        **kwargs
    )

    return _build_response(client=client, response=response)

async def asyncio(
    session_id: str,
    approval_id: str,
    *,
    client: AuthenticatedClient,
    body: SessionApprovalDecisionRequest,

) -> ErrorResponse | SessionApproval | None:
    """ Approve or deny a pending tool call

     Records the human decision for a paused tool call. Approval resumes the runtime and executes the
    tool (or records the provided custom result); denial resumes the runtime with the denial.

    Args:
        session_id (str):  Example: 0195f5d6-7c20-7000-8000-00000000000e.
        approval_id (str):  Example: 0195f5d6-7c20-7000-8000-000000000010.
        body (SessionApprovalDecisionRequest):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        ErrorResponse | SessionApproval
     """


    return (await asyncio_detailed(
        session_id=session_id,
approval_id=approval_id,
client=client,
body=body,

    )).parsed
