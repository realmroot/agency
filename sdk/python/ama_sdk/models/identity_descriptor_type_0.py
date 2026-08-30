from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from ..models.identity_descriptor_type_0_runtime import IdentityDescriptorType0Runtime






T = TypeVar("T", bound="IdentityDescriptorType0")



@_attrs_define
class IdentityDescriptorType0:
    """
        Attributes:
            identity_id (str):  Example: 0195f5d6-7c20-7000-8000-000000000004.
            agent_id (str):  Example: 019ff41a-7da6-708f-8b05-44d4d0373685.
            issuer (str):  Example: https://id.realmroot.dev/api/auth.
            subject (str):  Example: agent:019ff41a-7da6-708f-8b05-44d4d0373685.
            username (str):  Example: researcher.
            runtime (IdentityDescriptorType0Runtime):
     """

    identity_id: str
    agent_id: str
    issuer: str
    subject: str
    username: str
    runtime: IdentityDescriptorType0Runtime





    def to_dict(self) -> dict[str, Any]:
        identity_id = self.identity_id

        agent_id = self.agent_id

        issuer = self.issuer

        subject = self.subject

        username = self.username

        runtime = self.runtime.value


        field_dict: dict[str, Any] = {}

        field_dict.update({
            "identityId": identity_id,
            "agentId": agent_id,
            "issuer": issuer,
            "subject": subject,
            "username": username,
            "runtime": runtime,
        })

        return field_dict



    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        identity_id = d.pop("identityId")

        agent_id = d.pop("agentId")

        issuer = d.pop("issuer")

        subject = d.pop("subject")

        username = d.pop("username")

        runtime = IdentityDescriptorType0Runtime(d.pop("runtime"))




        identity_descriptor_type_0 = cls(
            identity_id=identity_id,
            agent_id=agent_id,
            issuer=issuer,
            subject=subject,
            username=username,
            runtime=runtime,
        )

        return identity_descriptor_type_0
