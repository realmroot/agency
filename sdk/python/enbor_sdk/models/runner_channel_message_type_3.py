from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from ..models.runner_channel_message_type_3_type import RunnerChannelMessageType3Type
from ..types import UNSET, Unset






T = TypeVar("T", bound="RunnerChannelMessageType3")



@_attrs_define
class RunnerChannelMessageType3:
    """
        Attributes:
            type_ (RunnerChannelMessageType3Type):
            request_id (str):
            session_id (str):  Example: 0195f5d6-7c20-7000-8000-00000000000e.
            accepted (bool):
            runner_id (str | Unset):  Example: 0195f5d6-7c20-7000-8000-000000000011.
            error (str | Unset):
     """

    type_: RunnerChannelMessageType3Type
    request_id: str
    session_id: str
    accepted: bool
    runner_id: str | Unset = UNSET
    error: str | Unset = UNSET





    def to_dict(self) -> dict[str, Any]:
        type_ = self.type_.value

        request_id = self.request_id

        session_id = self.session_id

        accepted = self.accepted

        runner_id = self.runner_id

        error = self.error


        field_dict: dict[str, Any] = {}

        field_dict.update({
            "type": type_,
            "requestId": request_id,
            "sessionId": session_id,
            "accepted": accepted,
        })
        if runner_id is not UNSET:
            field_dict["runnerId"] = runner_id
        if error is not UNSET:
            field_dict["error"] = error

        return field_dict



    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        type_ = RunnerChannelMessageType3Type(d.pop("type"))




        request_id = d.pop("requestId")

        session_id = d.pop("sessionId")

        accepted = d.pop("accepted")

        runner_id = d.pop("runnerId", UNSET)

        error = d.pop("error", UNSET)

        runner_channel_message_type_3 = cls(
            type_=type_,
            request_id=request_id,
            session_id=session_id,
            accepted=accepted,
            runner_id=runner_id,
            error=error,
        )

        return runner_channel_message_type_3
