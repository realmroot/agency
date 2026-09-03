from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from typing import cast

if TYPE_CHECKING:
  from ..models.public_oidc_config_type_0 import PublicOidcConfigType0





T = TypeVar("T", bound="PublicAuthConfig")



@_attrs_define
class PublicAuthConfig:
    """
        Attributes:
            oidc (None | PublicOidcConfigType0):
     """

    oidc: None | PublicOidcConfigType0
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)





    def to_dict(self) -> dict[str, Any]:
        from ..models.public_oidc_config_type_0 import PublicOidcConfigType0
        oidc: dict[str, Any] | None
        if isinstance(self.oidc, PublicOidcConfigType0):
            oidc = self.oidc.to_dict()
        else:
            oidc = self.oidc


        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({
            "oidc": oidc,
        })

        return field_dict



    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.public_oidc_config_type_0 import PublicOidcConfigType0
        d = dict(src_dict)
        def _parse_oidc(data: object) -> None | PublicOidcConfigType0:
            if data is None:
                return data
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                componentsschemas_public_oidc_config_type_0 = PublicOidcConfigType0.from_dict(data)



                return componentsschemas_public_oidc_config_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(None | PublicOidcConfigType0, data)

        oidc = _parse_oidc(d.pop("oidc"))


        public_auth_config = cls(
            oidc=oidc,
        )


        public_auth_config.additional_properties = d
        return public_auth_config

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
