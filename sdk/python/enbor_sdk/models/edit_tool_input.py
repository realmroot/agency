from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from typing import cast

if TYPE_CHECKING:
  from ..models.edit_tool_input_edits_item import EditToolInputEditsItem





T = TypeVar("T", bound="EditToolInput")



@_attrs_define
class EditToolInput:
    """
        Attributes:
            path (str):
            edits (list[EditToolInputEditsItem]):
     """

    path: str
    edits: list[EditToolInputEditsItem]





    def to_dict(self) -> dict[str, Any]:
        from ..models.edit_tool_input_edits_item import EditToolInputEditsItem
        path = self.path

        edits = []
        for edits_item_data in self.edits:
            edits_item = edits_item_data.to_dict()
            edits.append(edits_item)




        field_dict: dict[str, Any] = {}

        field_dict.update({
            "path": path,
            "edits": edits,
        })

        return field_dict



    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.edit_tool_input_edits_item import EditToolInputEditsItem
        d = dict(src_dict)
        path = d.pop("path")

        edits = []
        _edits = d.pop("edits")
        for edits_item_data in (_edits):
            edits_item = EditToolInputEditsItem.from_dict(edits_item_data)



            edits.append(edits_item)


        edit_tool_input = cls(
            path=path,
            edits=edits,
        )

        return edit_tool_input
