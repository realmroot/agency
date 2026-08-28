from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from ..types import UNSET, Unset
from typing import cast

if TYPE_CHECKING:
  from ..models.agent_subagent_input import AgentSubagentInput





T = TypeVar("T", bound="UpdateAgentRequestSpec")



@_attrs_define
class UpdateAgentRequestSpec:
    """ 
        Attributes:
            system_prompt (str | Unset):  Example: Answer with citations..
            provider (None | str | Unset):  Example: workers-ai.
            model (None | str | Unset):  Example: @cf/moonshotai/kimi-k2.6.
            skills (list[str] | Unset):  Example: ['ama@code-review'].
            subagents (list[AgentSubagentInput] | Unset):  Example: [{'name': 'reviewer', 'description': 'Reviews proposed
                changes for correctness and risk.', 'systemPrompt': 'Review the proposed changes and report risks.',
                'allowedTools': ['read', 'grep']}].
            allowed_tools (list[str] | Unset):  Example: ['read', 'bash', 'edit'].
            mcp_connectors (list[str] | Unset):  Example: ['github'].
     """

    system_prompt: str | Unset = UNSET
    provider: None | str | Unset = UNSET
    model: None | str | Unset = UNSET
    skills: list[str] | Unset = UNSET
    subagents: list[AgentSubagentInput] | Unset = UNSET
    allowed_tools: list[str] | Unset = UNSET
    mcp_connectors: list[str] | Unset = UNSET





    def to_dict(self) -> dict[str, Any]:
        from ..models.agent_subagent_input import AgentSubagentInput
        system_prompt = self.system_prompt

        provider: None | str | Unset
        if isinstance(self.provider, Unset):
            provider = UNSET
        else:
            provider = self.provider

        model: None | str | Unset
        if isinstance(self.model, Unset):
            model = UNSET
        else:
            model = self.model

        skills: list[str] | Unset = UNSET
        if not isinstance(self.skills, Unset):
            skills = self.skills



        subagents: list[dict[str, Any]] | Unset = UNSET
        if not isinstance(self.subagents, Unset):
            subagents = []
            for subagents_item_data in self.subagents:
                subagents_item = subagents_item_data.to_dict()
                subagents.append(subagents_item)



        allowed_tools: list[str] | Unset = UNSET
        if not isinstance(self.allowed_tools, Unset):
            allowed_tools = self.allowed_tools



        mcp_connectors: list[str] | Unset = UNSET
        if not isinstance(self.mcp_connectors, Unset):
            mcp_connectors = self.mcp_connectors




        field_dict: dict[str, Any] = {}

        field_dict.update({
        })
        if system_prompt is not UNSET:
            field_dict["systemPrompt"] = system_prompt
        if provider is not UNSET:
            field_dict["provider"] = provider
        if model is not UNSET:
            field_dict["model"] = model
        if skills is not UNSET:
            field_dict["skills"] = skills
        if subagents is not UNSET:
            field_dict["subagents"] = subagents
        if allowed_tools is not UNSET:
            field_dict["allowedTools"] = allowed_tools
        if mcp_connectors is not UNSET:
            field_dict["mcpConnectors"] = mcp_connectors

        return field_dict



    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.agent_subagent_input import AgentSubagentInput
        d = dict(src_dict)
        system_prompt = d.pop("systemPrompt", UNSET)

        def _parse_provider(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        provider = _parse_provider(d.pop("provider", UNSET))


        def _parse_model(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        model = _parse_model(d.pop("model", UNSET))


        skills = cast(list[str], d.pop("skills", UNSET))


        _subagents = d.pop("subagents", UNSET)
        subagents: list[AgentSubagentInput] | Unset = UNSET
        if _subagents is not UNSET:
            subagents = []
            for subagents_item_data in _subagents:
                subagents_item = AgentSubagentInput.from_dict(subagents_item_data)



                subagents.append(subagents_item)


        allowed_tools = cast(list[str], d.pop("allowedTools", UNSET))


        mcp_connectors = cast(list[str], d.pop("mcpConnectors", UNSET))


        update_agent_request_spec = cls(
            system_prompt=system_prompt,
            provider=provider,
            model=model,
            skills=skills,
            subagents=subagents,
            allowed_tools=allowed_tools,
            mcp_connectors=mcp_connectors,
        )

        return update_agent_request_spec

