from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from ..types import UNSET, Unset
from typing import cast

if TYPE_CHECKING:
  from ..models.create_memory_store_request_metadata import CreateMemoryStoreRequestMetadata
  from ..models.create_memory_store_request_spec import CreateMemoryStoreRequestSpec





T = TypeVar("T", bound="CreateMemoryStoreRequest")



@_attrs_define
class CreateMemoryStoreRequest:
    """
        Attributes:
            metadata (CreateMemoryStoreRequestMetadata):
            spec (CreateMemoryStoreRequestSpec | Unset):
     """

    metadata: CreateMemoryStoreRequestMetadata
    spec: CreateMemoryStoreRequestSpec | Unset = UNSET





    def to_dict(self) -> dict[str, Any]:
        from ..models.create_memory_store_request_metadata import CreateMemoryStoreRequestMetadata
        from ..models.create_memory_store_request_spec import CreateMemoryStoreRequestSpec
        metadata = self.metadata.to_dict()

        spec: dict[str, Any] | Unset = UNSET
        if not isinstance(self.spec, Unset):
            spec = self.spec.to_dict()


        field_dict: dict[str, Any] = {}

        field_dict.update({
            "metadata": metadata,
        })
        if spec is not UNSET:
            field_dict["spec"] = spec

        return field_dict



    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.create_memory_store_request_metadata import CreateMemoryStoreRequestMetadata
        from ..models.create_memory_store_request_spec import CreateMemoryStoreRequestSpec
        d = dict(src_dict)
        metadata = CreateMemoryStoreRequestMetadata.from_dict(d.pop("metadata"))




        _spec = d.pop("spec", UNSET)
        spec: CreateMemoryStoreRequestSpec | Unset
        if isinstance(_spec,  Unset):
            spec = UNSET
        else:
            spec = CreateMemoryStoreRequestSpec.from_dict(_spec)




        create_memory_store_request = cls(
            metadata=metadata,
            spec=spec,
        )

        return create_memory_store_request
