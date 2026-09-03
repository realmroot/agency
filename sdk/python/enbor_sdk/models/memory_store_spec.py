from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset







T = TypeVar("T", bound="MemoryStoreSpec")



@_attrs_define
class MemoryStoreSpec:
    """
     """






    def to_dict(self) -> dict[str, Any]:

        field_dict: dict[str, Any] = {}


        return field_dict



    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        memory_store_spec = cls(
        )

        return memory_store_spec
