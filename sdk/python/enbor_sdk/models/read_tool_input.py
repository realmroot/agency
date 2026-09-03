from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from ..types import UNSET, Unset






T = TypeVar("T", bound="ReadToolInput")



@_attrs_define
class ReadToolInput:
    """
        Attributes:
            path (str):
            offset (int | Unset):
            limit (int | Unset):
     """

    path: str
    offset: int | Unset = UNSET
    limit: int | Unset = UNSET





    def to_dict(self) -> dict[str, Any]:
        path = self.path

        offset = self.offset

        limit = self.limit


        field_dict: dict[str, Any] = {}

        field_dict.update({
            "path": path,
        })
        if offset is not UNSET:
            field_dict["offset"] = offset
        if limit is not UNSET:
            field_dict["limit"] = limit

        return field_dict



    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        path = d.pop("path")

        offset = d.pop("offset", UNSET)

        limit = d.pop("limit", UNSET)

        read_tool_input = cls(
            path=path,
            offset=offset,
            limit=limit,
        )

        return read_tool_input
