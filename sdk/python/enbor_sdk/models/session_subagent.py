from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from typing import cast






T = TypeVar("T", bound="SessionSubagent")



@_attrs_define
class SessionSubagent:
    """
        Attributes:
            agent_id (str):
            agent_version_id (str):
            version (int):
            name (str):
            description (str):
            system_prompt (str):
            provider (None | str):
            model (None | str):
            allowed_tools (list[str]):
            skills (list[str]):
            mcp_connectors (list[str]):
     """

    agent_id: str
    agent_version_id: str
    version: int
    name: str
    description: str
    system_prompt: str
    provider: None | str
    model: None | str
    allowed_tools: list[str]
    skills: list[str]
    mcp_connectors: list[str]





    def to_dict(self) -> dict[str, Any]:
        agent_id = self.agent_id

        agent_version_id = self.agent_version_id

        version = self.version

        name = self.name

        description = self.description

        system_prompt = self.system_prompt

        provider: None | str
        provider = self.provider

        model: None | str
        model = self.model

        allowed_tools = self.allowed_tools



        skills = self.skills



        mcp_connectors = self.mcp_connectors




        field_dict: dict[str, Any] = {}

        field_dict.update({
            "agentId": agent_id,
            "agentVersionId": agent_version_id,
            "version": version,
            "name": name,
            "description": description,
            "systemPrompt": system_prompt,
            "provider": provider,
            "model": model,
            "allowedTools": allowed_tools,
            "skills": skills,
            "mcpConnectors": mcp_connectors,
        })

        return field_dict



    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        agent_id = d.pop("agentId")

        agent_version_id = d.pop("agentVersionId")

        version = d.pop("version")

        name = d.pop("name")

        description = d.pop("description")

        system_prompt = d.pop("systemPrompt")

        def _parse_provider(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        provider = _parse_provider(d.pop("provider"))


        def _parse_model(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        model = _parse_model(d.pop("model"))


        allowed_tools = cast(list[str], d.pop("allowedTools"))


        skills = cast(list[str], d.pop("skills"))


        mcp_connectors = cast(list[str], d.pop("mcpConnectors"))


        session_subagent = cls(
            agent_id=agent_id,
            agent_version_id=agent_version_id,
            version=version,
            name=name,
            description=description,
            system_prompt=system_prompt,
            provider=provider,
            model=model,
            allowed_tools=allowed_tools,
            skills=skills,
            mcp_connectors=mcp_connectors,
        )

        return session_subagent
