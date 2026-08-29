from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from typing import cast

if TYPE_CHECKING:
  from ..models.create_identity_request_spec import CreateIdentityRequestSpec
  from ..models.resource_create_metadata import ResourceCreateMetadata





T = TypeVar("T", bound="CreateIdentityRequest")



@_attrs_define
class CreateIdentityRequest:
    """
        Attributes:
            metadata (ResourceCreateMetadata):  Example: {'name': 'Research assistant'}.
            spec (CreateIdentityRequestSpec):
     """

    metadata: ResourceCreateMetadata
    spec: CreateIdentityRequestSpec





    def to_dict(self) -> dict[str, Any]:
        from ..models.create_identity_request_spec import CreateIdentityRequestSpec
        from ..models.resource_create_metadata import ResourceCreateMetadata
        metadata = self.metadata.to_dict()

        spec = self.spec.to_dict()


        field_dict: dict[str, Any] = {}

        field_dict.update({
            "metadata": metadata,
            "spec": spec,
        })

        return field_dict



    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.create_identity_request_spec import CreateIdentityRequestSpec
        from ..models.resource_create_metadata import ResourceCreateMetadata
        d = dict(src_dict)
        metadata = ResourceCreateMetadata.from_dict(d.pop("metadata"))




        spec = CreateIdentityRequestSpec.from_dict(d.pop("spec"))




        create_identity_request = cls(
            metadata=metadata,
            spec=spec,
        )

        return create_identity_request
