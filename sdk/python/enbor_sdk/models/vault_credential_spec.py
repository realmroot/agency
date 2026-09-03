from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from ..models.vault_credential_spec_type import VaultCredentialSpecType
from typing import cast

if TYPE_CHECKING:
  from ..models.vault_credential_spec_metadata import VaultCredentialSpecMetadata





T = TypeVar("T", bound="VaultCredentialSpec")



@_attrs_define
class VaultCredentialSpec:
    """
        Attributes:
            vault_id (str):  Example: 0195f5d6-7c20-7000-8000-000000000007.
            organization_id (str):  Example: org_abc123.
            type_ (VaultCredentialSpecType):  Example: opaque.
            metadata (VaultCredentialSpecMetadata):  Example: {'owner': 'platform'}.
     """

    vault_id: str
    organization_id: str
    type_: VaultCredentialSpecType
    metadata: VaultCredentialSpecMetadata
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)





    def to_dict(self) -> dict[str, Any]:
        from ..models.vault_credential_spec_metadata import VaultCredentialSpecMetadata
        vault_id = self.vault_id

        organization_id = self.organization_id

        type_ = self.type_.value

        metadata = self.metadata.to_dict()


        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({
            "vaultId": vault_id,
            "organizationId": organization_id,
            "type": type_,
            "metadata": metadata,
        })

        return field_dict



    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.vault_credential_spec_metadata import VaultCredentialSpecMetadata
        d = dict(src_dict)
        vault_id = d.pop("vaultId")

        organization_id = d.pop("organizationId")

        type_ = VaultCredentialSpecType(d.pop("type"))




        metadata = VaultCredentialSpecMetadata.from_dict(d.pop("metadata"))




        vault_credential_spec = cls(
            vault_id=vault_id,
            organization_id=organization_id,
            type_=type_,
            metadata=metadata,
        )


        vault_credential_spec.additional_properties = d
        return vault_credential_spec

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
