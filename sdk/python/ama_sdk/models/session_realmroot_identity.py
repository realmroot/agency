from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from ..models.session_realmroot_identity_runtime import SessionRealmrootIdentityRuntime






T = TypeVar("T", bound="SessionRealmrootIdentity")



@_attrs_define
class SessionRealmrootIdentity:
    """ 
        Attributes:
            issuer (str):
            subject (str):
            username (str):
            runtime (SessionRealmrootIdentityRuntime):
            credential_ref (str):
     """

    issuer: str
    subject: str
    username: str
    runtime: SessionRealmrootIdentityRuntime
    credential_ref: str





    def to_dict(self) -> dict[str, Any]:
        issuer = self.issuer

        subject = self.subject

        username = self.username

        runtime = self.runtime.value

        credential_ref = self.credential_ref


        field_dict: dict[str, Any] = {}

        field_dict.update({
            "issuer": issuer,
            "subject": subject,
            "username": username,
            "runtime": runtime,
            "credentialRef": credential_ref,
        })

        return field_dict



    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        issuer = d.pop("issuer")

        subject = d.pop("subject")

        username = d.pop("username")

        runtime = SessionRealmrootIdentityRuntime(d.pop("runtime"))




        credential_ref = d.pop("credentialRef")

        session_realmroot_identity = cls(
            issuer=issuer,
            subject=subject,
            username=username,
            runtime=runtime,
            credential_ref=credential_ref,
        )

        return session_realmroot_identity

