from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from ..models.secret_volume_projection_type import SecretVolumeProjectionType
from ..types import UNSET, Unset
from typing import cast

if TYPE_CHECKING:
  from ..models.secret_item import SecretItem





T = TypeVar("T", bound="SecretVolumeProjection")



@_attrs_define
class SecretVolumeProjection:
    """
        Attributes:
            type_ (SecretVolumeProjectionType):
            secret_ref (str):  Example: ama://vaults/vault_abc123/credentials/vaultcred_abc123.
            items (list[SecretItem] | Unset):
     """

    type_: SecretVolumeProjectionType
    secret_ref: str
    items: list[SecretItem] | Unset = UNSET





    def to_dict(self) -> dict[str, Any]:
        from ..models.secret_item import SecretItem
        type_ = self.type_.value

        secret_ref = self.secret_ref

        items: list[dict[str, Any]] | Unset = UNSET
        if not isinstance(self.items, Unset):
            items = []
            for items_item_data in self.items:
                items_item = items_item_data.to_dict()
                items.append(items_item)




        field_dict: dict[str, Any] = {}

        field_dict.update({
            "type": type_,
            "secretRef": secret_ref,
        })
        if items is not UNSET:
            field_dict["items"] = items

        return field_dict



    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.secret_item import SecretItem
        d = dict(src_dict)
        type_ = SecretVolumeProjectionType(d.pop("type"))




        secret_ref = d.pop("secretRef")

        _items = d.pop("items", UNSET)
        items: list[SecretItem] | Unset = UNSET
        if _items is not UNSET:
            items = []
            for items_item_data in _items:
                items_item = SecretItem.from_dict(items_item_data)



                items.append(items_item)


        secret_volume_projection = cls(
            type_=type_,
            secret_ref=secret_ref,
            items=items,
        )

        return secret_volume_projection
