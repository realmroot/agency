from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from ..models.resource_phase import ResourcePhase
from typing import cast






T = TypeVar("T", bound="AgentStatus")



@_attrs_define
class AgentStatus:
    """ 
        Attributes:
            phase (ResourcePhase):
            current_version_id (None | str):  Example: agentver_abc123.
            version (int):  Example: 1.
     """

    phase: ResourcePhase
    current_version_id: None | str
    version: int
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)





    def to_dict(self) -> dict[str, Any]:
        phase = self.phase.value

        current_version_id: None | str
        current_version_id = self.current_version_id

        version = self.version


        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({
            "phase": phase,
            "currentVersionId": current_version_id,
            "version": version,
        })

        return field_dict



    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        phase = ResourcePhase(d.pop("phase"))




        def _parse_current_version_id(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        current_version_id = _parse_current_version_id(d.pop("currentVersionId"))


        version = d.pop("version")

        agent_status = cls(
            phase=phase,
            current_version_id=current_version_id,
            version=version,
        )


        agent_status.additional_properties = d
        return agent_status

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
