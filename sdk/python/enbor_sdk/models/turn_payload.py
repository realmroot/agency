from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from ..types import UNSET, Unset
from typing import cast

if TYPE_CHECKING:
  from ..models.event_message import EventMessage





T = TypeVar("T", bound="TurnPayload")



@_attrs_define
class TurnPayload:
    """
        Attributes:
            status (str | Unset):
            reason (str | Unset):
            message (EventMessage | Unset):
     """

    status: str | Unset = UNSET
    reason: str | Unset = UNSET
    message: EventMessage | Unset = UNSET





    def to_dict(self) -> dict[str, Any]:
        from ..models.event_message import EventMessage
        status = self.status

        reason = self.reason

        message: dict[str, Any] | Unset = UNSET
        if not isinstance(self.message, Unset):
            message = self.message.to_dict()


        field_dict: dict[str, Any] = {}

        field_dict.update({
        })
        if status is not UNSET:
            field_dict["status"] = status
        if reason is not UNSET:
            field_dict["reason"] = reason
        if message is not UNSET:
            field_dict["message"] = message

        return field_dict



    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.event_message import EventMessage
        d = dict(src_dict)
        status = d.pop("status", UNSET)

        reason = d.pop("reason", UNSET)

        _message = d.pop("message", UNSET)
        message: EventMessage | Unset
        if isinstance(_message,  Unset):
            message = UNSET
        else:
            message = EventMessage.from_dict(_message)




        turn_payload = cls(
            status=status,
            reason=reason,
            message=message,
        )

        return turn_payload
