from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from ..models.env_from_entry_type import EnvFromEntryType
from ..types import UNSET, Unset






T = TypeVar("T", bound="EnvFromEntry")



@_attrs_define
class EnvFromEntry:
    """ 
        Attributes:
            type_ (EnvFromEntryType):  Example: secret.
            secret_ref (str):  Example: ama://vaults/vault_abc123/credentials/vaultcred_abc123.
            name (str | Unset):  Example: API_TOKEN.
            key (str | Unset):  Example: token.
     """

    type_: EnvFromEntryType
    secret_ref: str
    name: str | Unset = UNSET
    key: str | Unset = UNSET





    def to_dict(self) -> dict[str, Any]:
        type_ = self.type_.value

        secret_ref = self.secret_ref

        name = self.name

        key = self.key


        field_dict: dict[str, Any] = {}

        field_dict.update({
            "type": type_,
            "secretRef": secret_ref,
        })
        if name is not UNSET:
            field_dict["name"] = name
        if key is not UNSET:
            field_dict["key"] = key

        return field_dict



    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        type_ = EnvFromEntryType(d.pop("type"))




        secret_ref = d.pop("secretRef")

        name = d.pop("name", UNSET)

        key = d.pop("key", UNSET)

        env_from_entry = cls(
            type_=type_,
            secret_ref=secret_ref,
            name=name,
            key=key,
        )

        return env_from_entry

