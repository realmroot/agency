from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from ..types import UNSET, Unset






T = TypeVar("T", bound="WebSearchToolInput")



@_attrs_define
class WebSearchToolInput:
    """
        Attributes:
            query (str):
            limit (int | Unset):
     """

    query: str
    limit: int | Unset = UNSET





    def to_dict(self) -> dict[str, Any]:
        query = self.query

        limit = self.limit


        field_dict: dict[str, Any] = {}

        field_dict.update({
            "query": query,
        })
        if limit is not UNSET:
            field_dict["limit"] = limit

        return field_dict



    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        query = d.pop("query")

        limit = d.pop("limit", UNSET)

        web_search_tool_input = cls(
            query=query,
            limit=limit,
        )

        return web_search_tool_input
