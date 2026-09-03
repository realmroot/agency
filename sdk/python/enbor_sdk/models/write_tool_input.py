from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset







T = TypeVar("T", bound="WriteToolInput")



@_attrs_define
class WriteToolInput:
    """
        Attributes:
            path (str):
            content (str):
     """

    path: str
    content: str





    def to_dict(self) -> dict[str, Any]:
        path = self.path

        content = self.content


        field_dict: dict[str, Any] = {}

        field_dict.update({
            "path": path,
            "content": content,
        })

        return field_dict



    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        path = d.pop("path")

        content = d.pop("content")

        write_tool_input = cls(
            path=path,
            content=content,
        )

        return write_tool_input
