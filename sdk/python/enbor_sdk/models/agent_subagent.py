from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from typing import cast






T = TypeVar("T", bound="AgentSubagent")



@_attrs_define
class AgentSubagent:
    """
        Attributes:
            name (str):  Example: reviewer.
            description (str):  Example: Reviews proposed changes for correctness and risk..
            system_prompt (str):  Example: Review the proposed changes and report risks..
            model (None | str):  Example: @cf/moonshotai/kimi-k2.6.
            allowed_tools (list[str]):  Example: ['read', 'grep'].
            skills (list[str]):  Example: ['enbor@code-review'].
            mcp_connectors (list[str]):  Example: ['github'].
     """

    name: str
    description: str
    system_prompt: str
    model: None | str
    allowed_tools: list[str]
    skills: list[str]
    mcp_connectors: list[str]





    def to_dict(self) -> dict[str, Any]:
        name = self.name

        description = self.description

        system_prompt = self.system_prompt

        model: None | str
        model = self.model

        allowed_tools = self.allowed_tools



        skills = self.skills



        mcp_connectors = self.mcp_connectors




        field_dict: dict[str, Any] = {}

        field_dict.update({
            "name": name,
            "description": description,
            "systemPrompt": system_prompt,
            "model": model,
            "allowedTools": allowed_tools,
            "skills": skills,
            "mcpConnectors": mcp_connectors,
        })

        return field_dict



    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        name = d.pop("name")

        description = d.pop("description")

        system_prompt = d.pop("systemPrompt")

        def _parse_model(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        model = _parse_model(d.pop("model"))


        allowed_tools = cast(list[str], d.pop("allowedTools"))


        skills = cast(list[str], d.pop("skills"))


        mcp_connectors = cast(list[str], d.pop("mcpConnectors"))


        agent_subagent = cls(
            name=name,
            description=description,
            system_prompt=system_prompt,
            model=model,
            allowed_tools=allowed_tools,
            skills=skills,
            mcp_connectors=mcp_connectors,
        )

        return agent_subagent
