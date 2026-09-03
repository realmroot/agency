from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from ..models.enbor_event_type_3_type import EnborEventType3Type
from typing import cast

if TYPE_CHECKING:
  from ..models.turn_payload import TurnPayload





T = TypeVar("T", bound="EnborEventType3")



@_attrs_define
class EnborEventType3:
    """
        Attributes:
            type_ (EnborEventType3Type):
            payload (TurnPayload):
     """

    type_: EnborEventType3Type
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
        type_ = EnborEventType3Type(d.pop("type"))




        payload = TurnPayload.from_dict(d.pop("payload"))




        enbor_event_type_3 = cls(
            type_=type_,
            payload=payload,
        )

        return enbor_event_type_3
