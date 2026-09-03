from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from ..models.ama_event_type_4_type import AmaEventType4Type
from typing import cast

if TYPE_CHECKING:
  from ..models.message_event_payload import MessageEventPayload





T = TypeVar("T", bound="AmaEventType4")



@_attrs_define
class AmaEventType4:
    """
        Attributes:
            type_ (AmaEventType4Type):
            payload (MessageEventPayload):
     """

    type_: AmaEventType4Type
    payload: MessageEventPayload





    def to_dict(self) -> dict[str, Any]:
        from ..models.message_event_payload import MessageEventPayload
        type_ = self.type_.value

        payload = self.payload.to_dict()


        field_dict: dict[str, Any] = {}

        field_dict.update({
            "type": type_,
            "payload": payload,
        })

        return field_dict



    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.message_event_payload import MessageEventPayload
        d = dict(src_dict)
        type_ = AmaEventType4Type(d.pop("type"))




        payload = MessageEventPayload.from_dict(d.pop("payload"))




        ama_event_type_4 = cls(
            type_=type_,
            payload=payload,
        )

        return ama_event_type_4
