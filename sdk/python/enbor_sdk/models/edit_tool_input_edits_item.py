from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset







T = TypeVar("T", bound="EditToolInputEditsItem")



@_attrs_define
class EditToolInputEditsItem:
    """
        Attributes:
            old_text (str):
            new_text (str):
     """

    old_text: str
    new_text: str





    def to_dict(self) -> dict[str, Any]:
        old_text = self.old_text

        new_text = self.new_text


        field_dict: dict[str, Any] = {}

        field_dict.update({
            "oldText": old_text,
            "newText": new_text,
        })

        return field_dict



    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        old_text = d.pop("oldText")

        new_text = d.pop("newText")

        edit_tool_input_edits_item = cls(
            old_text=old_text,
            new_text=new_text,
        )

        return edit_tool_input_edits_item
