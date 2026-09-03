from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from typing import cast

if TYPE_CHECKING:
  from ..models.external_tool_call_input import ExternalToolCallInput





T = TypeVar("T", bound="ExternalToolCall")



@_attrs_define
class ExternalToolCall:
    """
        Attributes:
            id (str):
            name (str):
            input_ (ExternalToolCallInput):
     """

    id: str
    name: str
    input_: ExternalToolCallInput





    def to_dict(self) -> dict[str, Any]:
        from ..models.external_tool_call_input import ExternalToolCallInput
        id = self.id

        name = self.name

        input_ = self.input_.to_dict()


        field_dict: dict[str, Any] = {}

        field_dict.update({
            "id": id,
            "name": name,
            "input": input_,
        })

        return field_dict



    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.external_tool_call_input import ExternalToolCallInput
        d = dict(src_dict)
        id = d.pop("id")

        name = d.pop("name")

        input_ = ExternalToolCallInput.from_dict(d.pop("input"))




        external_tool_call = cls(
            id=id,
            name=name,
            input_=input_,
        )

        return external_tool_call
