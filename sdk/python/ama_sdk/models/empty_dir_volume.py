from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from ..models.empty_dir_volume_type import EmptyDirVolumeType
from ..types import UNSET, Unset
from typing import cast

if TYPE_CHECKING:
  from ..models.secret_volume_projection import SecretVolumeProjection





T = TypeVar("T", bound="EmptyDirVolume")



@_attrs_define
class EmptyDirVolume:
    """
        Attributes:
            name (str):  Example: runtime-state.
            type_ (EmptyDirVolumeType):
            seed_from (list[SecretVolumeProjection] | Unset):
     """

    name: str
    type_: EmptyDirVolumeType
    seed_from: list[SecretVolumeProjection] | Unset = UNSET





    def to_dict(self) -> dict[str, Any]:
        from ..models.secret_volume_projection import SecretVolumeProjection
        name = self.name

        type_ = self.type_.value

        seed_from: list[dict[str, Any]] | Unset = UNSET
        if not isinstance(self.seed_from, Unset):
            seed_from = []
            for seed_from_item_data in self.seed_from:
                seed_from_item = seed_from_item_data.to_dict()
                seed_from.append(seed_from_item)




        field_dict: dict[str, Any] = {}

        field_dict.update({
            "name": name,
            "type": type_,
        })
        if seed_from is not UNSET:
            field_dict["seedFrom"] = seed_from

        return field_dict



    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.secret_volume_projection import SecretVolumeProjection
        d = dict(src_dict)
        name = d.pop("name")

        type_ = EmptyDirVolumeType(d.pop("type"))




        _seed_from = d.pop("seedFrom", UNSET)
        seed_from: list[SecretVolumeProjection] | Unset = UNSET
        if _seed_from is not UNSET:
            seed_from = []
            for seed_from_item_data in _seed_from:
                seed_from_item = SecretVolumeProjection.from_dict(seed_from_item_data)



                seed_from.append(seed_from_item)


        empty_dir_volume = cls(
            name=name,
            type_=type_,
            seed_from=seed_from,
        )

        return empty_dir_volume
