from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from ..types import UNSET, Unset
from typing import cast

if TYPE_CHECKING:
  from ..models.resource_update_metadata import ResourceUpdateMetadata
  from ..models.update_memory_store_request_spec import UpdateMemoryStoreRequestSpec





T = TypeVar("T", bound="UpdateMemoryStoreRequest")



@_attrs_define
class UpdateMemoryStoreRequest:
    """
        Attributes:
            metadata (ResourceUpdateMetadata | Unset):
            spec (UpdateMemoryStoreRequestSpec | Unset):
     """

    metadata: ResourceUpdateMetadata | Unset = UNSET
    spec: UpdateMemoryStoreRequestSpec | Unset = UNSET





    def to_dict(self) -> dict[str, Any]:
        from ..models.resource_update_metadata import ResourceUpdateMetadata
        from ..models.update_memory_store_request_spec import UpdateMemoryStoreRequestSpec
        metadata: dict[str, Any] | Unset = UNSET
        if not isinstance(self.metadata, Unset):
            metadata = self.metadata.to_dict()

        spec: dict[str, Any] | Unset = UNSET
        if not isinstance(self.spec, Unset):
            spec = self.spec.to_dict()


        field_dict: dict[str, Any] = {}

        field_dict.update({
        })
        if metadata is not UNSET:
            field_dict["metadata"] = metadata
        if spec is not UNSET:
            field_dict["spec"] = spec

        return field_dict



    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.resource_update_metadata import ResourceUpdateMetadata
        from ..models.update_memory_store_request_spec import UpdateMemoryStoreRequestSpec
        d = dict(src_dict)
        _metadata = d.pop("metadata", UNSET)
        metadata: ResourceUpdateMetadata | Unset
        if isinstance(_metadata,  Unset):
            metadata = UNSET
        else:
            metadata = ResourceUpdateMetadata.from_dict(_metadata)




        _spec = d.pop("spec", UNSET)
        spec: UpdateMemoryStoreRequestSpec | Unset
        if isinstance(_spec,  Unset):
            spec = UNSET
        else:
            spec = UpdateMemoryStoreRequestSpec.from_dict(_spec)




        update_memory_store_request = cls(
            metadata=metadata,
            spec=spec,
        )

        return update_memory_store_request
