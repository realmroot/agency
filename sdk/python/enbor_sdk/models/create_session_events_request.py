from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from typing import cast

if TYPE_CHECKING:
  from ..models.enbor_event_type_0 import EnborEventType0
  from ..models.enbor_event_type_1 import EnborEventType1
  from ..models.enbor_event_type_10 import EnborEventType10
  from ..models.enbor_event_type_11 import EnborEventType11
  from ..models.enbor_event_type_2 import EnborEventType2
  from ..models.enbor_event_type_3 import EnborEventType3
  from ..models.enbor_event_type_4 import EnborEventType4
  from ..models.enbor_event_type_5 import EnborEventType5
  from ..models.enbor_event_type_6 import EnborEventType6
  from ..models.enbor_event_type_7 import EnborEventType7
  from ..models.enbor_event_type_8 import EnborEventType8
  from ..models.enbor_event_type_9 import EnborEventType9





T = TypeVar("T", bound="CreateSessionEventsRequest")



@_attrs_define
class CreateSessionEventsRequest:
    """
        Attributes:
            events (list[EnborEventType0 | EnborEventType1 | EnborEventType10 | EnborEventType11 | EnborEventType2 |
                EnborEventType3 | EnborEventType4 | EnborEventType5 | EnborEventType6 | EnborEventType7 | EnborEventType8 |
                EnborEventType9]):
     """

    events: list[EnborEventType0 | EnborEventType1 | EnborEventType10 | EnborEventType11 | EnborEventType2 | EnborEventType3 | EnborEventType4 | EnborEventType5 | EnborEventType6 | EnborEventType7 | EnborEventType8 | EnborEventType9]





    def to_dict(self) -> dict[str, Any]:
        from ..models.enbor_event_type_0 import EnborEventType0
        from ..models.enbor_event_type_1 import EnborEventType1
        from ..models.enbor_event_type_10 import EnborEventType10
        from ..models.enbor_event_type_11 import EnborEventType11
        from ..models.enbor_event_type_2 import EnborEventType2
        from ..models.enbor_event_type_3 import EnborEventType3
        from ..models.enbor_event_type_4 import EnborEventType4
        from ..models.enbor_event_type_5 import EnborEventType5
        from ..models.enbor_event_type_6 import EnborEventType6
        from ..models.enbor_event_type_7 import EnborEventType7
        from ..models.enbor_event_type_8 import EnborEventType8
        from ..models.enbor_event_type_9 import EnborEventType9
        events = []
        for events_item_data in self.events:
            events_item: dict[str, Any]
            if isinstance(events_item_data, EnborEventType0):
                events_item = events_item_data.to_dict()
            elif isinstance(events_item_data, EnborEventType1):
                events_item = events_item_data.to_dict()
            elif isinstance(events_item_data, EnborEventType2):
                events_item = events_item_data.to_dict()
            elif isinstance(events_item_data, EnborEventType3):
                events_item = events_item_data.to_dict()
            elif isinstance(events_item_data, EnborEventType4):
                events_item = events_item_data.to_dict()
            elif isinstance(events_item_data, EnborEventType5):
                events_item = events_item_data.to_dict()
            elif isinstance(events_item_data, EnborEventType6):
                events_item = events_item_data.to_dict()
            elif isinstance(events_item_data, EnborEventType7):
                events_item = events_item_data.to_dict()
            elif isinstance(events_item_data, EnborEventType8):
                events_item = events_item_data.to_dict()
            elif isinstance(events_item_data, EnborEventType9):
                events_item = events_item_data.to_dict()
            elif isinstance(events_item_data, EnborEventType10):
                events_item = events_item_data.to_dict()
            else:
                events_item = events_item_data.to_dict()

            events.append(events_item)




        field_dict: dict[str, Any] = {}

        field_dict.update({
            "events": events,
        })

        return field_dict



    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.enbor_event_type_0 import EnborEventType0
        from ..models.enbor_event_type_1 import EnborEventType1
        from ..models.enbor_event_type_10 import EnborEventType10
        from ..models.enbor_event_type_11 import EnborEventType11
        from ..models.enbor_event_type_2 import EnborEventType2
        from ..models.enbor_event_type_3 import EnborEventType3
        from ..models.enbor_event_type_4 import EnborEventType4
        from ..models.enbor_event_type_5 import EnborEventType5
        from ..models.enbor_event_type_6 import EnborEventType6
        from ..models.enbor_event_type_7 import EnborEventType7
        from ..models.enbor_event_type_8 import EnborEventType8
        from ..models.enbor_event_type_9 import EnborEventType9
        d = dict(src_dict)
        events = []
        _events = d.pop("events")
        for events_item_data in (_events):
            def _parse_events_item(data: object) -> EnborEventType0 | EnborEventType1 | EnborEventType10 | EnborEventType11 | EnborEventType2 | EnborEventType3 | EnborEventType4 | EnborEventType5 | EnborEventType6 | EnborEventType7 | EnborEventType8 | EnborEventType9:
                try:
                    if not isinstance(data, dict):
                        raise TypeError()
                    componentsschemas_enbor_event_type_0 = EnborEventType0.from_dict(data)



                    return componentsschemas_enbor_event_type_0
                except (TypeError, ValueError, AttributeError, KeyError):
                    pass
                try:
                    if not isinstance(data, dict):
                        raise TypeError()
                    componentsschemas_enbor_event_type_1 = EnborEventType1.from_dict(data)



                    return componentsschemas_enbor_event_type_1
                except (TypeError, ValueError, AttributeError, KeyError):
                    pass
                try:
                    if not isinstance(data, dict):
                        raise TypeError()
                    componentsschemas_enbor_event_type_2 = EnborEventType2.from_dict(data)



                    return componentsschemas_enbor_event_type_2
                except (TypeError, ValueError, AttributeError, KeyError):
                    pass
                try:
                    if not isinstance(data, dict):
                        raise TypeError()
                    componentsschemas_enbor_event_type_3 = EnborEventType3.from_dict(data)



                    return componentsschemas_enbor_event_type_3
                except (TypeError, ValueError, AttributeError, KeyError):
                    pass
                try:
                    if not isinstance(data, dict):
                        raise TypeError()
                    componentsschemas_enbor_event_type_4 = EnborEventType4.from_dict(data)



                    return componentsschemas_enbor_event_type_4
                except (TypeError, ValueError, AttributeError, KeyError):
                    pass
                try:
                    if not isinstance(data, dict):
                        raise TypeError()
                    componentsschemas_enbor_event_type_5 = EnborEventType5.from_dict(data)



                    return componentsschemas_enbor_event_type_5
                except (TypeError, ValueError, AttributeError, KeyError):
                    pass
                try:
                    if not isinstance(data, dict):
                        raise TypeError()
                    componentsschemas_enbor_event_type_6 = EnborEventType6.from_dict(data)



                    return componentsschemas_enbor_event_type_6
                except (TypeError, ValueError, AttributeError, KeyError):
                    pass
                try:
                    if not isinstance(data, dict):
                        raise TypeError()
                    componentsschemas_enbor_event_type_7 = EnborEventType7.from_dict(data)



                    return componentsschemas_enbor_event_type_7
                except (TypeError, ValueError, AttributeError, KeyError):
                    pass
                try:
                    if not isinstance(data, dict):
                        raise TypeError()
                    componentsschemas_enbor_event_type_8 = EnborEventType8.from_dict(data)



                    return componentsschemas_enbor_event_type_8
                except (TypeError, ValueError, AttributeError, KeyError):
                    pass
                try:
                    if not isinstance(data, dict):
                        raise TypeError()
                    componentsschemas_enbor_event_type_9 = EnborEventType9.from_dict(data)



                    return componentsschemas_enbor_event_type_9
                except (TypeError, ValueError, AttributeError, KeyError):
                    pass
                try:
                    if not isinstance(data, dict):
                        raise TypeError()
                    componentsschemas_enbor_event_type_10 = EnborEventType10.from_dict(data)



                    return componentsschemas_enbor_event_type_10
                except (TypeError, ValueError, AttributeError, KeyError):
                    pass
                if not isinstance(data, dict):
                    raise TypeError()
                componentsschemas_enbor_event_type_11 = EnborEventType11.from_dict(data)



                return componentsschemas_enbor_event_type_11

            events_item = _parse_events_item(events_item_data)

            events.append(events_item)


        create_session_events_request = cls(
            events=events,
        )

        return create_session_events_request
