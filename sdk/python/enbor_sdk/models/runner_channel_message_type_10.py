from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from ..models.runner_channel_message_type_10_type import RunnerChannelMessageType10Type
from ..types import UNSET, Unset






T = TypeVar("T", bound="RunnerChannelMessageType10")



@_attrs_define
class RunnerChannelMessageType10:
    """
        Attributes:
            type_ (RunnerChannelMessageType10Type):
            message (str):
            event_id (str | Unset):
     """

    type_: RunnerChannelMessageType10Type
    message: str
    event_id: str | Unset = UNSET





    def to_dict(self) -> dict[str, Any]:
        type_ = self.type_.value

        message = self.message

        event_id = self.event_id


        field_dict: dict[str, Any] = {}

        field_dict.update({
            "type": type_,
            "message": message,
        })
        if event_id is not UNSET:
            field_dict["eventId"] = event_id

        return field_dict



    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        type_ = RunnerChannelMessageType10Type(d.pop("type"))




        message = d.pop("message")

        event_id = d.pop("eventId", UNSET)

        runner_channel_message_type_10 = cls(
            type_=type_,
            message=message,
            event_id=event_id,
        )

        return runner_channel_message_type_10
