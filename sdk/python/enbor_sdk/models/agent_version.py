from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from typing import cast

if TYPE_CHECKING:
  from ..models.agent_spec import AgentSpec
  from ..models.agent_version_status import AgentVersionStatus
  from ..models.resource_metadata import ResourceMetadata





T = TypeVar("T", bound="AgentVersion")



@_attrs_define
class AgentVersion:
    """
        Attributes:
            metadata (ResourceMetadata):
            spec (AgentSpec):
            status (AgentVersionStatus):
     """

    metadata: ResourceMetadata
    spec: AgentSpec
    status: AgentVersionStatus
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)





    def to_dict(self) -> dict[str, Any]:
        from ..models.agent_spec import AgentSpec
        from ..models.agent_version_status import AgentVersionStatus
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
        from ..models.agent_spec import AgentSpec
        from ..models.agent_version_status import AgentVersionStatus
        from ..models.resource_metadata import ResourceMetadata
        d = dict(src_dict)
        metadata = ResourceMetadata.from_dict(d.pop("metadata"))




        spec = AgentSpec.from_dict(d.pop("spec"))




        status = AgentVersionStatus.from_dict(d.pop("status"))




        agent_version = cls(
            metadata=metadata,
            spec=spec,
            status=status,
        )


        agent_version.additional_properties = d
        return agent_version

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
