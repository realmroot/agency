from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from ..models.inbox_notification_receipt_state import InboxNotificationReceiptState






T = TypeVar("T", bound="InboxNotificationReceipt")



@_attrs_define
class InboxNotificationReceipt:
    """
        Attributes:
            event_id (str):
            subscription_id (str):
            trigger_run_id (str):
            state (InboxNotificationReceiptState):
     """

    event_id: str
    subscription_id: str
    trigger_run_id: str
    state: InboxNotificationReceiptState
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)





    def to_dict(self) -> dict[str, Any]:
        event_id = self.event_id

        subscription_id = self.subscription_id

        trigger_run_id = self.trigger_run_id

        state = self.state.value


        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({
            "eventId": event_id,
            "subscriptionId": subscription_id,
            "triggerRunId": trigger_run_id,
            "state": state,
        })

        return field_dict



    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        event_id = d.pop("eventId")

        subscription_id = d.pop("subscriptionId")

        trigger_run_id = d.pop("triggerRunId")

        state = InboxNotificationReceiptState(d.pop("state"))




        inbox_notification_receipt = cls(
            event_id=event_id,
            subscription_id=subscription_id,
            trigger_run_id=trigger_run_id,
            state=state,
        )


        inbox_notification_receipt.additional_properties = d
        return inbox_notification_receipt

    @property
    def additional_keys(self) -> list[str]:
        return list(self.additional_properties.keys())

    def __getitem__(self, key: str) -> Any:
        return self.additional_properties[key]

    def __setitem__(self, key: str, value: Any) -> None:
        self.additional_properties[key] = value

    def __delitem__(self, key: str) -> None:
        del self.additional_properties[key]

    def __contains__(self, key: str) -> bool:
        return key in self.additional_properties
