from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from ..models.runner_channel_message_type_9_type import RunnerChannelMessageType9Type






T = TypeVar("T", bound="RunnerChannelMessageType9")



@_attrs_define
class RunnerChannelMessageType9:
    """
        Attributes:
            type_ (RunnerChannelMessageType9Type):
            event_id (str):
     """

    type_: RunnerChannelMessageType9Type
    event_id: str





    def to_dict(self) -> dict[str, Any]:
        type_ = self.type_.value

        event_id = self.event_id


        field_dict: dict[str, Any] = {}

        field_dict.update({
            "type": type_,
            "eventId": event_id,
        })

        return field_dict



    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        type_ = RunnerChannelMessageType9Type(d.pop("type"))




        event_id = d.pop("eventId")

        runner_channel_message_type_9 = cls(
            type_=type_,
            event_id=event_id,
        )

        return runner_channel_message_type_9
