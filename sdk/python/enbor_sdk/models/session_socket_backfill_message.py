from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from ..models.session_socket_backfill_message_type import SessionSocketBackfillMessageType
from typing import cast

if TYPE_CHECKING:
  from ..models.session_event_type_0 import SessionEventType0
  from ..models.session_event_type_1 import SessionEventType1
  from ..models.session_event_type_10 import SessionEventType10
  from ..models.session_event_type_11 import SessionEventType11
  from ..models.session_event_type_2 import SessionEventType2
  from ..models.session_event_type_3 import SessionEventType3
  from ..models.session_event_type_4 import SessionEventType4
  from ..models.session_event_type_5 import SessionEventType5
  from ..models.session_event_type_6 import SessionEventType6
  from ..models.session_event_type_7 import SessionEventType7
  from ..models.session_event_type_8 import SessionEventType8
  from ..models.session_event_type_9 import SessionEventType9





T = TypeVar("T", bound="SessionSocketBackfillMessage")



@_attrs_define
class SessionSocketBackfillMessage:
    """
        Attributes:
            type_ (SessionSocketBackfillMessageType):
            request_id (str):
            events (list[SessionEventType0 | SessionEventType1 | SessionEventType10 | SessionEventType11 | SessionEventType2
                | SessionEventType3 | SessionEventType4 | SessionEventType5 | SessionEventType6 | SessionEventType7 |
                SessionEventType8 | SessionEventType9]):
            next_cursor (int | None):
            has_more (bool):
     """

    type_: SessionSocketBackfillMessageType
    request_id: str
    events: list[SessionEventType0 | SessionEventType1 | SessionEventType10 | SessionEventType11 | SessionEventType2 | SessionEventType3 | SessionEventType4 | SessionEventType5 | SessionEventType6 | SessionEventType7 | SessionEventType8 | SessionEventType9]
    next_cursor: int | None
    has_more: bool
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)





    def to_dict(self) -> dict[str, Any]:
        from ..models.session_event_type_0 import SessionEventType0
        from ..models.session_event_type_1 import SessionEventType1
        from ..models.session_event_type_10 import SessionEventType10
        from ..models.session_event_type_11 import SessionEventType11
        from ..models.session_event_type_2 import SessionEventType2
        from ..models.session_event_type_3 import SessionEventType3
        from ..models.session_event_type_4 import SessionEventType4
        from ..models.session_event_type_5 import SessionEventType5
        from ..models.session_event_type_6 import SessionEventType6
        from ..models.session_event_type_7 import SessionEventType7
        from ..models.session_event_type_8 import SessionEventType8
        from ..models.session_event_type_9 import SessionEventType9
        type_ = self.type_.value

        request_id = self.request_id

        events = []
        for events_item_data in self.events:
            events_item: dict[str, Any]
            if isinstance(events_item_data, SessionEventType0):
                events_item = events_item_data.to_dict()
            elif isinstance(events_item_data, SessionEventType1):
                events_item = events_item_data.to_dict()
            elif isinstance(events_item_data, SessionEventType2):
                events_item = events_item_data.to_dict()
            elif isinstance(events_item_data, SessionEventType3):
                events_item = events_item_data.to_dict()
            elif isinstance(events_item_data, SessionEventType4):
                events_item = events_item_data.to_dict()
            elif isinstance(events_item_data, SessionEventType5):
                events_item = events_item_data.to_dict()
            elif isinstance(events_item_data, SessionEventType6):
                events_item = events_item_data.to_dict()
            elif isinstance(events_item_data, SessionEventType7):
                events_item = events_item_data.to_dict()
            elif isinstance(events_item_data, SessionEventType8):
                events_item = events_item_data.to_dict()
            elif isinstance(events_item_data, SessionEventType9):
                events_item = events_item_data.to_dict()
            elif isinstance(events_item_data, SessionEventType10):
                events_item = events_item_data.to_dict()
            else:
                events_item = events_item_data.to_dict()

            events.append(events_item)



        next_cursor: int | None
        next_cursor = self.next_cursor

        has_more = self.has_more


        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({
            "type": type_,
            "requestId": request_id,
            "events": events,
            "nextCursor": next_cursor,
            "hasMore": has_more,
        })

        return field_dict



    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.session_event_type_0 import SessionEventType0
        from ..models.session_event_type_1 import SessionEventType1
        from ..models.session_event_type_10 import SessionEventType10
        from ..models.session_event_type_11 import SessionEventType11
        from ..models.session_event_type_2 import SessionEventType2
        from ..models.session_event_type_3 import SessionEventType3
        from ..models.session_event_type_4 import SessionEventType4
        from ..models.session_event_type_5 import SessionEventType5
        from ..models.session_event_type_6 import SessionEventType6
        from ..models.session_event_type_7 import SessionEventType7
        from ..models.session_event_type_8 import SessionEventType8
        from ..models.session_event_type_9 import SessionEventType9
        d = dict(src_dict)
        type_ = SessionSocketBackfillMessageType(d.pop("type"))




        request_id = d.pop("requestId")

        events = []
        _events = d.pop("events")
        for events_item_data in (_events):
            def _parse_events_item(data: object) -> SessionEventType0 | SessionEventType1 | SessionEventType10 | SessionEventType11 | SessionEventType2 | SessionEventType3 | SessionEventType4 | SessionEventType5 | SessionEventType6 | SessionEventType7 | SessionEventType8 | SessionEventType9:
                try:
                    if not isinstance(data, dict):
                        raise TypeError()
                    componentsschemas_session_event_type_0 = SessionEventType0.from_dict(data)



                    return componentsschemas_session_event_type_0
                except (TypeError, ValueError, AttributeError, KeyError):
                    pass
                try:
                    if not isinstance(data, dict):
                        raise TypeError()
                    componentsschemas_session_event_type_1 = SessionEventType1.from_dict(data)



                    return componentsschemas_session_event_type_1
                except (TypeError, ValueError, AttributeError, KeyError):
                    pass
                try:
                    if not isinstance(data, dict):
                        raise TypeError()
                    componentsschemas_session_event_type_2 = SessionEventType2.from_dict(data)



                    return componentsschemas_session_event_type_2
                except (TypeError, ValueError, AttributeError, KeyError):
                    pass
                try:
                    if not isinstance(data, dict):
                        raise TypeError()
                    componentsschemas_session_event_type_3 = SessionEventType3.from_dict(data)



                    return componentsschemas_session_event_type_3
                except (TypeError, ValueError, AttributeError, KeyError):
                    pass
                try:
                    if not isinstance(data, dict):
                        raise TypeError()
                    componentsschemas_session_event_type_4 = SessionEventType4.from_dict(data)



                    return componentsschemas_session_event_type_4
                except (TypeError, ValueError, AttributeError, KeyError):
                    pass
                try:
                    if not isinstance(data, dict):
                        raise TypeError()
                    componentsschemas_session_event_type_5 = SessionEventType5.from_dict(data)



                    return componentsschemas_session_event_type_5
                except (TypeError, ValueError, AttributeError, KeyError):
                    pass
                try:
                    if not isinstance(data, dict):
                        raise TypeError()
                    componentsschemas_session_event_type_6 = SessionEventType6.from_dict(data)



                    return componentsschemas_session_event_type_6
                except (TypeError, ValueError, AttributeError, KeyError):
                    pass
                try:
                    if not isinstance(data, dict):
                        raise TypeError()
                    componentsschemas_session_event_type_7 = SessionEventType7.from_dict(data)



                    return componentsschemas_session_event_type_7
                except (TypeError, ValueError, AttributeError, KeyError):
                    pass
                try:
                    if not isinstance(data, dict):
                        raise TypeError()
                    componentsschemas_session_event_type_8 = SessionEventType8.from_dict(data)



                    return componentsschemas_session_event_type_8
                except (TypeError, ValueError, AttributeError, KeyError):
                    pass
                try:
                    if not isinstance(data, dict):
                        raise TypeError()
                    componentsschemas_session_event_type_9 = SessionEventType9.from_dict(data)



                    return componentsschemas_session_event_type_9
                except (TypeError, ValueError, AttributeError, KeyError):
                    pass
                try:
                    if not isinstance(data, dict):
                        raise TypeError()
                    componentsschemas_session_event_type_10 = SessionEventType10.from_dict(data)



                    return componentsschemas_session_event_type_10
                except (TypeError, ValueError, AttributeError, KeyError):
                    pass
                if not isinstance(data, dict):
                    raise TypeError()
                componentsschemas_session_event_type_11 = SessionEventType11.from_dict(data)



                return componentsschemas_session_event_type_11

            events_item = _parse_events_item(events_item_data)

            events.append(events_item)


        def _parse_next_cursor(data: object) -> int | None:
            if data is None:
                return data
            return cast(int | None, data)

        next_cursor = _parse_next_cursor(d.pop("nextCursor"))


        has_more = d.pop("hasMore")

        session_socket_backfill_message = cls(
            type_=type_,
            request_id=request_id,
            events=events,
            next_cursor=next_cursor,
            has_more=has_more,
        )


        session_socket_backfill_message.additional_properties = d
        return session_socket_backfill_message

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
