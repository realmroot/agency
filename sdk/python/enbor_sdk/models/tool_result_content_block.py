from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from ..models.tool_result_content_block_type import ToolResultContentBlockType
from ..types import UNSET, Unset
from typing import cast

if TYPE_CHECKING:
  from ..models.event_error import EventError
  from ..models.tool_result import ToolResult





T = TypeVar("T", bound="ToolResultContentBlock")



@_attrs_define
class ToolResultContentBlock:
    """
        Attributes:
            type_ (ToolResultContentBlockType):
            tool_call_id (str):
            result (ToolResult):
            error (EventError | Unset):
     """

    type_: ToolResultContentBlockType
    tool_call_id: str
    result: ToolResult
    error: EventError | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)





    def to_dict(self) -> dict[str, Any]:
        from ..models.event_error import EventError
        from ..models.tool_result import ToolResult
        type_ = self.type_.value

        tool_call_id = self.tool_call_id

        result = self.result.to_dict()

        error: dict[str, Any] | Unset = UNSET
        if not isinstance(self.error, Unset):
            error = self.error.to_dict()


        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({
            "type": type_,
            "toolCallId": tool_call_id,
            "result": result,
        })
        if error is not UNSET:
            field_dict["error"] = error

        return field_dict



    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.event_error import EventError
        from ..models.tool_result import ToolResult
        d = dict(src_dict)
        type_ = ToolResultContentBlockType(d.pop("type"))




        tool_call_id = d.pop("toolCallId")

        result = ToolResult.from_dict(d.pop("result"))




        _error = d.pop("error", UNSET)
        error: EventError | Unset
        if isinstance(_error,  Unset):
            error = UNSET
        else:
            error = EventError.from_dict(_error)




        tool_result_content_block = cls(
            type_=type_,
            tool_call_id=tool_call_id,
            result=result,
            error=error,
        )


        tool_result_content_block.additional_properties = d
        return tool_result_content_block

    @property
    def additional_keys(self) -> list[str]:
        return list(self.additional_properties.keys())

    def __getitem__(self, key: str) -> Any:
        return self.additional_properties[key]

    def __setitem__(self, key: str, value: Any) -> None:
        self.additional_properties[key] = value

    def __delitem__(self, key: str) -> None:
        del self.additional_properties[key]

    def __contains__(self, key: str) -> bool:
        return key in self.additional_properties
