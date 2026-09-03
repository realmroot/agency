from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from typing import cast

if TYPE_CHECKING:
  from ..models.resource_metadata import ResourceMetadata
  from ..models.vault_spec import VaultSpec
  from ..models.vault_status import VaultStatus





T = TypeVar("T", bound="Vault")



@_attrs_define
class Vault:
    """
        Attributes:
            metadata (ResourceMetadata):
            spec (VaultSpec):
            status (VaultStatus):
     """

    metadata: ResourceMetadata
    spec: VaultSpec
    status: VaultStatus
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)





    def to_dict(self) -> dict[str, Any]:
        from ..models.resource_metadata import ResourceMetadata
        from ..models.vault_spec import VaultSpec
        from ..models.vault_status import VaultStatus
        metadata = self.metadata.to_dict()

        spec = self.spec.to_dict()

        status = self.status.to_dict()


        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({
            "metadata": metadata,
            "spec": spec,
            "status": status,
        })

        return field_dict



    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.resource_metadata import ResourceMetadata
        from ..models.vault_spec import VaultSpec
        from ..models.vault_status import VaultStatus
        d = dict(src_dict)
        metadata = ResourceMetadata.from_dict(d.pop("metadata"))




        spec = VaultSpec.from_dict(d.pop("spec"))




        status = VaultStatus.from_dict(d.pop("status"))




        vault = cls(
            metadata=metadata,
            spec=spec,
            status=status,
        )


        vault.additional_properties = d
        return vault

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
