from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from ..models.event_tool_call_type_4_name import EventToolCallType4Name
from typing import cast

if TYPE_CHECKING:
  from ..models.grep_tool_input import GrepToolInput





T = TypeVar("T", bound="EventToolCallType4")



@_attrs_define
class EventToolCallType4:
    """
        Attributes:
            id (str):
            name (EventToolCallType4Name):
            input_ (GrepToolInput):
     """

    id: str
    name: EventToolCallType4Name
    input_: GrepToolInput





    def to_dict(self) -> dict[str, Any]:
        from ..models.grep_tool_input import GrepToolInput
        id = self.id

        name = self.name.value

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
        from ..models.grep_tool_input import GrepToolInput
        d = dict(src_dict)
        id = d.pop("id")

        name = EventToolCallType4Name(d.pop("name"))




        input_ = GrepToolInput.from_dict(d.pop("input"))




        event_tool_call_type_4 = cls(
            id=id,
            name=name,
            input_=input_,
        )

        return event_tool_call_type_4
