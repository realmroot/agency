from http import HTTPStatus
from typing import Any, cast
from urllib.parse import quote

import httpx

from ...client import AuthenticatedClient, Client
from ...types import Response, UNSET
from ... import errors

from ...models.error_response import ErrorResponse
from ...models.inbox_notification import InboxNotification
from ...models.inbox_notification_receipt import InboxNotificationReceipt
from typing import cast



def _get_kwargs(
    *,
    body: InboxNotification,

) -> dict[str, Any]:
    headers: dict[str, Any] = {}






    _kwargs: dict[str, Any] = {
        "method": "post",
        "url": "/api/v1/inbox-notifications",
    }

    _kwargs["json"] = body.to_dict()

    headers["Content-Type"] = "application/json"

    _kwargs["headers"] = headers
    return _kwargs



def _parse_response(*, client: AuthenticatedClient | Client, response: httpx.Response) -> ErrorResponse | InboxNotificationReceipt | None:
    if response.status_code == 202:
        response_202 = InboxNotificationReceipt.from_dict(response.json())



        return response_202

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


def _build_response(*, client: AuthenticatedClient | Client, response: httpx.Response) -> Response[ErrorResponse | InboxNotificationReceipt]:
    return Response(
        status_code=HTTPStatus(response.status_code),
        content=response.content,
        headers=response.headers,
        parsed=_parse_response(client=client, response=response),
    )


def sync_detailed(
    *,
    client: AuthenticatedClient,
    body: InboxNotification,

) -> Response[ErrorResponse | InboxNotificationReceipt]:
    """ Reliably receive an Inbox notification

     Authenticates the per-Subscription callback token, persistently deduplicates by (subscriptionId,
    eventId), and accepts the Trigger Run before asynchronous Session delivery.

    Args:
        body (InboxNotification):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[ErrorResponse | InboxNotificationReceipt]
     """


    kwargs = _get_kwargs(
        body=body,

    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)

def sync(
    *,
    client: AuthenticatedClient,
    body: InboxNotification,

) -> ErrorResponse | InboxNotificationReceipt | None:
    """ Reliably receive an Inbox notification

     Authenticates the per-Subscription callback token, persistently deduplicates by (subscriptionId,
    eventId), and accepts the Trigger Run before asynchronous Session delivery.

    Args:
        body (InboxNotification):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        ErrorResponse | InboxNotificationReceipt
     """


    return sync_detailed(
        client=client,
body=body,

    ).parsed

async def asyncio_detailed(
    *,
    client: AuthenticatedClient,
    body: InboxNotification,

) -> Response[ErrorResponse | InboxNotificationReceipt]:
    """ Reliably receive an Inbox notification

     Authenticates the per-Subscription callback token, persistently deduplicates by (subscriptionId,
    eventId), and accepts the Trigger Run before asynchronous Session delivery.

    Args:
        body (InboxNotification):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[ErrorResponse | InboxNotificationReceipt]
     """


    kwargs = _get_kwargs(
        body=body,

    )

    response = await client.get_async_httpx_client().request(
        **kwargs
    )

    return _build_response(client=client, response=response)

async def asyncio(
    *,
    client: AuthenticatedClient,
    body: InboxNotification,

) -> ErrorResponse | InboxNotificationReceipt | None:
    """ Reliably receive an Inbox notification

     Authenticates the per-Subscription callback token, persistently deduplicates by (subscriptionId,
    eventId), and accepts the Trigger Run before asynchronous Session delivery.

    Args:
        body (InboxNotification):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        ErrorResponse | InboxNotificationReceipt
     """


    return (await asyncio_detailed(
        client=client,
body=body,

    )).parsed
