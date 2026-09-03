from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from ..models.enbor_event_type_11_type import EnborEventType11Type
from typing import cast

if TYPE_CHECKING:
  from ..models.event_error import EventError





T = TypeVar("T", bound="EnborEventType11")



@_attrs_define
class EnborEventType11:
    """
        Attributes:
            type_ (EnborEventType11Type):
            payload (EventError):
     """

    type_: EnborEventType11Type
    payload: EventError





    def to_dict(self) -> dict[str, Any]:
        from ..models.event_error import EventError
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
        from ..models.event_error import EventError
        d = dict(src_dict)
        type_ = EnborEventType11Type(d.pop("type"))




        payload = EventError.from_dict(d.pop("payload"))




        enbor_event_type_11 = cls(
            type_=type_,
            payload=payload,
        )

        return enbor_event_type_11
