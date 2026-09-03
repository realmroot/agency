from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from ..types import UNSET, Unset






T = TypeVar("T", bound="FindToolInput")



@_attrs_define
class FindToolInput:
    """
        Attributes:
            pattern (str | Unset):
            glob (str | Unset):
            path (str | Unset):
            limit (int | Unset):
     """

    pattern: str | Unset = UNSET
    glob: str | Unset = UNSET
    path: str | Unset = UNSET
    limit: int | Unset = UNSET





    def to_dict(self) -> dict[str, Any]:
        pattern = self.pattern

        glob = self.glob

        path = self.path

        limit = self.limit


        field_dict: dict[str, Any] = {}

        field_dict.update({
        })
        if pattern is not UNSET:
            field_dict["pattern"] = pattern
        if glob is not UNSET:
            field_dict["glob"] = glob
        if path is not UNSET:
            field_dict["path"] = path
        if limit is not UNSET:
            field_dict["limit"] = limit

        return field_dict



    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        pattern = d.pop("pattern", UNSET)

        glob = d.pop("glob", UNSET)

        path = d.pop("path", UNSET)

        limit = d.pop("limit", UNSET)

        find_tool_input = cls(
            pattern=pattern,
            glob=glob,
            path=path,
            limit=limit,
        )

        return find_tool_input
