from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from typing import cast

if TYPE_CHECKING:
  from ..models.runtime_usage_window import RuntimeUsageWindow





T = TypeVar("T", bound="RuntimeUsage")



@_attrs_define
class RuntimeUsage:
    """
        Attributes:
            runtime (str):  Example: claude-code.
            windows (list[RuntimeUsageWindow]):
     """

    runtime: str
    windows: list[RuntimeUsageWindow]
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)





    def to_dict(self) -> dict[str, Any]:
        from ..models.runtime_usage_window import RuntimeUsageWindow
        runtime = self.runtime

        windows = []
        for windows_item_data in self.windows:
            windows_item = windows_item_data.to_dict()
            windows.append(windows_item)




        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({
            "runtime": runtime,
            "windows": windows,
        })

        return field_dict



    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.runtime_usage_window import RuntimeUsageWindow
        d = dict(src_dict)
        runtime = d.pop("runtime")

        windows = []
        _windows = d.pop("windows")
        for windows_item_data in (_windows):
            windows_item = RuntimeUsageWindow.from_dict(windows_item_data)



            windows.append(windows_item)


        runtime_usage = cls(
            runtime=runtime,
            windows=windows,
        )


        runtime_usage.additional_properties = d
        return runtime_usage

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
