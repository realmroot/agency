from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset







T = TypeVar("T", bound="CreateIdentityRequestSpec")



@_attrs_define
class CreateIdentityRequestSpec:
    """
        Attributes:
            username (str):
            runtime (str): Canonical runtime identifier asserted by Realmroot. Binding to an Agent additionally requires a
                registered Enbor runtime driver. Example: codex.
     """

    username: str
    runtime: str





    def to_dict(self) -> dict[str, Any]:
        username = self.username

        runtime = self.runtime


        field_dict: dict[str, Any] = {}

        field_dict.update({
            "username": username,
            "runtime": runtime,
        })

        return field_dict



    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        username = d.pop("username")

        runtime = d.pop("runtime")

        create_identity_request_spec = cls(
            username=username,
            runtime=runtime,
        )

        return create_identity_request_spec
