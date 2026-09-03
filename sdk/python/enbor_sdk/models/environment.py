from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from typing import cast

if TYPE_CHECKING:
  from ..models.environment_spec import EnvironmentSpec
  from ..models.environment_status import EnvironmentStatus
  from ..models.resource_metadata import ResourceMetadata





T = TypeVar("T", bound="Environment")



@_attrs_define
class Environment:
    """
        Attributes:
            metadata (ResourceMetadata):
            spec (EnvironmentSpec):
            status (EnvironmentStatus):
     """

    metadata: ResourceMetadata
    spec: EnvironmentSpec
    status: EnvironmentStatus
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)





    def to_dict(self) -> dict[str, Any]:
        from ..models.environment_spec import EnvironmentSpec
        from ..models.environment_status import EnvironmentStatus
        from ..models.resource_metadata import ResourceMetadata
        metadata = self.metadata.to_dict()

        spec = self.spec.to_dict()

        status = self.status.to_dict()


        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({
            "metadata": metadata,
            "spec": spec,
            "status": status,
        })

        return field_dict



    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.environment_spec import EnvironmentSpec
        from ..models.environment_status import EnvironmentStatus
        from ..models.resource_metadata import ResourceMetadata
        d = dict(src_dict)
        metadata = ResourceMetadata.from_dict(d.pop("metadata"))




        spec = EnvironmentSpec.from_dict(d.pop("spec"))




        status = EnvironmentStatus.from_dict(d.pop("status"))




        environment = cls(
            metadata=metadata,
            spec=spec,
            status=status,
        )


        environment.additional_properties = d
        return environment

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
