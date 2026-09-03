from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from ..types import UNSET, Unset
from typing import cast

if TYPE_CHECKING:
  from ..models.update_memory_store_memory_request_metadata import UpdateMemoryStoreMemoryRequestMetadata





T = TypeVar("T", bound="UpdateMemoryStoreMemoryRequest")



@_attrs_define
class UpdateMemoryStoreMemoryRequest:
    """
        Attributes:
            path (str | Unset):
            content (str | Unset):
            metadata (UpdateMemoryStoreMemoryRequestMetadata | Unset):
     """

    path: str | Unset = UNSET
    content: str | Unset = UNSET
    metadata: UpdateMemoryStoreMemoryRequestMetadata | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)





    def to_dict(self) -> dict[str, Any]:
        from ..models.update_memory_store_memory_request_metadata import UpdateMemoryStoreMemoryRequestMetadata
        path = self.path

        content = self.content

        metadata: dict[str, Any] | Unset = UNSET
        if not isinstance(self.metadata, Unset):
            metadata = self.metadata.to_dict()


        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({
        })
        if path is not UNSET:
            field_dict["path"] = path
        if content is not UNSET:
            field_dict["content"] = content
        if metadata is not UNSET:
            field_dict["metadata"] = metadata

        return field_dict



    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.update_memory_store_memory_request_metadata import UpdateMemoryStoreMemoryRequestMetadata
        d = dict(src_dict)
        path = d.pop("path", UNSET)

        content = d.pop("content", UNSET)

        _metadata = d.pop("metadata", UNSET)
        metadata: UpdateMemoryStoreMemoryRequestMetadata | Unset
        if isinstance(_metadata,  Unset):
            metadata = UNSET
        else:
            metadata = UpdateMemoryStoreMemoryRequestMetadata.from_dict(_metadata)




        update_memory_store_memory_request = cls(
            path=path,
            content=content,
            metadata=metadata,
        )


        update_memory_store_memory_request.additional_properties = d
        return update_memory_store_memory_request

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
