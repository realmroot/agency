from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from ..models.runner_volume_type import RunnerVolumeType
from ..types import UNSET, Unset






T = TypeVar("T", bound="RunnerVolume")



@_attrs_define
class RunnerVolume:
    """ 
        Attributes:
            name (str):  Example: source.
            type_ (RunnerVolumeType):  Example: git_repository.
            secret_ref (str | Unset):
            url (str | Unset):  Example: https://github.com/saltbo/any-managed-agents.git.
            ref (str | Unset):  Example: main.
            memory_ref (str | Unset):  Example: ama://memories/memstore_abc123.
     """

    name: str
    type_: RunnerVolumeType
    secret_ref: str | Unset = UNSET
    url: str | Unset = UNSET
    ref: str | Unset = UNSET
    memory_ref: str | Unset = UNSET





    def to_dict(self) -> dict[str, Any]:
        name = self.name

        type_ = self.type_.value

        secret_ref = self.secret_ref

        url = self.url

        ref = self.ref

        memory_ref = self.memory_ref


        field_dict: dict[str, Any] = {}

        field_dict.update({
            "name": name,
            "type": type_,
        })
        if secret_ref is not UNSET:
            field_dict["secretRef"] = secret_ref
        if url is not UNSET:
            field_dict["url"] = url
        if ref is not UNSET:
            field_dict["ref"] = ref
        if memory_ref is not UNSET:
            field_dict["memoryRef"] = memory_ref

        return field_dict



    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        name = d.pop("name")

        type_ = RunnerVolumeType(d.pop("type"))




        secret_ref = d.pop("secretRef", UNSET)

        url = d.pop("url", UNSET)

        ref = d.pop("ref", UNSET)

        memory_ref = d.pop("memoryRef", UNSET)

        runner_volume = cls(
            name=name,
            type_=type_,
            secret_ref=secret_ref,
            url=url,
            ref=ref,
            memory_ref=memory_ref,
        )

        return runner_volume

