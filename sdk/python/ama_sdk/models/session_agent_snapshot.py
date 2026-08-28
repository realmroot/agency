from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from ..models.runtime_name import RuntimeName
from typing import cast
import datetime

if TYPE_CHECKING:
  from ..models.session_realmroot_identity_type_0 import SessionRealmrootIdentityType0
  from ..models.session_subagent import SessionSubagent





T = TypeVar("T", bound="SessionAgentSnapshot")



@_attrs_define
class SessionAgentSnapshot:
    """ 
        Attributes:
            id (str):
            agent_id (str):
            project_id (str):
            version (int):
            runtime (RuntimeName):  Example: codex.
            system_prompt (str):
            provider (str):  Example: workers-ai.
            model (None | str):
            skills (list[str]):
            subagents (list[SessionSubagent]):
            allowed_tools (list[str]):
            mcp_connectors (list[str]):
            identity (None | SessionRealmrootIdentityType0):
            created_at (datetime.datetime):
     """

    id: str
    agent_id: str
    project_id: str
    version: int
    runtime: RuntimeName
    system_prompt: str
    provider: str
    model: None | str
    skills: list[str]
    subagents: list[SessionSubagent]
    allowed_tools: list[str]
    mcp_connectors: list[str]
    identity: None | SessionRealmrootIdentityType0
    created_at: datetime.datetime
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)





    def to_dict(self) -> dict[str, Any]:
        from ..models.session_realmroot_identity_type_0 import SessionRealmrootIdentityType0
        from ..models.session_subagent import SessionSubagent
        id = self.id

        agent_id = self.agent_id

        project_id = self.project_id

        version = self.version

        runtime = self.runtime.value

        system_prompt = self.system_prompt

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
        if isinstance(self.identity, SessionRealmrootIdentityType0):
            identity = self.identity.to_dict()
        else:
            identity = self.identity

        created_at = self.created_at.isoformat()


        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({
            "id": id,
            "agentId": agent_id,
            "projectId": project_id,
            "version": version,
            "runtime": runtime,
            "systemPrompt": system_prompt,
            "provider": provider,
            "model": model,
            "skills": skills,
            "subagents": subagents,
            "allowedTools": allowed_tools,
            "mcpConnectors": mcp_connectors,
            "identity": identity,
            "createdAt": created_at,
        })

        return field_dict



    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.session_realmroot_identity_type_0 import SessionRealmrootIdentityType0
        from ..models.session_subagent import SessionSubagent
        d = dict(src_dict)
        id = d.pop("id")

        agent_id = d.pop("agentId")

        project_id = d.pop("projectId")

        version = d.pop("version")

        runtime = RuntimeName(d.pop("runtime"))




        system_prompt = d.pop("systemPrompt")

        provider = d.pop("provider")

        def _parse_model(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        model = _parse_model(d.pop("model"))


        skills = cast(list[str], d.pop("skills"))


        subagents = []
        _subagents = d.pop("subagents")
        for subagents_item_data in (_subagents):
            subagents_item = SessionSubagent.from_dict(subagents_item_data)



            subagents.append(subagents_item)


        allowed_tools = cast(list[str], d.pop("allowedTools"))


        mcp_connectors = cast(list[str], d.pop("mcpConnectors"))


        def _parse_identity(data: object) -> None | SessionRealmrootIdentityType0:
            if data is None:
                return data
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                componentsschemas_session_realmroot_identity_type_0 = SessionRealmrootIdentityType0.from_dict(data)



                return componentsschemas_session_realmroot_identity_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(None | SessionRealmrootIdentityType0, data)

        identity = _parse_identity(d.pop("identity"))


        created_at = datetime.datetime.fromisoformat(d.pop("createdAt"))




        session_agent_snapshot = cls(
            id=id,
            agent_id=agent_id,
            project_id=project_id,
            version=version,
            runtime=runtime,
            system_prompt=system_prompt,
            provider=provider,
            model=model,
            skills=skills,
            subagents=subagents,
            allowed_tools=allowed_tools,
            mcp_connectors=mcp_connectors,
            identity=identity,
            created_at=created_at,
        )


        session_agent_snapshot.additional_properties = d
        return session_agent_snapshot

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
