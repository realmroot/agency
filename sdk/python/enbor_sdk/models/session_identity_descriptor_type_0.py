from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from ..models.runtime_name import RuntimeName






T = TypeVar("T", bound="SessionIdentityDescriptorType0")



@_attrs_define
class SessionIdentityDescriptorType0:
    """
        Attributes:
            identity_id (str):
            agent_id (str): Realmroot internal Identity resource id. It is not the stable OIDC subject and must not be used
                for Inbox addressing.
            issuer (str):
            subject (str): Stable OIDC subject used for Inbox addressing. New Realmroot subjects are bare UUIDv7 values;
                legacy opaque snapshot values remain readable.
            username (str):
            runtime (RuntimeName):  Example: codex.
     """

    identity_id: str
    agent_id: str
    issuer: str
    subject: str
    username: str
    runtime: RuntimeName





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

        runtime = RuntimeName(d.pop("runtime"))




        session_identity_descriptor_type_0 = cls(
            identity_id=identity_id,
            agent_id=agent_id,
            issuer=issuer,
            subject=subject,
            username=username,
            runtime=runtime,
        )

        return session_identity_descriptor_type_0
