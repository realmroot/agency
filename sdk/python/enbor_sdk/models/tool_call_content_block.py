from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from ..models.tool_call_content_block_type import ToolCallContentBlockType
from typing import cast

if TYPE_CHECKING:
  from ..models.event_tool_call_type_0 import EventToolCallType0
  from ..models.event_tool_call_type_1 import EventToolCallType1
  from ..models.event_tool_call_type_2 import EventToolCallType2
  from ..models.event_tool_call_type_3 import EventToolCallType3
  from ..models.event_tool_call_type_4 import EventToolCallType4
  from ..models.event_tool_call_type_5 import EventToolCallType5
  from ..models.event_tool_call_type_6 import EventToolCallType6
  from ..models.event_tool_call_type_7 import EventToolCallType7
  from ..models.event_tool_call_type_8 import EventToolCallType8
  from ..models.external_tool_call import ExternalToolCall





T = TypeVar("T", bound="ToolCallContentBlock")



@_attrs_define
class ToolCallContentBlock:
    """
        Attributes:
            type_ (ToolCallContentBlockType):
            tool_call (EventToolCallType0 | EventToolCallType1 | EventToolCallType2 | EventToolCallType3 |
                EventToolCallType4 | EventToolCallType5 | EventToolCallType6 | EventToolCallType7 | EventToolCallType8 |
                ExternalToolCall):
     """

    type_: ToolCallContentBlockType
    tool_call: EventToolCallType0 | EventToolCallType1 | EventToolCallType2 | EventToolCallType3 | EventToolCallType4 | EventToolCallType5 | EventToolCallType6 | EventToolCallType7 | EventToolCallType8 | ExternalToolCall
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)





    def to_dict(self) -> dict[str, Any]:
        from ..models.event_tool_call_type_0 import EventToolCallType0
        from ..models.event_tool_call_type_1 import EventToolCallType1
        from ..models.event_tool_call_type_2 import EventToolCallType2
        from ..models.event_tool_call_type_3 import EventToolCallType3
        from ..models.event_tool_call_type_4 import EventToolCallType4
        from ..models.event_tool_call_type_5 import EventToolCallType5
        from ..models.event_tool_call_type_6 import EventToolCallType6
        from ..models.event_tool_call_type_7 import EventToolCallType7
        from ..models.event_tool_call_type_8 import EventToolCallType8
        from ..models.external_tool_call import ExternalToolCall
        type_ = self.type_.value

        tool_call: dict[str, Any]
        if isinstance(self.tool_call, EventToolCallType0):
            tool_call = self.tool_call.to_dict()
        elif isinstance(self.tool_call, EventToolCallType1):
            tool_call = self.tool_call.to_dict()
        elif isinstance(self.tool_call, EventToolCallType2):
            tool_call = self.tool_call.to_dict()
        elif isinstance(self.tool_call, EventToolCallType3):
            tool_call = self.tool_call.to_dict()
        elif isinstance(self.tool_call, EventToolCallType4):
            tool_call = self.tool_call.to_dict()
        elif isinstance(self.tool_call, EventToolCallType5):
            tool_call = self.tool_call.to_dict()
        elif isinstance(self.tool_call, EventToolCallType6):
            tool_call = self.tool_call.to_dict()
        elif isinstance(self.tool_call, EventToolCallType7):
            tool_call = self.tool_call.to_dict()
        elif isinstance(self.tool_call, EventToolCallType8):
            tool_call = self.tool_call.to_dict()
        else:
            tool_call = self.tool_call.to_dict()



        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({
            "type": type_,
            "toolCall": tool_call,
        })

        return field_dict



    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.event_tool_call_type_0 import EventToolCallType0
        from ..models.event_tool_call_type_1 import EventToolCallType1
        from ..models.event_tool_call_type_2 import EventToolCallType2
        from ..models.event_tool_call_type_3 import EventToolCallType3
        from ..models.event_tool_call_type_4 import EventToolCallType4
        from ..models.event_tool_call_type_5 import EventToolCallType5
        from ..models.event_tool_call_type_6 import EventToolCallType6
        from ..models.event_tool_call_type_7 import EventToolCallType7
        from ..models.event_tool_call_type_8 import EventToolCallType8
        from ..models.external_tool_call import ExternalToolCall
        d = dict(src_dict)
        type_ = ToolCallContentBlockType(d.pop("type"))




        def _parse_tool_call(data: object) -> EventToolCallType0 | EventToolCallType1 | EventToolCallType2 | EventToolCallType3 | EventToolCallType4 | EventToolCallType5 | EventToolCallType6 | EventToolCallType7 | EventToolCallType8 | ExternalToolCall:
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                componentsschemas_event_tool_call_type_0 = EventToolCallType0.from_dict(data)



                return componentsschemas_event_tool_call_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                componentsschemas_event_tool_call_type_1 = EventToolCallType1.from_dict(data)



                return componentsschemas_event_tool_call_type_1
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                componentsschemas_event_tool_call_type_2 = EventToolCallType2.from_dict(data)



                return componentsschemas_event_tool_call_type_2
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                componentsschemas_event_tool_call_type_3 = EventToolCallType3.from_dict(data)



                return componentsschemas_event_tool_call_type_3
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                componentsschemas_event_tool_call_type_4 = EventToolCallType4.from_dict(data)



                return componentsschemas_event_tool_call_type_4
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                componentsschemas_event_tool_call_type_5 = EventToolCallType5.from_dict(data)



                return componentsschemas_event_tool_call_type_5
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                componentsschemas_event_tool_call_type_6 = EventToolCallType6.from_dict(data)



                return componentsschemas_event_tool_call_type_6
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                componentsschemas_event_tool_call_type_7 = EventToolCallType7.from_dict(data)



                return componentsschemas_event_tool_call_type_7
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                componentsschemas_event_tool_call_type_8 = EventToolCallType8.from_dict(data)



                return componentsschemas_event_tool_call_type_8
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            if not isinstance(data, dict):
                raise TypeError()
            componentsschemas_event_tool_call_type_9 = ExternalToolCall.from_dict(data)



            return componentsschemas_event_tool_call_type_9

        tool_call = _parse_tool_call(d.pop("toolCall"))


        tool_call_content_block = cls(
            type_=type_,
            tool_call=tool_call,
        )


        tool_call_content_block.additional_properties = d
        return tool_call_content_block

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
