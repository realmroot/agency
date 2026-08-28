from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset







T = TypeVar("T", bound="SessionRealmrootBindingType0")



@_attrs_define
class SessionRealmrootBindingType0:
    """ 
        Attributes:
            agent_id (str):
            origin (str):
            credential_ref (str):
     """

    agent_id: str
    origin: str
    credential_ref: str





    def to_dict(self) -> dict[str, Any]:
        agent_id = self.agent_id

        origin = self.origin

        credential_ref = self.credential_ref


        field_dict: dict[str, Any] = {}

        field_dict.update({
            "agentId": agent_id,
            "origin": origin,
            "credentialRef": credential_ref,
        })

        return field_dict



    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        agent_id = d.pop("agentId")

        origin = d.pop("origin")

        credential_ref = d.pop("credentialRef")

        session_realmroot_binding_type_0 = cls(
            agent_id=agent_id,
            origin=origin,
            credential_ref=credential_ref,
        )

        return session_realmroot_binding_type_0

