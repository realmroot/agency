from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from ..types import UNSET, Unset
from typing import cast

if TYPE_CHECKING:
  from ..models.runner_runtime_tool_call import RunnerRuntimeToolCall





T = TypeVar("T", bound="RunnerRuntimeRequest")



@_attrs_define
class RunnerRuntimeRequest:
    """
        Attributes:
            tool_calls (list[RunnerRuntimeToolCall] | Unset):
     """

    tool_calls: list[RunnerRuntimeToolCall] | Unset = UNSET





    def to_dict(self) -> dict[str, Any]:
        from ..models.runner_runtime_tool_call import RunnerRuntimeToolCall
        tool_calls: list[dict[str, Any]] | Unset = UNSET
        if not isinstance(self.tool_calls, Unset):
            tool_calls = []
            for tool_calls_item_data in self.tool_calls:
                tool_calls_item = tool_calls_item_data.to_dict()
                tool_calls.append(tool_calls_item)




        field_dict: dict[str, Any] = {}

        field_dict.update({
        })
        if tool_calls is not UNSET:
            field_dict["toolCalls"] = tool_calls

        return field_dict



    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.runner_runtime_tool_call import RunnerRuntimeToolCall
        d = dict(src_dict)
        _tool_calls = d.pop("toolCalls", UNSET)
        tool_calls: list[RunnerRuntimeToolCall] | Unset = UNSET
        if _tool_calls is not UNSET:
            tool_calls = []
            for tool_calls_item_data in _tool_calls:
                tool_calls_item = RunnerRuntimeToolCall.from_dict(tool_calls_item_data)



                tool_calls.append(tool_calls_item)


        runner_runtime_request = cls(
            tool_calls=tool_calls,
        )

        return runner_runtime_request
