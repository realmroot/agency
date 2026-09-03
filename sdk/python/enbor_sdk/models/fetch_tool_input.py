from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset







T = TypeVar("T", bound="FetchToolInput")



@_attrs_define
class FetchToolInput:
    """
        Attributes:
            url (str):
     """

    url: str





    def to_dict(self) -> dict[str, Any]:
        url = self.url


        field_dict: dict[str, Any] = {}

        field_dict.update({
            "url": url,
        })

        return field_dict



    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        url = d.pop("url")

        fetch_tool_input = cls(
            url=url,
        )

        return fetch_tool_input
