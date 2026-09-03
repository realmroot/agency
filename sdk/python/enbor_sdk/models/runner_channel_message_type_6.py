from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from ..models.runner_channel_message_type_6_type import RunnerChannelMessageType6Type






T = TypeVar("T", bound="RunnerChannelMessageType6")



@_attrs_define
class RunnerChannelMessageType6:
    """
        Attributes:
            type_ (RunnerChannelMessageType6Type):
            event_id (str):
            session_id (str):  Example: 0195f5d6-7c20-7000-8000-00000000000e.
     """

    type_: RunnerChannelMessageType6Type
    event_id: str
    session_id: str





    def to_dict(self) -> dict[str, Any]:
        type_ = self.type_.value

        event_id = self.event_id

        session_id = self.session_id


        field_dict: dict[str, Any] = {}

        field_dict.update({
            "type": type_,
            "eventId": event_id,
            "sessionId": session_id,
        })

        return field_dict



    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        type_ = RunnerChannelMessageType6Type(d.pop("type"))




        event_id = d.pop("eventId")

        session_id = d.pop("sessionId")

        runner_channel_message_type_6 = cls(
            type_=type_,
            event_id=event_id,
            session_id=session_id,
        )

        return runner_channel_message_type_6
