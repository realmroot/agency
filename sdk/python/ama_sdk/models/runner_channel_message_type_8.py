from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from ..models.runner_channel_message_type_8_type import RunnerChannelMessageType8Type
from typing import cast

if TYPE_CHECKING:
  from ..models.runner_opaque_json_object import RunnerOpaqueJsonObject





T = TypeVar("T", bound="RunnerChannelMessageType8")



@_attrs_define
class RunnerChannelMessageType8:
    """ 
        Attributes:
            type_ (RunnerChannelMessageType8Type):
            session_id (str):  Example: session_abc123.
            record (RunnerOpaqueJsonObject):
     """

    type_: RunnerChannelMessageType8Type
    session_id: str
    record: RunnerOpaqueJsonObject





    def to_dict(self) -> dict[str, Any]:
        from ..models.runner_opaque_json_object import RunnerOpaqueJsonObject
        type_ = self.type_.value

        session_id = self.session_id

        record = self.record.to_dict()


        field_dict: dict[str, Any] = {}

        field_dict.update({
            "type": type_,
            "sessionId": session_id,
            "record": record,
        })

        return field_dict



    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.runner_opaque_json_object import RunnerOpaqueJsonObject
        d = dict(src_dict)
        type_ = RunnerChannelMessageType8Type(d.pop("type"))




        session_id = d.pop("sessionId")

        record = RunnerOpaqueJsonObject.from_dict(d.pop("record"))




        runner_channel_message_type_8 = cls(
            type_=type_,
            session_id=session_id,
            record=record,
        )

        return runner_channel_message_type_8

