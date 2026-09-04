from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from typing import cast

if TYPE_CHECKING:
  from ..models.agent_subagent_reference import AgentSubagentReference
  from ..models.identity_descriptor_type_0 import IdentityDescriptorType0





T = TypeVar("T", bound="AgentSpec")



@_attrs_define
class AgentSpec:
    """
        Attributes:
            system_prompt (str):  Example: Answer with citations..
            provider (None | str):  Example: workers-ai.
            model (None | str):  Example: @cf/moonshotai/kimi-k2.6.
            skills (list[str]):  Example: ['enbor@code-review'].
            subagents (list[AgentSubagentReference]):  Example: [{'agentId': '0195f5d6-7c20-7000-8000-000000000005', 'name':
                'reviewer'}].
            allowed_tools (list[str]):  Example: ['read', 'bash', 'edit'].
            mcp_connectors (list[str]):  Example: ['github'].
            identity (IdentityDescriptorType0 | None):
     """

    system_prompt: str
    provider: None | str
    model: None | str
    skills: list[str]
    subagents: list[AgentSubagentReference]
    allowed_tools: list[str]
    mcp_connectors: list[str]
    identity: IdentityDescriptorType0 | None
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)





    def to_dict(self) -> dict[str, Any]:
        from ..models.agent_subagent_reference import AgentSubagentReference
        from ..models.identity_descriptor_type_0 import IdentityDescriptorType0
        system_prompt = self.system_prompt

        provider: None | str
        provider = self.provider

        model: None | str
        model = self.model

        skills = self.skills



        subagents = []
        for subagents_item_data in self.subagents:
            subagents_item = subagents_item_data.to_dict()
            subagents.append(subagents_item)



        allowed_tools = self.allowed_tools



        mcp_connectors = self.mcp_connectors



        identity: dict[str, Any] | None
        if isinstance(self.identity, IdentityDescriptorType0):
            identity = self.identity.to_dict()
        else:
            identity = self.identity


        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({
            "systemPrompt": system_prompt,
            "provider": provider,
            "model": model,
            "skills": skills,
            "subagents": subagents,
            "allowedTools": allowed_tools,
            "mcpConnectors": mcp_connectors,
            "identity": identity,
        })

        return field_dict



    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.agent_subagent_reference import AgentSubagentReference
        from ..models.identity_descriptor_type_0 import IdentityDescriptorType0
        d = dict(src_dict)
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


        skills = cast(list[str], d.pop("skills"))


        subagents = []
        _subagents = d.pop("subagents")
        for subagents_item_data in (_subagents):
            subagents_item = AgentSubagentReference.from_dict(subagents_item_data)



            subagents.append(subagents_item)


        allowed_tools = cast(list[str], d.pop("allowedTools"))


        mcp_connectors = cast(list[str], d.pop("mcpConnectors"))


        def _parse_identity(data: object) -> IdentityDescriptorType0 | None:
            if data is None:
                return data
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                componentsschemas_identity_descriptor_type_0 = IdentityDescriptorType0.from_dict(data)



                return componentsschemas_identity_descriptor_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(IdentityDescriptorType0 | None, data)

        identity = _parse_identity(d.pop("identity"))


        agent_spec = cls(
            system_prompt=system_prompt,
            provider=provider,
            model=model,
            skills=skills,
            subagents=subagents,
            allowed_tools=allowed_tools,
            mcp_connectors=mcp_connectors,
            identity=identity,
        )


        agent_spec.additional_properties = d
        return agent_spec

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
