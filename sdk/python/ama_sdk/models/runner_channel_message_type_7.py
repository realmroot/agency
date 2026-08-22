from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from ..models.runner_channel_message_type_7_type import RunnerChannelMessageType7Type
from ..types import UNSET, Unset
from typing import cast

if TYPE_CHECKING:
  from ..models.runner_opaque_json_object import RunnerOpaqueJsonObject





T = TypeVar("T", bound="RunnerChannelMessageType7")



@_attrs_define
class RunnerChannelMessageType7:
    """ 
        Attributes:
            type_ (RunnerChannelMessageType7Type):
            event_id (str):
            session_id (str):  Example: session_abc123.
            events (list[RunnerOpaqueJsonObject]):
            error (str | Unset):
     """

    type_: RunnerChannelMessageType7Type
    event_id: str
    session_id: str
    events: list[RunnerOpaqueJsonObject]
    error: str | Unset = UNSET





    def to_dict(self) -> dict[str, Any]:
        from ..models.runner_opaque_json_object import RunnerOpaqueJsonObject
        type_ = self.type_.value

        event_id = self.event_id

        session_id = self.session_id

        events = []
        for events_item_data in self.events:
            events_item = events_item_data.to_dict()
            events.append(events_item)



        error = self.error


        field_dict: dict[str, Any] = {}

        field_dict.update({
            "type": type_,
            "eventId": event_id,
            "sessionId": session_id,
            "events": events,
        })
        if error is not UNSET:
            field_dict["error"] = error

        return field_dict



    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.runner_opaque_json_object import RunnerOpaqueJsonObject
        d = dict(src_dict)
        type_ = RunnerChannelMessageType7Type(d.pop("type"))




        event_id = d.pop("eventId")

        session_id = d.pop("sessionId")

        events = []
        _events = d.pop("events")
        for events_item_data in (_events):
            events_item = RunnerOpaqueJsonObject.from_dict(events_item_data)



            events.append(events_item)


        error = d.pop("error", UNSET)

        runner_channel_message_type_7 = cls(
            type_=type_,
            event_id=event_id,
            session_id=session_id,
            events=events,
            error=error,
        )

        return runner_channel_message_type_7

