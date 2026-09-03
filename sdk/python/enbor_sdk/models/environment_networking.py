from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from ..models.environment_networking_type import EnvironmentNetworkingType
from ..types import UNSET, Unset
from typing import cast






T = TypeVar("T", bound="EnvironmentNetworking")



@_attrs_define
class EnvironmentNetworking:
    """
        Example:
            {'type': 'limited', 'allowMcpServers': False, 'allowPackageManagers': True, 'allowedHosts': ['api.example.com']}

        Attributes:
            type_ (EnvironmentNetworkingType):
            allow_mcp_servers (bool):
            allow_package_managers (bool):
            allowed_hosts (list[str] | Unset):
     """

    type_: EnvironmentNetworkingType
    allow_mcp_servers: bool
    allow_package_managers: bool
    allowed_hosts: list[str] | Unset = UNSET





    def to_dict(self) -> dict[str, Any]:
        type_ = self.type_.value

        allow_mcp_servers = self.allow_mcp_servers

        allow_package_managers = self.allow_package_managers

        allowed_hosts: list[str] | Unset = UNSET
        if not isinstance(self.allowed_hosts, Unset):
            allowed_hosts = self.allowed_hosts




        field_dict: dict[str, Any] = {}

        field_dict.update({
            "type": type_,
            "allowMcpServers": allow_mcp_servers,
            "allowPackageManagers": allow_package_managers,
        })
        if allowed_hosts is not UNSET:
            field_dict["allowedHosts"] = allowed_hosts

        return field_dict



    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        type_ = EnvironmentNetworkingType(d.pop("type"))




        allow_mcp_servers = d.pop("allowMcpServers")

        allow_package_managers = d.pop("allowPackageManagers")

        allowed_hosts = cast(list[str], d.pop("allowedHosts", UNSET))


        environment_networking = cls(
            type_=type_,
            allow_mcp_servers=allow_mcp_servers,
            allow_package_managers=allow_package_managers,
            allowed_hosts=allowed_hosts,
        )

        return environment_networking
