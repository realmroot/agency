from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from ..models.memory_volume_type import MemoryVolumeType






T = TypeVar("T", bound="MemoryVolume")



@_attrs_define
class MemoryVolume:
    """ 
        Attributes:
            name (str):  Example: team-memory.
            type_ (MemoryVolumeType):
            memory_ref (str):  Example: ama://memories/memstore_abc123.
     """

    name: str
    type_: MemoryVolumeType
    memory_ref: str





    def to_dict(self) -> dict[str, Any]:
        name = self.name

        type_ = self.type_.value

        memory_ref = self.memory_ref


        field_dict: dict[str, Any] = {}

        field_dict.update({
            "name": name,
            "type": type_,
            "memoryRef": memory_ref,
        })

        return field_dict



    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        name = d.pop("name")

        type_ = MemoryVolumeType(d.pop("type"))




        memory_ref = d.pop("memoryRef")

        memory_volume = cls(
            name=name,
            type_=type_,
            memory_ref=memory_ref,
        )

        return memory_volume

