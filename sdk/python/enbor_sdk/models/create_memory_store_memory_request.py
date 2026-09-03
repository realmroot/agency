from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from ..types import UNSET, Unset
from typing import cast

if TYPE_CHECKING:
  from ..models.create_memory_store_memory_request_metadata import CreateMemoryStoreMemoryRequestMetadata





T = TypeVar("T", bound="CreateMemoryStoreMemoryRequest")



@_attrs_define
class CreateMemoryStoreMemoryRequest:
    """
        Attributes:
            path (str):  Example: guides/review.md.
            content (str):  Example: Review for correctness first..
            metadata (CreateMemoryStoreMemoryRequestMetadata | Unset):
     """

    path: str
    content: str
    metadata: CreateMemoryStoreMemoryRequestMetadata | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)





    def to_dict(self) -> dict[str, Any]:
        from ..models.create_memory_store_memory_request_metadata import CreateMemoryStoreMemoryRequestMetadata
        path = self.path

        content = self.content

        metadata: dict[str, Any] | Unset = UNSET
        if not isinstance(self.metadata, Unset):
            metadata = self.metadata.to_dict()


        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({
            "path": path,
            "content": content,
        })
        if metadata is not UNSET:
            field_dict["metadata"] = metadata

        return field_dict



    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.create_memory_store_memory_request_metadata import CreateMemoryStoreMemoryRequestMetadata
        d = dict(src_dict)
        path = d.pop("path")

        content = d.pop("content")

        _metadata = d.pop("metadata", UNSET)
        metadata: CreateMemoryStoreMemoryRequestMetadata | Unset
        if isinstance(_metadata,  Unset):
            metadata = UNSET
        else:
            metadata = CreateMemoryStoreMemoryRequestMetadata.from_dict(_metadata)




        create_memory_store_memory_request = cls(
            path=path,
            content=content,
            metadata=metadata,
        )


        create_memory_store_memory_request.additional_properties = d
        return create_memory_store_memory_request

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
