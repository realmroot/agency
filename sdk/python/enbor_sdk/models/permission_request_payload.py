from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from ..types import UNSET, Unset
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
  from ..models.permission_request_payload_details import PermissionRequestPayloadDetails





T = TypeVar("T", bound="PermissionRequestPayload")



@_attrs_define
class PermissionRequestPayload:
    """
        Attributes:
            permission_id (str | Unset):
            command (str | Unset):
            tool_call (EventToolCallType0 | EventToolCallType1 | EventToolCallType2 | EventToolCallType3 |
                EventToolCallType4 | EventToolCallType5 | EventToolCallType6 | EventToolCallType7 | EventToolCallType8 |
                ExternalToolCall | Unset):
            details (PermissionRequestPayloadDetails | Unset):
     """

    permission_id: str | Unset = UNSET
    command: str | Unset = UNSET
    tool_call: EventToolCallType0 | EventToolCallType1 | EventToolCallType2 | EventToolCallType3 | EventToolCallType4 | EventToolCallType5 | EventToolCallType6 | EventToolCallType7 | EventToolCallType8 | ExternalToolCall | Unset = UNSET
    details: PermissionRequestPayloadDetails | Unset = UNSET





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
        from ..models.permission_request_payload_details import PermissionRequestPayloadDetails
        permission_id = self.permission_id

        command = self.command

        tool_call: dict[str, Any] | Unset
        if isinstance(self.tool_call, Unset):
            tool_call = UNSET
        elif isinstance(self.tool_call, EventToolCallType0):
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


        details: dict[str, Any] | Unset = UNSET
        if not isinstance(self.details, Unset):
            details = self.details.to_dict()


        field_dict: dict[str, Any] = {}

        field_dict.update({
        })
        if permission_id is not UNSET:
            field_dict["permissionId"] = permission_id
        if command is not UNSET:
            field_dict["command"] = command
        if tool_call is not UNSET:
            field_dict["toolCall"] = tool_call
        if details is not UNSET:
            field_dict["details"] = details

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
        from ..models.permission_request_payload_details import PermissionRequestPayloadDetails
        d = dict(src_dict)
        permission_id = d.pop("permissionId", UNSET)

        command = d.pop("command", UNSET)

        def _parse_tool_call(data: object) -> EventToolCallType0 | EventToolCallType1 | EventToolCallType2 | EventToolCallType3 | EventToolCallType4 | EventToolCallType5 | EventToolCallType6 | EventToolCallType7 | EventToolCallType8 | ExternalToolCall | Unset:
            if isinstance(data, Unset):
                return data
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

        tool_call = _parse_tool_call(d.pop("toolCall", UNSET))


        _details = d.pop("details", UNSET)
        details: PermissionRequestPayloadDetails | Unset
        if isinstance(_details,  Unset):
            details = UNSET
        else:
            details = PermissionRequestPayloadDetails.from_dict(_details)




        permission_request_payload = cls(
            permission_id=permission_id,
            command=command,
            tool_call=tool_call,
            details=details,
        )

        return permission_request_payload
