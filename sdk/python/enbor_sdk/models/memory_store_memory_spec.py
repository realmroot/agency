from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from typing import cast

if TYPE_CHECKING:
  from ..models.memory_store_memory_spec_metadata import MemoryStoreMemorySpecMetadata





T = TypeVar("T", bound="MemoryStoreMemorySpec")



@_attrs_define
class MemoryStoreMemorySpec:
    """
        Attributes:
            store_id (str):  Example: 0195f5d6-7c20-7000-8000-00000000000a.
            path (str):  Example: guides/review.md.
            content (str):  Example: Review for correctness first..
            metadata (MemoryStoreMemorySpecMetadata):
     """

    store_id: str
    path: str
    content: str
    metadata: MemoryStoreMemorySpecMetadata
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)





    def to_dict(self) -> dict[str, Any]:
        from ..models.memory_store_memory_spec_metadata import MemoryStoreMemorySpecMetadata
        store_id = self.store_id

        path = self.path

        content = self.content

        metadata = self.metadata.to_dict()


        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({
            "storeId": store_id,
            "path": path,
            "content": content,
            "metadata": metadata,
        })

        return field_dict



    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.memory_store_memory_spec_metadata import MemoryStoreMemorySpecMetadata
        d = dict(src_dict)
        store_id = d.pop("storeId")

        path = d.pop("path")

        content = d.pop("content")

        metadata = MemoryStoreMemorySpecMetadata.from_dict(d.pop("metadata"))




        memory_store_memory_spec = cls(
            store_id=store_id,
            path=path,
            content=content,
            metadata=metadata,
        )


        memory_store_memory_spec.additional_properties = d
        return memory_store_memory_spec

    @property
    def additional_keys(self) -> list[str]:
        return list(self.additional_properties.keys())

    def __getitem__(self, key: str) -> Any:
        return self.additional_properties[key]

    def __setitem__(self, key: str, value: Any) -> None:
        self.additional_properties[key] = value

    def __delitem__(self, key: str) -> None:
        del self.additional_properties[key]

    def __contains__(self, key: str) -> bool:
        return key in self.additional_properties
