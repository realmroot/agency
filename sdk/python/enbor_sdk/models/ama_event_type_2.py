from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from ..models.ama_event_type_2_type import AmaEventType2Type
from typing import cast

if TYPE_CHECKING:
  from ..models.turn_payload import TurnPayload





T = TypeVar("T", bound="AmaEventType2")



@_attrs_define
class AmaEventType2:
    """
        Attributes:
            type_ (AmaEventType2Type):
            payload (TurnPayload):
     """

    type_: AmaEventType2Type
    payload: TurnPayload





    def to_dict(self) -> dict[str, Any]:
        from ..models.turn_payload import TurnPayload
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
        from ..models.turn_payload import TurnPayload
        d = dict(src_dict)
        type_ = AmaEventType2Type(d.pop("type"))




        payload = TurnPayload.from_dict(d.pop("payload"))




        ama_event_type_2 = cls(
            type_=type_,
            payload=payload,
        )

        return ama_event_type_2
