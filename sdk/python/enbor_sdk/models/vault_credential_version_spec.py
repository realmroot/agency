from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from ..models.vault_credential_version_spec_provider import VaultCredentialVersionSpecProvider
from typing import cast

if TYPE_CHECKING:
  from ..models.vault_json_object import VaultJsonObject





T = TypeVar("T", bound="VaultCredentialVersionSpec")



@_attrs_define
class VaultCredentialVersionSpec:
    """
        Attributes:
            credential_id (str):  Example: 0195f5d6-7c20-7000-8000-000000000008.
            vault_id (str):  Example: 0195f5d6-7c20-7000-8000-000000000007.
            organization_id (str):  Example: org_abc123.
            version (int):  Example: 2.
            provider (VaultCredentialVersionSpecProvider):  Example: ama.
            secret_ref (str):  Example: ama://vaults/0195f5d6-7c20-7000-8000-000000000007/credentials/0195f5d6-7c20-7000-
                8000-000000000008/versions/0195f5d6-7c20-7000-8000-000000000009.
            reference_name (str):  Example: AMA_PROJECT_ABC123_TOKEN_V2.
            has_secret (bool):  Example: True.
            data_keys (list[str]):  Example: ['token'].
            metadata (VaultJsonObject):  Example: {'rotatedBy': 'operator'}.
     """

    credential_id: str
    vault_id: str
    organization_id: str
    version: int
    provider: VaultCredentialVersionSpecProvider
    secret_ref: str
    reference_name: str
    has_secret: bool
    data_keys: list[str]
    metadata: VaultJsonObject
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)





    def to_dict(self) -> dict[str, Any]:
        from ..models.vault_json_object import VaultJsonObject
        credential_id = self.credential_id

        vault_id = self.vault_id

        organization_id = self.organization_id

        version = self.version

        provider = self.provider.value

        secret_ref = self.secret_ref

        reference_name = self.reference_name

        has_secret = self.has_secret

        data_keys = self.data_keys



        metadata = self.metadata.to_dict()


        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({
            "credentialId": credential_id,
            "vaultId": vault_id,
            "organizationId": organization_id,
            "version": version,
            "provider": provider,
            "secretRef": secret_ref,
            "referenceName": reference_name,
            "hasSecret": has_secret,
            "dataKeys": data_keys,
            "metadata": metadata,
        })

        return field_dict



    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.vault_json_object import VaultJsonObject
        d = dict(src_dict)
        credential_id = d.pop("credentialId")

        vault_id = d.pop("vaultId")

        organization_id = d.pop("organizationId")

        version = d.pop("version")

        provider = VaultCredentialVersionSpecProvider(d.pop("provider"))




        secret_ref = d.pop("secretRef")

        reference_name = d.pop("referenceName")

        has_secret = d.pop("hasSecret")

        data_keys = cast(list[str], d.pop("dataKeys"))


        metadata = VaultJsonObject.from_dict(d.pop("metadata"))




        vault_credential_version_spec = cls(
            credential_id=credential_id,
            vault_id=vault_id,
            organization_id=organization_id,
            version=version,
            provider=provider,
            secret_ref=secret_ref,
            reference_name=reference_name,
            has_secret=has_secret,
            data_keys=data_keys,
            metadata=metadata,
        )


        vault_credential_version_spec.additional_properties = d
        return vault_credential_version_spec

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
