from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from ..types import UNSET, Unset
from typing import cast

if TYPE_CHECKING:
  from ..models.update_vault_credential_secret_request_metadata import UpdateVaultCredentialSecretRequestMetadata
  from ..models.update_vault_credential_secret_request_string_data import UpdateVaultCredentialSecretRequestStringData





T = TypeVar("T", bound="UpdateVaultCredentialSecretRequest")



@_attrs_define
class UpdateVaultCredentialSecretRequest:
    """
        Attributes:
            string_data (UpdateVaultCredentialSecretRequestStringData):  Example: {'token': 'redacted-input-only'}.
            reference_name (str | Unset):  Example: AMA_PROJECT_TOKEN.
            metadata (UpdateVaultCredentialSecretRequestMetadata | Unset):  Example: {'source': 'console'}.
     """

    string_data: UpdateVaultCredentialSecretRequestStringData
    reference_name: str | Unset = UNSET
    metadata: UpdateVaultCredentialSecretRequestMetadata | Unset = UNSET





    def to_dict(self) -> dict[str, Any]:
        from ..models.update_vault_credential_secret_request_metadata import UpdateVaultCredentialSecretRequestMetadata
        from ..models.update_vault_credential_secret_request_string_data import UpdateVaultCredentialSecretRequestStringData
        string_data = self.string_data.to_dict()

        reference_name = self.reference_name

        metadata: dict[str, Any] | Unset = UNSET
        if not isinstance(self.metadata, Unset):
            metadata = self.metadata.to_dict()


        field_dict: dict[str, Any] = {}

        field_dict.update({
            "stringData": string_data,
        })
        if reference_name is not UNSET:
            field_dict["referenceName"] = reference_name
        if metadata is not UNSET:
            field_dict["metadata"] = metadata

        return field_dict



    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.update_vault_credential_secret_request_metadata import UpdateVaultCredentialSecretRequestMetadata
        from ..models.update_vault_credential_secret_request_string_data import UpdateVaultCredentialSecretRequestStringData
        d = dict(src_dict)
        string_data = UpdateVaultCredentialSecretRequestStringData.from_dict(d.pop("stringData"))




        reference_name = d.pop("referenceName", UNSET)

        _metadata = d.pop("metadata", UNSET)
        metadata: UpdateVaultCredentialSecretRequestMetadata | Unset
        if isinstance(_metadata,  Unset):
            metadata = UNSET
        else:
            metadata = UpdateVaultCredentialSecretRequestMetadata.from_dict(_metadata)




        update_vault_credential_secret_request = cls(
            string_data=string_data,
            reference_name=reference_name,
            metadata=metadata,
        )

        return update_vault_credential_secret_request
