from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from ..models.trigger_source_type_0_type import TriggerSourceType0Type
from typing import cast

if TYPE_CHECKING:
  from ..models.trigger_schedule import TriggerSchedule





T = TypeVar("T", bound="TriggerSourceType0")



@_attrs_define
class TriggerSourceType0:
    """
        Attributes:
            type_ (TriggerSourceType0Type):
            schedule (TriggerSchedule):
     """

    type_: TriggerSourceType0Type
    schedule: TriggerSchedule
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)





    def to_dict(self) -> dict[str, Any]:
        from ..models.trigger_schedule import TriggerSchedule
        type_ = self.type_.value

        schedule = self.schedule.to_dict()


        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({
            "type": type_,
            "schedule": schedule,
        })

        return field_dict



    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.trigger_schedule import TriggerSchedule
        d = dict(src_dict)
        type_ = TriggerSourceType0Type(d.pop("type"))




        schedule = TriggerSchedule.from_dict(d.pop("schedule"))




        trigger_source_type_0 = cls(
            type_=type_,
            schedule=schedule,
        )


        trigger_source_type_0.additional_properties = d
        return trigger_source_type_0

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
