from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from ..models.auth_method_type import AuthMethodType






T = TypeVar("T", bound="AuthMethod")



@_attrs_define
class AuthMethod:
    """
        Attributes:
            type_ (AuthMethodType):  Example: oidc.
            issuer (str):  Example: https://id.example.com/api/auth.
            client_id (str):  Example: client_abc123.
     """

    type_: AuthMethodType
    issuer: str
    client_id: str
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)





    def to_dict(self) -> dict[str, Any]:
        type_ = self.type_.value

        issuer = self.issuer

        client_id = self.client_id


        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({
            "type": type_,
            "issuer": issuer,
            "clientId": client_id,
        })

        return field_dict



    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        type_ = AuthMethodType(d.pop("type"))




        issuer = d.pop("issuer")

        client_id = d.pop("clientId")

        auth_method = cls(
            type_=type_,
            issuer=issuer,
            client_id=client_id,
        )


        auth_method.additional_properties = d
        return auth_method

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
