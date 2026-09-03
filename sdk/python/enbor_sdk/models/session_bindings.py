from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from ..models.runtime_name import RuntimeName
from typing import cast

if TYPE_CHECKING:
  from ..models.session_bindings_agent import SessionBindingsAgent
  from ..models.session_bindings_environment import SessionBindingsEnvironment





T = TypeVar("T", bound="SessionBindings")



@_attrs_define
class SessionBindings:
    """
        Attributes:
            agent (SessionBindingsAgent):
            environment (SessionBindingsEnvironment):
            runtime (RuntimeName):  Example: codex.
     """

    agent: SessionBindingsAgent
    environment: SessionBindingsEnvironment
    runtime: RuntimeName
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)





    def to_dict(self) -> dict[str, Any]:
        from ..models.session_bindings_agent import SessionBindingsAgent
        from ..models.session_bindings_environment import SessionBindingsEnvironment
        agent = self.agent.to_dict()

        environment = self.environment.to_dict()

        runtime = self.runtime.value


        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({
            "agent": agent,
            "environment": environment,
            "runtime": runtime,
        })

        return field_dict



    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.session_bindings_agent import SessionBindingsAgent
        from ..models.session_bindings_environment import SessionBindingsEnvironment
        d = dict(src_dict)
        agent = SessionBindingsAgent.from_dict(d.pop("agent"))




        environment = SessionBindingsEnvironment.from_dict(d.pop("environment"))




        runtime = RuntimeName(d.pop("runtime"))




        session_bindings = cls(
            agent=agent,
            environment=environment,
            runtime=runtime,
        )


        session_bindings.additional_properties = d
        return session_bindings

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
