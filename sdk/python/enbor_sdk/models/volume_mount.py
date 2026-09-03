from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from ..types import UNSET, Unset






T = TypeVar("T", bound="VolumeMount")



@_attrs_define
class VolumeMount:
    """
        Attributes:
            name (str):  Example: github-token.
            mount_path (str):  Example: /workspace/.enbor/secrets/project.
            read_only (bool | Unset):  Example: True.
     """

    name: str
    mount_path: str
    read_only: bool | Unset = UNSET





    def to_dict(self) -> dict[str, Any]:
        name = self.name

        mount_path = self.mount_path

        read_only = self.read_only


        field_dict: dict[str, Any] = {}

        field_dict.update({
            "name": name,
            "mountPath": mount_path,
        })
        if read_only is not UNSET:
            field_dict["readOnly"] = read_only

        return field_dict



    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        name = d.pop("name")

        mount_path = d.pop("mountPath")

        read_only = d.pop("readOnly", UNSET)

        volume_mount = cls(
            name=name,
            mount_path=mount_path,
            read_only=read_only,
        )

        return volume_mount
