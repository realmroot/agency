from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from ..models.environment_scope import EnvironmentScope
from ..models.environment_type import EnvironmentType
from typing import cast
import datetime

if TYPE_CHECKING:
  from ..models.environment_networking import EnvironmentNetworking
  from ..models.environment_packages import EnvironmentPackages
  from ..models.session_environment_json_object import SessionEnvironmentJsonObject





T = TypeVar("T", bound="SessionEnvironmentSnapshotType0")



@_attrs_define
class SessionEnvironmentSnapshotType0:
    """
        Attributes:
            id (str):
            environment_id (str):
            project_id (str):
            version (int):
            scope (EnvironmentScope):  Example: organization.
            type_ (EnvironmentType):  Example: cloud.
            networking (EnvironmentNetworking):  Example: {'type': 'limited', 'allowMcpServers': False,
                'allowPackageManagers': True, 'allowedHosts': ['api.example.com']}.
            packages (EnvironmentPackages):
            variables (SessionEnvironmentJsonObject):
            created_at (datetime.datetime):
     """

    id: str
    environment_id: str
    project_id: str
    version: int
    scope: EnvironmentScope
    type_: EnvironmentType
    networking: EnvironmentNetworking
    packages: EnvironmentPackages
    variables: SessionEnvironmentJsonObject
    created_at: datetime.datetime
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)





    def to_dict(self) -> dict[str, Any]:
        from ..models.environment_networking import EnvironmentNetworking
        from ..models.environment_packages import EnvironmentPackages
        from ..models.session_environment_json_object import SessionEnvironmentJsonObject
        id = self.id

        environment_id = self.environment_id

        project_id = self.project_id

        version = self.version

        scope = self.scope.value

        type_ = self.type_.value

        networking = self.networking.to_dict()

        packages = self.packages.to_dict()

        variables = self.variables.to_dict()

        created_at = self.created_at.isoformat()


        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({
            "id": id,
            "environmentId": environment_id,
            "projectId": project_id,
            "version": version,
            "scope": scope,
            "type": type_,
            "networking": networking,
            "packages": packages,
            "variables": variables,
            "createdAt": created_at,
        })

        return field_dict



    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.environment_networking import EnvironmentNetworking
        from ..models.environment_packages import EnvironmentPackages
        from ..models.session_environment_json_object import SessionEnvironmentJsonObject
        d = dict(src_dict)
        id = d.pop("id")

        environment_id = d.pop("environmentId")

        project_id = d.pop("projectId")

        version = d.pop("version")

        scope = EnvironmentScope(d.pop("scope"))




        type_ = EnvironmentType(d.pop("type"))




        networking = EnvironmentNetworking.from_dict(d.pop("networking"))




        packages = EnvironmentPackages.from_dict(d.pop("packages"))




        variables = SessionEnvironmentJsonObject.from_dict(d.pop("variables"))




        created_at = datetime.datetime.fromisoformat(d.pop("createdAt"))




        session_environment_snapshot_type_0 = cls(
            id=id,
            environment_id=environment_id,
            project_id=project_id,
            version=version,
            scope=scope,
            type_=type_,
            networking=networking,
            packages=packages,
            variables=variables,
            created_at=created_at,
        )


        session_environment_snapshot_type_0.additional_properties = d
        return session_environment_snapshot_type_0

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
