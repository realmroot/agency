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
  from ..models.update_vault_request_spec import UpdateVaultRequestSpec





T = TypeVar("T", bound="UpdateVaultRequest")



@_attrs_define
class UpdateVaultRequest:
    """
        Attributes:
            metadata (ResourceUpdateMetadata | Unset):
            spec (UpdateVaultRequestSpec | Unset):
     """

    metadata: ResourceUpdateMetadata | Unset = UNSET
    spec: UpdateVaultRequestSpec | Unset = UNSET





    def to_dict(self) -> dict[str, Any]:
        from ..models.resource_update_metadata import ResourceUpdateMetadata
        from ..models.update_vault_request_spec import UpdateVaultRequestSpec
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
        from ..models.update_vault_request_spec import UpdateVaultRequestSpec
        d = dict(src_dict)
        _metadata = d.pop("metadata", UNSET)
        metadata: ResourceUpdateMetadata | Unset
        if isinstance(_metadata,  Unset):
            metadata = UNSET
        else:
            metadata = ResourceUpdateMetadata.from_dict(_metadata)




        _spec = d.pop("spec", UNSET)
        spec: UpdateVaultRequestSpec | Unset
        if isinstance(_spec,  Unset):
            spec = UNSET
        else:
            spec = UpdateVaultRequestSpec.from_dict(_spec)




        update_vault_request = cls(
            metadata=metadata,
            spec=spec,
        )

        return update_vault_request
