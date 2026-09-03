from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from ..types import UNSET, Unset
from typing import cast

if TYPE_CHECKING:
  from ..models.runner_tool_call_arguments import RunnerToolCallArguments
  from ..models.runner_tool_call_input import RunnerToolCallInput





T = TypeVar("T", bound="RunnerToolCall")



@_attrs_define
class RunnerToolCall:
    """
        Attributes:
            id (str):  Example: call_abc123.
            name (str):  Example: bash.
            arguments (RunnerToolCallArguments | Unset):
            input_ (RunnerToolCallInput | Unset):
            approved (bool | Unset):
     """

    id: str
    name: str
    arguments: RunnerToolCallArguments | Unset = UNSET
    input_: RunnerToolCallInput | Unset = UNSET
    approved: bool | Unset = UNSET





    def to_dict(self) -> dict[str, Any]:
        from ..models.runner_tool_call_arguments import RunnerToolCallArguments
        from ..models.runner_tool_call_input import RunnerToolCallInput
        id = self.id

        name = self.name

        arguments: dict[str, Any] | Unset = UNSET
        if not isinstance(self.arguments, Unset):
            arguments = self.arguments.to_dict()

        input_: dict[str, Any] | Unset = UNSET
        if not isinstance(self.input_, Unset):
            input_ = self.input_.to_dict()

        approved = self.approved


        field_dict: dict[str, Any] = {}

        field_dict.update({
            "id": id,
            "name": name,
        })
        if arguments is not UNSET:
            field_dict["arguments"] = arguments
        if input_ is not UNSET:
            field_dict["input"] = input_
        if approved is not UNSET:
            field_dict["approved"] = approved

        return field_dict



    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.runner_tool_call_arguments import RunnerToolCallArguments
        from ..models.runner_tool_call_input import RunnerToolCallInput
        d = dict(src_dict)
        id = d.pop("id")

        name = d.pop("name")

        _arguments = d.pop("arguments", UNSET)
        arguments: RunnerToolCallArguments | Unset
        if isinstance(_arguments,  Unset):
            arguments = UNSET
        else:
            arguments = RunnerToolCallArguments.from_dict(_arguments)




        _input_ = d.pop("input", UNSET)
        input_: RunnerToolCallInput | Unset
        if isinstance(_input_,  Unset):
            input_ = UNSET
        else:
            input_ = RunnerToolCallInput.from_dict(_input_)




        approved = d.pop("approved", UNSET)

        runner_tool_call = cls(
            id=id,
            name=name,
            arguments=arguments,
            input_=input_,
            approved=approved,
        )

        return runner_tool_call
