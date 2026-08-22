from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from ..models.runner_channel_message_type_4_type import RunnerChannelMessageType4Type
from ..types import UNSET, Unset
from typing import cast

if TYPE_CHECKING:
  from ..models.runner_sandbox_request import RunnerSandboxRequest





T = TypeVar("T", bound="RunnerChannelMessageType4")



@_attrs_define
class RunnerChannelMessageType4:
    """ 
        Attributes:
            type_ (RunnerChannelMessageType4Type):
            request_id (str):
            session_id (str):  Example: session_abc123.
            request (RunnerSandboxRequest):
            runner_id (str | Unset):  Example: runner_abc123.
     """

    type_: RunnerChannelMessageType4Type
    request_id: str
    session_id: str
    request: RunnerSandboxRequest
    runner_id: str | Unset = UNSET





    def to_dict(self) -> dict[str, Any]:
        from ..models.runner_sandbox_request import RunnerSandboxRequest
        type_ = self.type_.value

        request_id = self.request_id

        session_id = self.session_id

        request = self.request.to_dict()

        runner_id = self.runner_id


        field_dict: dict[str, Any] = {}

        field_dict.update({
            "type": type_,
            "requestId": request_id,
            "sessionId": session_id,
            "request": request,
        })
        if runner_id is not UNSET:
            field_dict["runnerId"] = runner_id

        return field_dict



    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.runner_sandbox_request import RunnerSandboxRequest
        d = dict(src_dict)
        type_ = RunnerChannelMessageType4Type(d.pop("type"))




        request_id = d.pop("requestId")

        session_id = d.pop("sessionId")

        request = RunnerSandboxRequest.from_dict(d.pop("request"))




        runner_id = d.pop("runnerId", UNSET)

        runner_channel_message_type_4 = cls(
            type_=type_,
            request_id=request_id,
            session_id=session_id,
            request=request,
            runner_id=runner_id,
        )

        return runner_channel_message_type_4

