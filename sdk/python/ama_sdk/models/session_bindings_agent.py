from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from typing import cast

if TYPE_CHECKING:
  from ..models.session_agent_snapshot import SessionAgentSnapshot





T = TypeVar("T", bound="SessionBindingsAgent")



@_attrs_define
class SessionBindingsAgent:
    """
        Attributes:
            version_id (str):  Example: 0195f5d6-7c20-7000-8000-000000000003.
            snapshot (SessionAgentSnapshot):
     """

    version_id: str
    snapshot: SessionAgentSnapshot
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)





    def to_dict(self) -> dict[str, Any]:
        from ..models.session_agent_snapshot import SessionAgentSnapshot
        version_id = self.version_id

        snapshot = self.snapshot.to_dict()


        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({
            "versionId": version_id,
            "snapshot": snapshot,
        })

        return field_dict



    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.session_agent_snapshot import SessionAgentSnapshot
        d = dict(src_dict)
        version_id = d.pop("versionId")

        snapshot = SessionAgentSnapshot.from_dict(d.pop("snapshot"))




        session_bindings_agent = cls(
            version_id=version_id,
            snapshot=snapshot,
        )


        session_bindings_agent.additional_properties = d
        return session_bindings_agent

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
