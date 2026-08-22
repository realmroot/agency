from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from ..models.runner_channel_message_type_5_type import RunnerChannelMessageType5Type
from ..types import UNSET, Unset
from typing import cast

if TYPE_CHECKING:
  from ..models.runner_opaque_json_object import RunnerOpaqueJsonObject





T = TypeVar("T", bound="RunnerChannelMessageType5")



@_attrs_define
class RunnerChannelMessageType5:
    """ 
        Attributes:
            type_ (RunnerChannelMessageType5Type):
            request_id (str):
            session_id (str):  Example: session_abc123.
            ok (bool):
            runner_id (str | Unset):  Example: runner_abc123.
            result (RunnerOpaqueJsonObject | Unset):
            error (str | Unset):
     """

    type_: RunnerChannelMessageType5Type
    request_id: str
    session_id: str
    ok: bool
    runner_id: str | Unset = UNSET
    result: RunnerOpaqueJsonObject | Unset = UNSET
    error: str | Unset = UNSET





    def to_dict(self) -> dict[str, Any]:
        from ..models.runner_opaque_json_object import RunnerOpaqueJsonObject
        type_ = self.type_.value

        request_id = self.request_id

        session_id = self.session_id

        ok = self.ok

        runner_id = self.runner_id

        result: dict[str, Any] | Unset = UNSET
        if not isinstance(self.result, Unset):
            result = self.result.to_dict()

        error = self.error


        field_dict: dict[str, Any] = {}

        field_dict.update({
            "type": type_,
            "requestId": request_id,
            "sessionId": session_id,
            "ok": ok,
        })
        if runner_id is not UNSET:
            field_dict["runnerId"] = runner_id
        if result is not UNSET:
            field_dict["result"] = result
        if error is not UNSET:
            field_dict["error"] = error

        return field_dict



    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.runner_opaque_json_object import RunnerOpaqueJsonObject
        d = dict(src_dict)
        type_ = RunnerChannelMessageType5Type(d.pop("type"))




        request_id = d.pop("requestId")

        session_id = d.pop("sessionId")

        ok = d.pop("ok")

        runner_id = d.pop("runnerId", UNSET)

        _result = d.pop("result", UNSET)
        result: RunnerOpaqueJsonObject | Unset
        if isinstance(_result,  Unset):
            result = UNSET
        else:
            result = RunnerOpaqueJsonObject.from_dict(_result)




        error = d.pop("error", UNSET)

        runner_channel_message_type_5 = cls(
            type_=type_,
            request_id=request_id,
            session_id=session_id,
            ok=ok,
            runner_id=runner_id,
            result=result,
            error=error,
        )

        return runner_channel_message_type_5

