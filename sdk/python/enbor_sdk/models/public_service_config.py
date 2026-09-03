from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from ..models.public_service_config_name import PublicServiceConfigName






T = TypeVar("T", bound="PublicServiceConfig")



@_attrs_define
class PublicServiceConfig:
    """
        Attributes:
            name (PublicServiceConfigName):  Example: Any Managed Agents.
            origin (str):  Example: https://ama.example.com.
     """

    name: PublicServiceConfigName
    origin: str
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)





    def to_dict(self) -> dict[str, Any]:
        name = self.name.value

        origin = self.origin


        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({
            "name": name,
            "origin": origin,
        })

        return field_dict



    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        name = PublicServiceConfigName(d.pop("name"))




        origin = d.pop("origin")

        public_service_config = cls(
            name=name,
            origin=origin,
        )


        public_service_config.additional_properties = d
        return public_service_config

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
