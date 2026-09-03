from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from ..models.runner_sandbox_request_type import RunnerSandboxRequestType
from ..types import UNSET, Unset
from typing import cast

if TYPE_CHECKING:
  from ..models.runner_sandbox_request_input import RunnerSandboxRequestInput
  from ..models.runner_volume import RunnerVolume
  from ..models.runner_volume_mount import RunnerVolumeMount





T = TypeVar("T", bound="RunnerSandboxRequest")



@_attrs_define
class RunnerSandboxRequest:
    """
        Attributes:
            type_ (RunnerSandboxRequestType):  Example: sandbox.execute.
            tool_call_id (str | Unset):  Example: call_abc123.
            tool_name (str | Unset):  Example: bash.
            input_ (RunnerSandboxRequestInput | Unset):
            volumes (list[RunnerVolume] | Unset):
            volume_mounts (list[RunnerVolumeMount] | Unset):
     """

    type_: RunnerSandboxRequestType
    tool_call_id: str | Unset = UNSET
    tool_name: str | Unset = UNSET
    input_: RunnerSandboxRequestInput | Unset = UNSET
    volumes: list[RunnerVolume] | Unset = UNSET
    volume_mounts: list[RunnerVolumeMount] | Unset = UNSET





    def to_dict(self) -> dict[str, Any]:
        from ..models.runner_sandbox_request_input import RunnerSandboxRequestInput
        from ..models.runner_volume import RunnerVolume
        from ..models.runner_volume_mount import RunnerVolumeMount
        type_ = self.type_.value

        tool_call_id = self.tool_call_id

        tool_name = self.tool_name

        input_: dict[str, Any] | Unset = UNSET
        if not isinstance(self.input_, Unset):
            input_ = self.input_.to_dict()

        volumes: list[dict[str, Any]] | Unset = UNSET
        if not isinstance(self.volumes, Unset):
            volumes = []
            for volumes_item_data in self.volumes:
                volumes_item = volumes_item_data.to_dict()
                volumes.append(volumes_item)



        volume_mounts: list[dict[str, Any]] | Unset = UNSET
        if not isinstance(self.volume_mounts, Unset):
            volume_mounts = []
            for volume_mounts_item_data in self.volume_mounts:
                volume_mounts_item = volume_mounts_item_data.to_dict()
                volume_mounts.append(volume_mounts_item)




        field_dict: dict[str, Any] = {}

        field_dict.update({
            "type": type_,
        })
        if tool_call_id is not UNSET:
            field_dict["toolCallId"] = tool_call_id
        if tool_name is not UNSET:
            field_dict["toolName"] = tool_name
        if input_ is not UNSET:
            field_dict["input"] = input_
        if volumes is not UNSET:
            field_dict["volumes"] = volumes
        if volume_mounts is not UNSET:
            field_dict["volumeMounts"] = volume_mounts

        return field_dict



    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.runner_sandbox_request_input import RunnerSandboxRequestInput
        from ..models.runner_volume import RunnerVolume
        from ..models.runner_volume_mount import RunnerVolumeMount
        d = dict(src_dict)
        type_ = RunnerSandboxRequestType(d.pop("type"))




        tool_call_id = d.pop("toolCallId", UNSET)

        tool_name = d.pop("toolName", UNSET)

        _input_ = d.pop("input", UNSET)
        input_: RunnerSandboxRequestInput | Unset
        if isinstance(_input_,  Unset):
            input_ = UNSET
        else:
            input_ = RunnerSandboxRequestInput.from_dict(_input_)




        _volumes = d.pop("volumes", UNSET)
        volumes: list[RunnerVolume] | Unset = UNSET
        if _volumes is not UNSET:
            volumes = []
            for volumes_item_data in _volumes:
                volumes_item = RunnerVolume.from_dict(volumes_item_data)



                volumes.append(volumes_item)


        _volume_mounts = d.pop("volumeMounts", UNSET)
        volume_mounts: list[RunnerVolumeMount] | Unset = UNSET
        if _volume_mounts is not UNSET:
            volume_mounts = []
            for volume_mounts_item_data in _volume_mounts:
                volume_mounts_item = RunnerVolumeMount.from_dict(volume_mounts_item_data)



                volume_mounts.append(volume_mounts_item)


        runner_sandbox_request = cls(
            type_=type_,
            tool_call_id=tool_call_id,
            tool_name=tool_name,
            input_=input_,
            volumes=volumes,
            volume_mounts=volume_mounts,
        )

        return runner_sandbox_request
