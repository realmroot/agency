from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset







T = TypeVar("T", bound="RunnerGitCredential")



@_attrs_define
class RunnerGitCredential:
    """
        Attributes:
            username (str):  Example: x-access-token.
            password (str):  Example: secret-value.
     """

    username: str
    password: str





    def to_dict(self) -> dict[str, Any]:
        username = self.username

        password = self.password


        field_dict: dict[str, Any] = {}

        field_dict.update({
            "username": username,
            "password": password,
        })

        return field_dict



    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        username = d.pop("username")

        password = d.pop("password")

        runner_git_credential = cls(
            username=username,
            password=password,
        )

        return runner_git_credential
