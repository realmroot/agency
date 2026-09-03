from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from ..models.inbox_notification_type import InboxNotificationType
from ..types import UNSET, Unset
from typing import cast
import datetime






T = TypeVar("T", bound="InboxNotification")



@_attrs_define
class InboxNotification:
    """
        Attributes:
            event_id (str):
            type_ (InboxNotificationType):
            subscription_id (str):
            agent_id (str):
            message_id (str):
            occurred_at (datetime.datetime):
            routing_key (str | Unset):
     """

    event_id: str
    type_: InboxNotificationType
    subscription_id: str
    agent_id: str
    message_id: str
    occurred_at: datetime.datetime
    routing_key: str | Unset = UNSET





    def to_dict(self) -> dict[str, Any]:
        event_id = self.event_id

        type_ = self.type_.value

        subscription_id = self.subscription_id

        agent_id = self.agent_id

        message_id = self.message_id

        occurred_at = self.occurred_at.isoformat()

        routing_key = self.routing_key


        field_dict: dict[str, Any] = {}

        field_dict.update({
            "eventId": event_id,
            "type": type_,
            "subscriptionId": subscription_id,
            "agentId": agent_id,
            "messageId": message_id,
            "occurredAt": occurred_at,
        })
        if routing_key is not UNSET:
            field_dict["routingKey"] = routing_key

        return field_dict



    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        event_id = d.pop("eventId")

        type_ = InboxNotificationType(d.pop("type"))




        subscription_id = d.pop("subscriptionId")

        agent_id = d.pop("agentId")

        message_id = d.pop("messageId")

        occurred_at = datetime.datetime.fromisoformat(d.pop("occurredAt"))




        routing_key = d.pop("routingKey", UNSET)

        inbox_notification = cls(
            event_id=event_id,
            type_=type_,
            subscription_id=subscription_id,
            agent_id=agent_id,
            message_id=message_id,
            occurred_at=occurred_at,
            routing_key=routing_key,
        )

        return inbox_notification
