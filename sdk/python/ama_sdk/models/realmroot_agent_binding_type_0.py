from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset







T = TypeVar("T", bound="RealmrootAgentBindingType0")



@_attrs_define
class RealmrootAgentBindingType0:
    """ 
        Attributes:
            agent_id (str):  Example: 019ff41a-7da6-708f-8b05-44d4d0373685.
            origin (str):  Example: https://id.realmroot.dev.
            credential_ref (str):  Example: ama://vaults/vault_abc123/credentials/vaultcred_abc123.
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

        realmroot_agent_binding_type_0 = cls(
            agent_id=agent_id,
            origin=origin,
            credential_ref=credential_ref,
        )

        return realmroot_agent_binding_type_0

