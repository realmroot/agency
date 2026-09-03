from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from ..models.enbor_event_type_7_type import EnborEventType7Type
from typing import cast

if TYPE_CHECKING:
  from ..models.usage_recorded_payload import UsageRecordedPayload





T = TypeVar("T", bound="EnborEventType7")



@_attrs_define
class EnborEventType7:
    """
        Attributes:
            type_ (EnborEventType7Type):
            payload (UsageRecordedPayload):
     """

    type_: EnborEventType7Type
    payload: UsageRecordedPayload





    def to_dict(self) -> dict[str, Any]:
        from ..models.usage_recorded_payload import UsageRecordedPayload
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
        from ..models.usage_recorded_payload import UsageRecordedPayload
        d = dict(src_dict)
        type_ = EnborEventType7Type(d.pop("type"))




        payload = UsageRecordedPayload.from_dict(d.pop("payload"))




        enbor_event_type_7 = cls(
            type_=type_,
            payload=payload,
        )

        return enbor_event_type_7
