from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from typing import cast

if TYPE_CHECKING:
  from ..models.auth_method import AuthMethod





T = TypeVar("T", bound="AuthConfig")



@_attrs_define
class AuthConfig:
    """
        Attributes:
            methods (list[AuthMethod]):
     """

    methods: list[AuthMethod]
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)





    def to_dict(self) -> dict[str, Any]:
        from ..models.auth_method import AuthMethod
        methods = []
        for methods_item_data in self.methods:
            methods_item = methods_item_data.to_dict()
            methods.append(methods_item)




        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({
            "methods": methods,
        })

        return field_dict



    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.auth_method import AuthMethod
        d = dict(src_dict)
        methods = []
        _methods = d.pop("methods")
        for methods_item_data in (_methods):
            methods_item = AuthMethod.from_dict(methods_item_data)



            methods.append(methods_item)


        auth_config = cls(
            methods=methods,
        )


        auth_config.additional_properties = d
        return auth_config

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
