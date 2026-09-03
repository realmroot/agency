from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from ..models.event_tool_call_type_0_name import EventToolCallType0Name
from typing import cast

if TYPE_CHECKING:
  from ..models.bash_tool_input import BashToolInput





T = TypeVar("T", bound="EventToolCallType0")



@_attrs_define
class EventToolCallType0:
    """
        Attributes:
            id (str):
            name (EventToolCallType0Name):
            input_ (BashToolInput):
     """

    id: str
    name: EventToolCallType0Name
    input_: BashToolInput





    def to_dict(self) -> dict[str, Any]:
        from ..models.bash_tool_input import BashToolInput
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
        from ..models.bash_tool_input import BashToolInput
        d = dict(src_dict)
        id = d.pop("id")

        name = EventToolCallType0Name(d.pop("name"))




        input_ = BashToolInput.from_dict(d.pop("input"))




        event_tool_call_type_0 = cls(
            id=id,
            name=name,
            input_=input_,
        )

        return event_tool_call_type_0
