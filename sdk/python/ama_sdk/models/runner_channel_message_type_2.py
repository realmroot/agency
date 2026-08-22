from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from ..models.runner_channel_message_type_2_type import RunnerChannelMessageType2Type
from ..types import UNSET, Unset
from typing import cast

if TYPE_CHECKING:
  from ..models.runner_session_command import RunnerSessionCommand





T = TypeVar("T", bound="RunnerChannelMessageType2")



@_attrs_define
class RunnerChannelMessageType2:
    """ 
        Attributes:
            type_ (RunnerChannelMessageType2Type):
            session_id (str):  Example: session_abc123.
            command (RunnerSessionCommand):
            request_id (str | Unset):
            runner_id (str | Unset):  Example: runner_abc123.
     """

    type_: RunnerChannelMessageType2Type
    session_id: str
    command: RunnerSessionCommand
    request_id: str | Unset = UNSET
    runner_id: str | Unset = UNSET





    def to_dict(self) -> dict[str, Any]:
        from ..models.runner_session_command import RunnerSessionCommand
        type_ = self.type_.value

        session_id = self.session_id

        command = self.command.to_dict()

        request_id = self.request_id

        runner_id = self.runner_id


        field_dict: dict[str, Any] = {}

        field_dict.update({
            "type": type_,
            "sessionId": session_id,
            "command": command,
        })
        if request_id is not UNSET:
            field_dict["requestId"] = request_id
        if runner_id is not UNSET:
            field_dict["runnerId"] = runner_id

        return field_dict



    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.runner_session_command import RunnerSessionCommand
        d = dict(src_dict)
        type_ = RunnerChannelMessageType2Type(d.pop("type"))




        session_id = d.pop("sessionId")

        command = RunnerSessionCommand.from_dict(d.pop("command"))




        request_id = d.pop("requestId", UNSET)

        runner_id = d.pop("runnerId", UNSET)

        runner_channel_message_type_2 = cls(
            type_=type_,
            session_id=session_id,
            command=command,
            request_id=request_id,
            runner_id=runner_id,
        )

        return runner_channel_message_type_2

