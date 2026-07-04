from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from ..models.public_config_version import PublicConfigVersion
from typing import cast

if TYPE_CHECKING:
  from ..models.public_auth_config import PublicAuthConfig
  from ..models.public_service_config import PublicServiceConfig





T = TypeVar("T", bound="PublicConfig")



@_attrs_define
class PublicConfig:
    """ 
        Attributes:
            version (PublicConfigVersion):  Example: 1.
            service (PublicServiceConfig):
            auth (PublicAuthConfig):
     """

    version: PublicConfigVersion
    service: PublicServiceConfig
    auth: PublicAuthConfig
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)





    def to_dict(self) -> dict[str, Any]:
        from ..models.public_auth_config import PublicAuthConfig
        from ..models.public_service_config import PublicServiceConfig
        version = self.version.value

        service = self.service.to_dict()

        auth = self.auth.to_dict()


        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({
            "version": version,
            "service": service,
            "auth": auth,
        })

        return field_dict



    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.public_auth_config import PublicAuthConfig
        from ..models.public_service_config import PublicServiceConfig
        d = dict(src_dict)
        version = PublicConfigVersion(d.pop("version"))




        service = PublicServiceConfig.from_dict(d.pop("service"))




        auth = PublicAuthConfig.from_dict(d.pop("auth"))




        public_config = cls(
            version=version,
            service=service,
            auth=auth,
        )


        public_config.additional_properties = d
        return public_config

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
