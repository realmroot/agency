from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from ..types import UNSET, Unset
from typing import cast

if TYPE_CHECKING:
  from ..models.create_vault_credential_request_secret_metadata import CreateVaultCredentialRequestSecretMetadata
  from ..models.create_vault_credential_request_secret_string_data import CreateVaultCredentialRequestSecretStringData





T = TypeVar("T", bound="CreateVaultCredentialRequestSecret")



@_attrs_define
class CreateVaultCredentialRequestSecret:
    """
        Example:
            {'stringData': {'token': 'input-only'}}

        Attributes:
            string_data (CreateVaultCredentialRequestSecretStringData):  Example: {'token': 'redacted-input-only'}.
            reference_name (str | Unset):  Example: ENBOR_PROJECT_TOKEN.
            metadata (CreateVaultCredentialRequestSecretMetadata | Unset):  Example: {'source': 'console'}.
     """

    string_data: CreateVaultCredentialRequestSecretStringData
    reference_name: str | Unset = UNSET
    metadata: CreateVaultCredentialRequestSecretMetadata | Unset = UNSET





    def to_dict(self) -> dict[str, Any]:
        from ..models.create_vault_credential_request_secret_metadata import CreateVaultCredentialRequestSecretMetadata
        from ..models.create_vault_credential_request_secret_string_data import CreateVaultCredentialRequestSecretStringData
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
        from ..models.create_vault_credential_request_secret_metadata import CreateVaultCredentialRequestSecretMetadata
        from ..models.create_vault_credential_request_secret_string_data import CreateVaultCredentialRequestSecretStringData
        d = dict(src_dict)
        string_data = CreateVaultCredentialRequestSecretStringData.from_dict(d.pop("stringData"))




        reference_name = d.pop("referenceName", UNSET)

        _metadata = d.pop("metadata", UNSET)
        metadata: CreateVaultCredentialRequestSecretMetadata | Unset
        if isinstance(_metadata,  Unset):
            metadata = UNSET
        else:
            metadata = CreateVaultCredentialRequestSecretMetadata.from_dict(_metadata)




        create_vault_credential_request_secret = cls(
            string_data=string_data,
            reference_name=reference_name,
            metadata=metadata,
        )

        return create_vault_credential_request_secret
