from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from ..types import UNSET, Unset
from typing import cast

if TYPE_CHECKING:
  from ..models.runner_runtime_tool_call_arguments import RunnerRuntimeToolCallArguments
  from ..models.runner_runtime_tool_call_input import RunnerRuntimeToolCallInput





T = TypeVar("T", bound="RunnerRuntimeToolCall")



@_attrs_define
class RunnerRuntimeToolCall:
    """
        Attributes:
            id (str):  Example: tool_1.
            name (str):  Example: bash.
            input_ (RunnerRuntimeToolCallInput | Unset):
            arguments (RunnerRuntimeToolCallArguments | Unset):
     """

    id: str
    name: str
    input_: RunnerRuntimeToolCallInput | Unset = UNSET
    arguments: RunnerRuntimeToolCallArguments | Unset = UNSET





    def to_dict(self) -> dict[str, Any]:
        from ..models.runner_runtime_tool_call_arguments import RunnerRuntimeToolCallArguments
        from ..models.runner_runtime_tool_call_input import RunnerRuntimeToolCallInput
        id = self.id

        name = self.name

        input_: dict[str, Any] | Unset = UNSET
        if not isinstance(self.input_, Unset):
            input_ = self.input_.to_dict()

        arguments: dict[str, Any] | Unset = UNSET
        if not isinstance(self.arguments, Unset):
            arguments = self.arguments.to_dict()


        field_dict: dict[str, Any] = {}

        field_dict.update({
            "id": id,
            "name": name,
        })
        if input_ is not UNSET:
            field_dict["input"] = input_
        if arguments is not UNSET:
            field_dict["arguments"] = arguments

        return field_dict



    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.runner_runtime_tool_call_arguments import RunnerRuntimeToolCallArguments
        from ..models.runner_runtime_tool_call_input import RunnerRuntimeToolCallInput
        d = dict(src_dict)
        id = d.pop("id")

        name = d.pop("name")

        _input_ = d.pop("input", UNSET)
        input_: RunnerRuntimeToolCallInput | Unset
        if isinstance(_input_,  Unset):
            input_ = UNSET
        else:
            input_ = RunnerRuntimeToolCallInput.from_dict(_input_)




        _arguments = d.pop("arguments", UNSET)
        arguments: RunnerRuntimeToolCallArguments | Unset
        if isinstance(_arguments,  Unset):
            arguments = UNSET
        else:
            arguments = RunnerRuntimeToolCallArguments.from_dict(_arguments)




        runner_runtime_tool_call = cls(
            id=id,
            name=name,
            input_=input_,
            arguments=arguments,
        )

        return runner_runtime_tool_call
