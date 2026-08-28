from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from ..types import UNSET, Unset
from typing import cast

if TYPE_CHECKING:
  from ..models.public_oidc_client_config import PublicOidcClientConfig





T = TypeVar("T", bound="PublicOidcConfigType0")



@_attrs_define
class PublicOidcConfigType0:
    """ 
        Attributes:
            issuer (str):  Example: https://id.example.com/api/auth.
            resource (str):  Example: https://ama.example.com.
            runner (PublicOidcClientConfig | Unset):
     """

    issuer: str
    resource: str
    runner: PublicOidcClientConfig | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)





    def to_dict(self) -> dict[str, Any]:
        from ..models.public_oidc_client_config import PublicOidcClientConfig
        issuer = self.issuer

        resource = self.resource

        runner: dict[str, Any] | Unset = UNSET
        if not isinstance(self.runner, Unset):
            runner = self.runner.to_dict()


        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({
            "issuer": issuer,
            "resource": resource,
        })
        if runner is not UNSET:
            field_dict["runner"] = runner

        return field_dict



    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.public_oidc_client_config import PublicOidcClientConfig
        d = dict(src_dict)
        issuer = d.pop("issuer")

        resource = d.pop("resource")

        _runner = d.pop("runner", UNSET)
        runner: PublicOidcClientConfig | Unset
        if isinstance(_runner,  Unset):
            runner = UNSET
        else:
            runner = PublicOidcClientConfig.from_dict(_runner)




        public_oidc_config_type_0 = cls(
            issuer=issuer,
            resource=resource,
            runner=runner,
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
