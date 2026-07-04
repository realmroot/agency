from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from ..models.git_repository_volume_type import GitRepositoryVolumeType
from ..types import UNSET, Unset
from typing import cast

if TYPE_CHECKING:
  from ..models.secret_item import SecretItem





T = TypeVar("T", bound="GitRepositoryVolume")



@_attrs_define
class GitRepositoryVolume:
    """ 
        Attributes:
            name (str):  Example: source.
            type_ (GitRepositoryVolumeType):
            url (str):  Example: https://github.com/saltbo/any-managed-agents.git.
            ref (str | Unset):
            secret_ref (str | Unset):  Example: ama://vaults/vault_abc123.
            items (list[SecretItem] | Unset):
     """

    name: str
    type_: GitRepositoryVolumeType
    url: str
    ref: str | Unset = UNSET
    secret_ref: str | Unset = UNSET
    items: list[SecretItem] | Unset = UNSET





    def to_dict(self) -> dict[str, Any]:
        from ..models.secret_item import SecretItem
        name = self.name

        type_ = self.type_.value

        url = self.url

        ref = self.ref

        secret_ref = self.secret_ref

        items: list[dict[str, Any]] | Unset = UNSET
        if not isinstance(self.items, Unset):
            items = []
            for items_item_data in self.items:
                items_item = items_item_data.to_dict()
                items.append(items_item)




        field_dict: dict[str, Any] = {}

        field_dict.update({
            "name": name,
            "type": type_,
            "url": url,
        })
        if ref is not UNSET:
            field_dict["ref"] = ref
        if secret_ref is not UNSET:
            field_dict["secretRef"] = secret_ref
        if items is not UNSET:
            field_dict["items"] = items

        return field_dict



    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.secret_item import SecretItem
        d = dict(src_dict)
        name = d.pop("name")

        type_ = GitRepositoryVolumeType(d.pop("type"))




        url = d.pop("url")

        ref = d.pop("ref", UNSET)

        secret_ref = d.pop("secretRef", UNSET)

        _items = d.pop("items", UNSET)
        items: list[SecretItem] | Unset = UNSET
        if _items is not UNSET:
            items = []
            for items_item_data in _items:
                items_item = SecretItem.from_dict(items_item_data)



                items.append(items_item)


        git_repository_volume = cls(
            name=name,
            type_=type_,
            url=url,
            ref=ref,
            secret_ref=secret_ref,
            items=items,
        )

        return git_repository_volume

