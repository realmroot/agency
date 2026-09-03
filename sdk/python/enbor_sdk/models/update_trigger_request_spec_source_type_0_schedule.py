from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from ..models.update_trigger_request_spec_source_type_0_schedule_type import UpdateTriggerRequestSpecSourceType0ScheduleType
from ..types import UNSET, Unset






T = TypeVar("T", bound="UpdateTriggerRequestSpecSourceType0Schedule")



@_attrs_define
class UpdateTriggerRequestSpecSourceType0Schedule:
    """
        Attributes:
            interval_seconds (int):  Example: 86400.
            type_ (UpdateTriggerRequestSpecSourceType0ScheduleType | Unset):  Example: interval.
            window_seconds (int | Unset):
     """

    interval_seconds: int
    type_: UpdateTriggerRequestSpecSourceType0ScheduleType | Unset = UNSET
    window_seconds: int | Unset = UNSET





    def to_dict(self) -> dict[str, Any]:
        interval_seconds = self.interval_seconds

        type_: str | Unset = UNSET
        if not isinstance(self.type_, Unset):
            type_ = self.type_.value


        window_seconds = self.window_seconds


        field_dict: dict[str, Any] = {}

        field_dict.update({
            "intervalSeconds": interval_seconds,
        })
        if type_ is not UNSET:
            field_dict["type"] = type_
        if window_seconds is not UNSET:
            field_dict["windowSeconds"] = window_seconds

        return field_dict



    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        interval_seconds = d.pop("intervalSeconds")

        _type_ = d.pop("type", UNSET)
        type_: UpdateTriggerRequestSpecSourceType0ScheduleType | Unset
        if isinstance(_type_,  Unset):
            type_ = UNSET
        else:
            type_ = UpdateTriggerRequestSpecSourceType0ScheduleType(_type_)




        window_seconds = d.pop("windowSeconds", UNSET)

        update_trigger_request_spec_source_type_0_schedule = cls(
            interval_seconds=interval_seconds,
            type_=type_,
            window_seconds=window_seconds,
        )

        return update_trigger_request_spec_source_type_0_schedule
