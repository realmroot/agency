from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from ..models.runner_channel_message_type_0_type import RunnerChannelMessageType0Type
from ..types import UNSET, Unset






T = TypeVar("T", bound="RunnerChannelMessageType0")



@_attrs_define
class RunnerChannelMessageType0:
    """
        Attributes:
            type_ (RunnerChannelMessageType0Type):
            runner_id (str | Unset):  Example: 0195f5d6-7c20-7000-8000-000000000011.
            environment_id (str | Unset):
     """

    type_: RunnerChannelMessageType0Type
    runner_id: str | Unset = UNSET
    environment_id: str | Unset = UNSET





    def to_dict(self) -> dict[str, Any]:
        type_ = self.type_.value

        runner_id = self.runner_id

        environment_id = self.environment_id


        field_dict: dict[str, Any] = {}

        field_dict.update({
            "type": type_,
        })
        if runner_id is not UNSET:
            field_dict["runnerId"] = runner_id
        if environment_id is not UNSET:
            field_dict["environmentId"] = environment_id

        return field_dict



    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        type_ = RunnerChannelMessageType0Type(d.pop("type"))




        runner_id = d.pop("runnerId", UNSET)

        environment_id = d.pop("environmentId", UNSET)

        runner_channel_message_type_0 = cls(
            type_=type_,
            runner_id=runner_id,
            environment_id=environment_id,
        )

        return runner_channel_message_type_0
