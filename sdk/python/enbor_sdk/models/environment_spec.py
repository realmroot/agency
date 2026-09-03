from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from ..models.environment_scope import EnvironmentScope
from ..models.environment_type import EnvironmentType
from typing import cast

if TYPE_CHECKING:
  from ..models.environment_networking import EnvironmentNetworking
  from ..models.environment_packages import EnvironmentPackages
  from ..models.environment_spec_variables import EnvironmentSpecVariables





T = TypeVar("T", bound="EnvironmentSpec")



@_attrs_define
class EnvironmentSpec:
    """
        Attributes:
            scope (EnvironmentScope):  Example: organization.
            type_ (EnvironmentType):  Example: cloud.
            networking (EnvironmentNetworking):  Example: {'type': 'limited', 'allowMcpServers': False,
                'allowPackageManagers': True, 'allowedHosts': ['api.example.com']}.
            packages (EnvironmentPackages):
            variables (EnvironmentSpecVariables):  Example: {'NODE_ENV': {'description': 'Runtime mode'}}.
     """

    scope: EnvironmentScope
    type_: EnvironmentType
    networking: EnvironmentNetworking
    packages: EnvironmentPackages
    variables: EnvironmentSpecVariables
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)





    def to_dict(self) -> dict[str, Any]:
        from ..models.environment_networking import EnvironmentNetworking
        from ..models.environment_packages import EnvironmentPackages
        from ..models.environment_spec_variables import EnvironmentSpecVariables
        scope = self.scope.value

        type_ = self.type_.value

        networking = self.networking.to_dict()

        packages = self.packages.to_dict()

        variables = self.variables.to_dict()


        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({
            "scope": scope,
            "type": type_,
            "networking": networking,
            "packages": packages,
            "variables": variables,
        })

        return field_dict



    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.environment_networking import EnvironmentNetworking
        from ..models.environment_packages import EnvironmentPackages
        from ..models.environment_spec_variables import EnvironmentSpecVariables
        d = dict(src_dict)
        scope = EnvironmentScope(d.pop("scope"))




        type_ = EnvironmentType(d.pop("type"))




        networking = EnvironmentNetworking.from_dict(d.pop("networking"))




        packages = EnvironmentPackages.from_dict(d.pop("packages"))




        variables = EnvironmentSpecVariables.from_dict(d.pop("variables"))




        environment_spec = cls(
            scope=scope,
            type_=type_,
            networking=networking,
            packages=packages,
            variables=variables,
        )


        environment_spec.additional_properties = d
        return environment_spec

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
