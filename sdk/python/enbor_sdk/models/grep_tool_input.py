from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from ..types import UNSET, Unset






T = TypeVar("T", bound="GrepToolInput")



@_attrs_define
class GrepToolInput:
    """
        Attributes:
            pattern (str):
            path (str | Unset):
            glob (str | Unset):
            ignore_case (bool | Unset):
            literal (bool | Unset):
            context (int | Unset):
            limit (int | Unset):
     """

    pattern: str
    path: str | Unset = UNSET
    glob: str | Unset = UNSET
    ignore_case: bool | Unset = UNSET
    literal: bool | Unset = UNSET
    context: int | Unset = UNSET
    limit: int | Unset = UNSET





    def to_dict(self) -> dict[str, Any]:
        pattern = self.pattern

        path = self.path

        glob = self.glob

        ignore_case = self.ignore_case

        literal = self.literal

        context = self.context

        limit = self.limit


        field_dict: dict[str, Any] = {}

        field_dict.update({
            "pattern": pattern,
        })
        if path is not UNSET:
            field_dict["path"] = path
        if glob is not UNSET:
            field_dict["glob"] = glob
        if ignore_case is not UNSET:
            field_dict["ignoreCase"] = ignore_case
        if literal is not UNSET:
            field_dict["literal"] = literal
        if context is not UNSET:
            field_dict["context"] = context
        if limit is not UNSET:
            field_dict["limit"] = limit

        return field_dict



    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        pattern = d.pop("pattern")

        path = d.pop("path", UNSET)

        glob = d.pop("glob", UNSET)

        ignore_case = d.pop("ignoreCase", UNSET)

        literal = d.pop("literal", UNSET)

        context = d.pop("context", UNSET)

        limit = d.pop("limit", UNSET)

        grep_tool_input = cls(
            pattern=pattern,
            path=path,
            glob=glob,
            ignore_case=ignore_case,
            literal=literal,
            context=context,
            limit=limit,
        )

        return grep_tool_input
