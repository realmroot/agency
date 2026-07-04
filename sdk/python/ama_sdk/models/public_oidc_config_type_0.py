from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset







T = TypeVar("T", bound="PublicOidcConfigType0")



@_attrs_define
class PublicOidcConfigType0:
    """ 
        Attributes:
            issuer (str):  Example: https://id.example.com/api/auth.
            client_id (str):  Example: client_abc123.
            scope (str):  Example: openid email profile.
            resource (str):  Example: https://ama.example.com.
     """

    issuer: str
    client_id: str
    scope: str
    resource: str
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)





    def to_dict(self) -> dict[str, Any]:
        issuer = self.issuer

        client_id = self.client_id

        scope = self.scope

        resource = self.resource


        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({
            "issuer": issuer,
            "clientId": client_id,
            "scope": scope,
            "resource": resource,
        })

        return field_dict



    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        issuer = d.pop("issuer")

        client_id = d.pop("clientId")

        scope = d.pop("scope")

        resource = d.pop("resource")

        public_oidc_config_type_0 = cls(
            issuer=issuer,
            client_id=client_id,
            scope=scope,
            resource=resource,
        )


        public_oidc_config_type_0.additional_properties = d
        return public_oidc_config_type_0

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
