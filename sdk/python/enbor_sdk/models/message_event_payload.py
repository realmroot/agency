from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from typing import cast

if TYPE_CHECKING:
  from ..models.event_message import EventMessage





T = TypeVar("T", bound="MessageEventPayload")



@_attrs_define
class MessageEventPayload:
    """
        Attributes:
            message (EventMessage):
     """

    message: EventMessage





    def to_dict(self) -> dict[str, Any]:
        from ..models.event_message import EventMessage
        message = self.message.to_dict()


        field_dict: dict[str, Any] = {}

        field_dict.update({
            "message": message,
        })

        return field_dict



    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.event_message import EventMessage
        d = dict(src_dict)
        message = EventMessage.from_dict(d.pop("message"))




        message_event_payload = cls(
            message=message,
        )

        return message_event_payload
