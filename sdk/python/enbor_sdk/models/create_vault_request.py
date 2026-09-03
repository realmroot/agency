from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from typing import cast

if TYPE_CHECKING:
  from ..models.create_vault_request_metadata import CreateVaultRequestMetadata
  from ..models.create_vault_request_spec import CreateVaultRequestSpec





T = TypeVar("T", bound="CreateVaultRequest")



@_attrs_define
class CreateVaultRequest:
    """
        Attributes:
            metadata (CreateVaultRequestMetadata):
            spec (CreateVaultRequestSpec):
     """

    metadata: CreateVaultRequestMetadata
    spec: CreateVaultRequestSpec





    def to_dict(self) -> dict[str, Any]:
        from ..models.create_vault_request_metadata import CreateVaultRequestMetadata
        from ..models.create_vault_request_spec import CreateVaultRequestSpec
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
        from ..models.create_vault_request_metadata import CreateVaultRequestMetadata
        from ..models.create_vault_request_spec import CreateVaultRequestSpec
        d = dict(src_dict)
        metadata = CreateVaultRequestMetadata.from_dict(d.pop("metadata"))




        spec = CreateVaultRequestSpec.from_dict(d.pop("spec"))




        create_vault_request = cls(
            metadata=metadata,
            spec=spec,
        )

        return create_vault_request
