from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from typing import cast

if TYPE_CHECKING:
  from ..models.ama_event_type_0 import AmaEventType0
  from ..models.ama_event_type_1 import AmaEventType1
  from ..models.ama_event_type_10 import AmaEventType10
  from ..models.ama_event_type_11 import AmaEventType11
  from ..models.ama_event_type_2 import AmaEventType2
  from ..models.ama_event_type_3 import AmaEventType3
  from ..models.ama_event_type_4 import AmaEventType4
  from ..models.ama_event_type_5 import AmaEventType5
  from ..models.ama_event_type_6 import AmaEventType6
  from ..models.ama_event_type_7 import AmaEventType7
  from ..models.ama_event_type_8 import AmaEventType8
  from ..models.ama_event_type_9 import AmaEventType9





T = TypeVar("T", bound="CreateSessionEventsRequest")



@_attrs_define
class CreateSessionEventsRequest:
    """
        Attributes:
            events (list[AmaEventType0 | AmaEventType1 | AmaEventType10 | AmaEventType11 | AmaEventType2 | AmaEventType3 |
                AmaEventType4 | AmaEventType5 | AmaEventType6 | AmaEventType7 | AmaEventType8 | AmaEventType9]):
     """

    events: list[AmaEventType0 | AmaEventType1 | AmaEventType10 | AmaEventType11 | AmaEventType2 | AmaEventType3 | AmaEventType4 | AmaEventType5 | AmaEventType6 | AmaEventType7 | AmaEventType8 | AmaEventType9]





    def to_dict(self) -> dict[str, Any]:
        from ..models.ama_event_type_0 import AmaEventType0
        from ..models.ama_event_type_1 import AmaEventType1
        from ..models.ama_event_type_10 import AmaEventType10
        from ..models.ama_event_type_11 import AmaEventType11
        from ..models.ama_event_type_2 import AmaEventType2
        from ..models.ama_event_type_3 import AmaEventType3
        from ..models.ama_event_type_4 import AmaEventType4
        from ..models.ama_event_type_5 import AmaEventType5
        from ..models.ama_event_type_6 import AmaEventType6
        from ..models.ama_event_type_7 import AmaEventType7
        from ..models.ama_event_type_8 import AmaEventType8
        from ..models.ama_event_type_9 import AmaEventType9
        events = []
        for events_item_data in self.events:
            events_item: dict[str, Any]
            if isinstance(events_item_data, AmaEventType0):
                events_item = events_item_data.to_dict()
            elif isinstance(events_item_data, AmaEventType1):
                events_item = events_item_data.to_dict()
            elif isinstance(events_item_data, AmaEventType2):
                events_item = events_item_data.to_dict()
            elif isinstance(events_item_data, AmaEventType3):
                events_item = events_item_data.to_dict()
            elif isinstance(events_item_data, AmaEventType4):
                events_item = events_item_data.to_dict()
            elif isinstance(events_item_data, AmaEventType5):
                events_item = events_item_data.to_dict()
            elif isinstance(events_item_data, AmaEventType6):
                events_item = events_item_data.to_dict()
            elif isinstance(events_item_data, AmaEventType7):
                events_item = events_item_data.to_dict()
            elif isinstance(events_item_data, AmaEventType8):
                events_item = events_item_data.to_dict()
            elif isinstance(events_item_data, AmaEventType9):
                events_item = events_item_data.to_dict()
            elif isinstance(events_item_data, AmaEventType10):
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
        from ..models.ama_event_type_0 import AmaEventType0
        from ..models.ama_event_type_1 import AmaEventType1
        from ..models.ama_event_type_10 import AmaEventType10
        from ..models.ama_event_type_11 import AmaEventType11
        from ..models.ama_event_type_2 import AmaEventType2
        from ..models.ama_event_type_3 import AmaEventType3
        from ..models.ama_event_type_4 import AmaEventType4
        from ..models.ama_event_type_5 import AmaEventType5
        from ..models.ama_event_type_6 import AmaEventType6
        from ..models.ama_event_type_7 import AmaEventType7
        from ..models.ama_event_type_8 import AmaEventType8
        from ..models.ama_event_type_9 import AmaEventType9
        d = dict(src_dict)
        events = []
        _events = d.pop("events")
        for events_item_data in (_events):
            def _parse_events_item(data: object) -> AmaEventType0 | AmaEventType1 | AmaEventType10 | AmaEventType11 | AmaEventType2 | AmaEventType3 | AmaEventType4 | AmaEventType5 | AmaEventType6 | AmaEventType7 | AmaEventType8 | AmaEventType9:
                try:
                    if not isinstance(data, dict):
                        raise TypeError()
                    componentsschemas_ama_event_type_0 = AmaEventType0.from_dict(data)



                    return componentsschemas_ama_event_type_0
                except (TypeError, ValueError, AttributeError, KeyError):
                    pass
                try:
                    if not isinstance(data, dict):
                        raise TypeError()
                    componentsschemas_ama_event_type_1 = AmaEventType1.from_dict(data)



                    return componentsschemas_ama_event_type_1
                except (TypeError, ValueError, AttributeError, KeyError):
                    pass
                try:
                    if not isinstance(data, dict):
                        raise TypeError()
                    componentsschemas_ama_event_type_2 = AmaEventType2.from_dict(data)



                    return componentsschemas_ama_event_type_2
                except (TypeError, ValueError, AttributeError, KeyError):
                    pass
                try:
                    if not isinstance(data, dict):
                        raise TypeError()
                    componentsschemas_ama_event_type_3 = AmaEventType3.from_dict(data)



                    return componentsschemas_ama_event_type_3
                except (TypeError, ValueError, AttributeError, KeyError):
                    pass
                try:
                    if not isinstance(data, dict):
                        raise TypeError()
                    componentsschemas_ama_event_type_4 = AmaEventType4.from_dict(data)



                    return componentsschemas_ama_event_type_4
                except (TypeError, ValueError, AttributeError, KeyError):
                    pass
                try:
                    if not isinstance(data, dict):
                        raise TypeError()
                    componentsschemas_ama_event_type_5 = AmaEventType5.from_dict(data)



                    return componentsschemas_ama_event_type_5
                except (TypeError, ValueError, AttributeError, KeyError):
                    pass
                try:
                    if not isinstance(data, dict):
                        raise TypeError()
                    componentsschemas_ama_event_type_6 = AmaEventType6.from_dict(data)



                    return componentsschemas_ama_event_type_6
                except (TypeError, ValueError, AttributeError, KeyError):
                    pass
                try:
                    if not isinstance(data, dict):
                        raise TypeError()
                    componentsschemas_ama_event_type_7 = AmaEventType7.from_dict(data)



                    return componentsschemas_ama_event_type_7
                except (TypeError, ValueError, AttributeError, KeyError):
                    pass
                try:
                    if not isinstance(data, dict):
                        raise TypeError()
                    componentsschemas_ama_event_type_8 = AmaEventType8.from_dict(data)



                    return componentsschemas_ama_event_type_8
                except (TypeError, ValueError, AttributeError, KeyError):
                    pass
                try:
                    if not isinstance(data, dict):
                        raise TypeError()
                    componentsschemas_ama_event_type_9 = AmaEventType9.from_dict(data)



                    return componentsschemas_ama_event_type_9
                except (TypeError, ValueError, AttributeError, KeyError):
                    pass
                try:
                    if not isinstance(data, dict):
                        raise TypeError()
                    componentsschemas_ama_event_type_10 = AmaEventType10.from_dict(data)



                    return componentsschemas_ama_event_type_10
                except (TypeError, ValueError, AttributeError, KeyError):
                    pass
                if not isinstance(data, dict):
                    raise TypeError()
                componentsschemas_ama_event_type_11 = AmaEventType11.from_dict(data)



                return componentsschemas_ama_event_type_11

            events_item = _parse_events_item(events_item_data)

            events.append(events_item)


        create_session_events_request = cls(
            events=events,
        )

        return create_session_events_request
