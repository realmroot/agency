from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from ..types import UNSET, Unset






T = TypeVar("T", bound="BashToolInput")



@_attrs_define
class BashToolInput:
    """
        Attributes:
            command (str):
            timeout (float | Unset):
     """

    command: str
    timeout: float | Unset = UNSET





    def to_dict(self) -> dict[str, Any]:
        command = self.command

        timeout = self.timeout


        field_dict: dict[str, Any] = {}

        field_dict.update({
            "command": command,
        })
        if timeout is not UNSET:
            field_dict["timeout"] = timeout

        return field_dict



    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        command = d.pop("command")

        timeout = d.pop("timeout", UNSET)

        bash_tool_input = cls(
            command=command,
            timeout=timeout,
        )

        return bash_tool_input
