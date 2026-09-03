from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset







T = TypeVar("T", bound="RuntimeUsageWindow")



@_attrs_define
class RuntimeUsageWindow:
    """
        Attributes:
            label (str):  Example: 5-Hour.
            utilization (float):  Example: 23.
            resets_at (str):  Example: 2026-06-09T08:30:00.000Z.
     """

    label: str
    utilization: float
    resets_at: str
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)





    def to_dict(self) -> dict[str, Any]:
        label = self.label

        utilization = self.utilization

        resets_at = self.resets_at


        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({
            "label": label,
            "utilization": utilization,
            "resetsAt": resets_at,
        })

        return field_dict



    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        label = d.pop("label")

        utilization = d.pop("utilization")

        resets_at = d.pop("resetsAt")

        runtime_usage_window = cls(
            label=label,
            utilization=utilization,
            resets_at=resets_at,
        )


        runtime_usage_window.additional_properties = d
        return runtime_usage_window

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
