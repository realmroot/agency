from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from ..models.runner_channel_message_type_1_type import RunnerChannelMessageType1Type
from ..types import UNSET, Unset
from typing import cast

if TYPE_CHECKING:
  from ..models.runner_opaque_json_object import RunnerOpaqueJsonObject





T = TypeVar("T", bound="RunnerChannelMessageType1")



@_attrs_define
class RunnerChannelMessageType1:
    """
        Attributes:
            type_ (RunnerChannelMessageType1Type):
            lease (RunnerOpaqueJsonObject):
            work_item (RunnerOpaqueJsonObject):
            runner_id (str | Unset):  Example: 0195f5d6-7c20-7000-8000-000000000011.
     """

    type_: RunnerChannelMessageType1Type
    lease: RunnerOpaqueJsonObject
    work_item: RunnerOpaqueJsonObject
    runner_id: str | Unset = UNSET





    def to_dict(self) -> dict[str, Any]:
        from ..models.runner_opaque_json_object import RunnerOpaqueJsonObject
        type_ = self.type_.value

        lease = self.lease.to_dict()

        work_item = self.work_item.to_dict()

        runner_id = self.runner_id


        field_dict: dict[str, Any] = {}

        field_dict.update({
            "type": type_,
            "lease": lease,
            "workItem": work_item,
        })
        if runner_id is not UNSET:
            field_dict["runnerId"] = runner_id

        return field_dict



    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.runner_opaque_json_object import RunnerOpaqueJsonObject
        d = dict(src_dict)
        type_ = RunnerChannelMessageType1Type(d.pop("type"))




        lease = RunnerOpaqueJsonObject.from_dict(d.pop("lease"))




        work_item = RunnerOpaqueJsonObject.from_dict(d.pop("workItem"))




        runner_id = d.pop("runnerId", UNSET)

        runner_channel_message_type_1 = cls(
            type_=type_,
            lease=lease,
            work_item=work_item,
            runner_id=runner_id,
        )

        return runner_channel_message_type_1
