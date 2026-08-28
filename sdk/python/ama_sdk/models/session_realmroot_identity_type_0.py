from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from ..models.session_realmroot_identity_type_0_runtime import SessionRealmrootIdentityType0Runtime






T = TypeVar("T", bound="SessionRealmrootIdentityType0")



@_attrs_define
class SessionRealmrootIdentityType0:
    """ 
        Attributes:
            issuer (str):
            subject (str):
            username (str):
            runtime (SessionRealmrootIdentityType0Runtime):
     """

    issuer: str
    subject: str
    username: str
    runtime: SessionRealmrootIdentityType0Runtime





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

        runtime = SessionRealmrootIdentityType0Runtime(d.pop("runtime"))




        session_realmroot_identity_type_0 = cls(
            issuer=issuer,
            subject=subject,
            username=username,
            runtime=runtime,
        )

        return session_realmroot_identity_type_0

