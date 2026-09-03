from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from ..types import UNSET, Unset
from typing import cast






T = TypeVar("T", bound="AgentSubagentInput")



@_attrs_define
class AgentSubagentInput:
    """
        Attributes:
            name (str):  Example: reviewer.
            description (str):  Example: Reviews proposed changes for correctness and risk..
            system_prompt (str):  Example: Review the proposed changes and report risks..
            model (None | str | Unset):  Example: @cf/moonshotai/kimi-k2.6.
            allowed_tools (list[str] | Unset):  Example: ['read', 'grep'].
            skills (list[str] | Unset):  Example: ['enbor@code-review'].
            mcp_connectors (list[str] | Unset):  Example: ['github'].
     """

    name: str
    description: str
    system_prompt: str
    model: None | str | Unset = UNSET
    allowed_tools: list[str] | Unset = UNSET
    skills: list[str] | Unset = UNSET
    mcp_connectors: list[str] | Unset = UNSET





    def to_dict(self) -> dict[str, Any]:
        name = self.name

        description = self.description

        system_prompt = self.system_prompt

        model: None | str | Unset
        if isinstance(self.model, Unset):
            model = UNSET
        else:
            model = self.model

        allowed_tools: list[str] | Unset = UNSET
        if not isinstance(self.allowed_tools, Unset):
            allowed_tools = self.allowed_tools



        skills: list[str] | Unset = UNSET
        if not isinstance(self.skills, Unset):
            skills = self.skills



        mcp_connectors: list[str] | Unset = UNSET
        if not isinstance(self.mcp_connectors, Unset):
            mcp_connectors = self.mcp_connectors




        field_dict: dict[str, Any] = {}

        field_dict.update({
            "name": name,
            "description": description,
            "systemPrompt": system_prompt,
        })
        if model is not UNSET:
            field_dict["model"] = model
        if allowed_tools is not UNSET:
            field_dict["allowedTools"] = allowed_tools
        if skills is not UNSET:
            field_dict["skills"] = skills
        if mcp_connectors is not UNSET:
            field_dict["mcpConnectors"] = mcp_connectors

        return field_dict



    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        name = d.pop("name")

        description = d.pop("description")

        system_prompt = d.pop("systemPrompt")

        def _parse_model(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        model = _parse_model(d.pop("model", UNSET))


        allowed_tools = cast(list[str], d.pop("allowedTools", UNSET))


        skills = cast(list[str], d.pop("skills", UNSET))


        mcp_connectors = cast(list[str], d.pop("mcpConnectors", UNSET))


        agent_subagent_input = cls(
            name=name,
            description=description,
            system_prompt=system_prompt,
            model=model,
            allowed_tools=allowed_tools,
            skills=skills,
            mcp_connectors=mcp_connectors,
        )

        return agent_subagent_input
