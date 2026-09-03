from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from ..models.event_tool_call_type_5_name import EventToolCallType5Name
from typing import cast

if TYPE_CHECKING:
  from ..models.find_tool_input import FindToolInput





T = TypeVar("T", bound="EventToolCallType5")



@_attrs_define
class EventToolCallType5:
    """
        Attributes:
            id (str):
            name (EventToolCallType5Name):
            input_ (FindToolInput):
     """

    id: str
    name: EventToolCallType5Name
    input_: FindToolInput





    def to_dict(self) -> dict[str, Any]:
        from ..models.find_tool_input import FindToolInput
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
        from ..models.find_tool_input import FindToolInput
        d = dict(src_dict)
        id = d.pop("id")

        name = EventToolCallType5Name(d.pop("name"))




        input_ = FindToolInput.from_dict(d.pop("input"))




        event_tool_call_type_5 = cls(
            id=id,
            name=name,
            input_=input_,
        )

        return event_tool_call_type_5
