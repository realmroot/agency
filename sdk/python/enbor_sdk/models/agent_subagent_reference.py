from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset







T = TypeVar("T", bound="AgentSubagentReference")



@_attrs_define
class AgentSubagentReference:
    """
        Attributes:
            agent_id (str): Existing Agent resource in the same project. Example: 0195f5d6-7c20-7000-8000-000000000005.
            name (str): Stable runtime alias used to address the referenced Agent as a sub-agent. Example: reviewer.
     """

    agent_id: str
    name: str





    def to_dict(self) -> dict[str, Any]:
        agent_id = self.agent_id

        name = self.name


        field_dict: dict[str, Any] = {}

        field_dict.update({
            "agentId": agent_id,
            "name": name,
        })

        return field_dict



    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        agent_id = d.pop("agentId")

        name = d.pop("name")

        agent_subagent_reference = cls(
            agent_id=agent_id,
            name=name,
        )

        return agent_subagent_reference
