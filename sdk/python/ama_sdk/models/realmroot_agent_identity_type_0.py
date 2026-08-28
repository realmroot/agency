from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from ..models.realmroot_agent_identity_type_0_runtime import RealmrootAgentIdentityType0Runtime






T = TypeVar("T", bound="RealmrootAgentIdentityType0")



@_attrs_define
class RealmrootAgentIdentityType0:
    """ 
        Attributes:
            issuer (str):  Example: https://id.realmroot.dev/api/auth.
            subject (str):  Example: agt_backend_worker_1.
            username (str):  Example: backend-worker.
            runtime (RealmrootAgentIdentityType0Runtime):
     """

    issuer: str
    subject: str
    username: str
    runtime: RealmrootAgentIdentityType0Runtime





    def to_dict(self) -> dict[str, Any]:
        issuer = self.issuer

        subject = self.subject

        username = self.username

        runtime = self.runtime.value


        field_dict: dict[str, Any] = {}

        field_dict.update({
            "issuer": issuer,
            "subject": subject,
            "username": username,
            "runtime": runtime,
        })

        return field_dict



    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        issuer = d.pop("issuer")

        subject = d.pop("subject")

        username = d.pop("username")

        runtime = RealmrootAgentIdentityType0Runtime(d.pop("runtime"))




        realmroot_agent_identity_type_0 = cls(
            issuer=issuer,
            subject=subject,
            username=username,
            runtime=runtime,
        )

        return realmroot_agent_identity_type_0

