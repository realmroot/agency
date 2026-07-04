from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset







T = TypeVar("T", bound="SecretItem")



@_attrs_define
class SecretItem:
    """ 
        Attributes:
            key (str):  Example: GH_TOKEN.
            path (str):  Example: password.
     """

    key: str
    path: str





    def to_dict(self) -> dict[str, Any]:
        key = self.key

        path = self.path


        field_dict: dict[str, Any] = {}

        field_dict.update({
            "key": key,
            "path": path,
        })

        return field_dict



    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        key = d.pop("key")

        path = d.pop("path")

        secret_item = cls(
            key=key,
            path=path,
        )

        return secret_item

