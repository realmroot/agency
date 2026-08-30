from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from ..models.environment_hosting_mode import EnvironmentHostingMode
from typing import cast






T = TypeVar("T", bound="SessionPlacementType0")



@_attrs_define
class SessionPlacementType0:
    """
        Attributes:
            hosting_mode (EnvironmentHostingMode):
            provider (None | str):  Example: workers-ai.
            model (None | str):  Example: @cf/moonshotai/kimi-k2.6.
     """

    hosting_mode: EnvironmentHostingMode
    provider: None | str
    model: None | str
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)





    def to_dict(self) -> dict[str, Any]:
        hosting_mode = self.hosting_mode.value

        provider: None | str
        provider = self.provider

        model: None | str
        model = self.model


        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({
            "hostingMode": hosting_mode,
            "provider": provider,
            "model": model,
        })

        return field_dict



    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        hosting_mode = EnvironmentHostingMode(d.pop("hostingMode"))




        def _parse_provider(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        provider = _parse_provider(d.pop("provider"))


        def _parse_model(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        model = _parse_model(d.pop("model"))


        session_placement_type_0 = cls(
            hosting_mode=hosting_mode,
            provider=provider,
            model=model,
        )


        session_placement_type_0.additional_properties = d
        return session_placement_type_0

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
