from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from ..models.environment_scope import EnvironmentScope
from ..models.environment_type import EnvironmentType
from ..types import UNSET, Unset
from typing import cast

if TYPE_CHECKING:
  from ..models.environment_networking import EnvironmentNetworking
  from ..models.environment_packages import EnvironmentPackages
  from ..models.update_environment_request_spec_variables import UpdateEnvironmentRequestSpecVariables





T = TypeVar("T", bound="UpdateEnvironmentRequestSpec")



@_attrs_define
class UpdateEnvironmentRequestSpec:
    """
        Attributes:
            scope (EnvironmentScope | Unset):  Example: organization.
            type_ (EnvironmentType | Unset):  Example: cloud.
            networking (EnvironmentNetworking | Unset):  Example: {'type': 'limited', 'allowMcpServers': False,
                'allowPackageManagers': True, 'allowedHosts': ['api.example.com']}.
            packages (EnvironmentPackages | Unset):
            variables (UpdateEnvironmentRequestSpecVariables | Unset):  Example: {'NODE_ENV': {'required': True}}.
     """

    scope: EnvironmentScope | Unset = UNSET
    type_: EnvironmentType | Unset = UNSET
    networking: EnvironmentNetworking | Unset = UNSET
    packages: EnvironmentPackages | Unset = UNSET
    variables: UpdateEnvironmentRequestSpecVariables | Unset = UNSET





    def to_dict(self) -> dict[str, Any]:
        from ..models.environment_networking import EnvironmentNetworking
        from ..models.environment_packages import EnvironmentPackages
        from ..models.update_environment_request_spec_variables import UpdateEnvironmentRequestSpecVariables
        scope: str | Unset = UNSET
        if not isinstance(self.scope, Unset):
            scope = self.scope.value


        type_: str | Unset = UNSET
        if not isinstance(self.type_, Unset):
            type_ = self.type_.value


        networking: dict[str, Any] | Unset = UNSET
        if not isinstance(self.networking, Unset):
            networking = self.networking.to_dict()

        packages: dict[str, Any] | Unset = UNSET
        if not isinstance(self.packages, Unset):
            packages = self.packages.to_dict()

        variables: dict[str, Any] | Unset = UNSET
        if not isinstance(self.variables, Unset):
            variables = self.variables.to_dict()


        field_dict: dict[str, Any] = {}

        field_dict.update({
        })
        if scope is not UNSET:
            field_dict["scope"] = scope
        if type_ is not UNSET:
            field_dict["type"] = type_
        if networking is not UNSET:
            field_dict["networking"] = networking
        if packages is not UNSET:
            field_dict["packages"] = packages
        if variables is not UNSET:
            field_dict["variables"] = variables

        return field_dict



    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.environment_networking import EnvironmentNetworking
        from ..models.environment_packages import EnvironmentPackages
        from ..models.update_environment_request_spec_variables import UpdateEnvironmentRequestSpecVariables
        d = dict(src_dict)
        _scope = d.pop("scope", UNSET)
        scope: EnvironmentScope | Unset
        if isinstance(_scope,  Unset):
            scope = UNSET
        else:
            scope = EnvironmentScope(_scope)




        _type_ = d.pop("type", UNSET)
        type_: EnvironmentType | Unset
        if isinstance(_type_,  Unset):
            type_ = UNSET
        else:
            type_ = EnvironmentType(_type_)




        _networking = d.pop("networking", UNSET)
        networking: EnvironmentNetworking | Unset
        if isinstance(_networking,  Unset):
            networking = UNSET
        else:
            networking = EnvironmentNetworking.from_dict(_networking)




        _packages = d.pop("packages", UNSET)
        packages: EnvironmentPackages | Unset
        if isinstance(_packages,  Unset):
            packages = UNSET
        else:
            packages = EnvironmentPackages.from_dict(_packages)




        _variables = d.pop("variables", UNSET)
        variables: UpdateEnvironmentRequestSpecVariables | Unset
        if isinstance(_variables,  Unset):
            variables = UNSET
        else:
            variables = UpdateEnvironmentRequestSpecVariables.from_dict(_variables)




        update_environment_request_spec = cls(
            scope=scope,
            type_=type_,
            networking=networking,
            packages=packages,
            variables=variables,
        )

        return update_environment_request_spec
