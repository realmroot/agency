from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from ..models.trigger_schedule_type import TriggerScheduleType






T = TypeVar("T", bound="TriggerSchedule")



@_attrs_define
class TriggerSchedule:
    """
        Attributes:
            type_ (TriggerScheduleType):
            interval_seconds (int):  Example: 86400.
            window_seconds (int):
     """

    type_: TriggerScheduleType
    interval_seconds: int
    window_seconds: int
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)





    def to_dict(self) -> dict[str, Any]:
        type_ = self.type_.value

        interval_seconds = self.interval_seconds

        window_seconds = self.window_seconds


        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({
            "type": type_,
            "intervalSeconds": interval_seconds,
            "windowSeconds": window_seconds,
        })

        return field_dict



    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        type_ = TriggerScheduleType(d.pop("type"))




        interval_seconds = d.pop("intervalSeconds")

        window_seconds = d.pop("windowSeconds")

        trigger_schedule = cls(
            type_=type_,
            interval_seconds=interval_seconds,
            window_seconds=window_seconds,
        )


        trigger_schedule.additional_properties = d
        return trigger_schedule

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
