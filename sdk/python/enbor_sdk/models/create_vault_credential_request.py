from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from ..models.create_vault_credential_request_type import CreateVaultCredentialRequestType
from ..types import UNSET, Unset
from typing import cast

if TYPE_CHECKING:
  from ..models.create_vault_credential_request_metadata import CreateVaultCredentialRequestMetadata
  from ..models.create_vault_credential_request_secret import CreateVaultCredentialRequestSecret





T = TypeVar("T", bound="CreateVaultCredentialRequest")



@_attrs_define
class CreateVaultCredentialRequest:
    """
        Attributes:
            name (str):  Example: Workers AI token.
            type_ (CreateVaultCredentialRequestType):  Example: opaque.
            secret (CreateVaultCredentialRequestSecret):  Example: {'stringData': {'token': 'input-only'}}.
            metadata (CreateVaultCredentialRequestMetadata | Unset):  Example: {'owner': 'platform'}.
     """

    name: str
    type_: CreateVaultCredentialRequestType
    secret: CreateVaultCredentialRequestSecret
    metadata: CreateVaultCredentialRequestMetadata | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)





    def to_dict(self) -> dict[str, Any]:
        from ..models.create_vault_credential_request_metadata import CreateVaultCredentialRequestMetadata
        from ..models.create_vault_credential_request_secret import CreateVaultCredentialRequestSecret
        name = self.name

        type_ = self.type_.value

        secret = self.secret.to_dict()

        metadata: dict[str, Any] | Unset = UNSET
        if not isinstance(self.metadata, Unset):
            metadata = self.metadata.to_dict()


        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({
            "name": name,
            "type": type_,
            "secret": secret,
        })
        if metadata is not UNSET:
            field_dict["metadata"] = metadata

        return field_dict



    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.create_vault_credential_request_metadata import CreateVaultCredentialRequestMetadata
        from ..models.create_vault_credential_request_secret import CreateVaultCredentialRequestSecret
        d = dict(src_dict)
        name = d.pop("name")

        type_ = CreateVaultCredentialRequestType(d.pop("type"))




        secret = CreateVaultCredentialRequestSecret.from_dict(d.pop("secret"))




        _metadata = d.pop("metadata", UNSET)
        metadata: CreateVaultCredentialRequestMetadata | Unset
        if isinstance(_metadata,  Unset):
            metadata = UNSET
        else:
            metadata = CreateVaultCredentialRequestMetadata.from_dict(_metadata)




        create_vault_credential_request = cls(
            name=name,
            type_=type_,
            secret=secret,
            metadata=metadata,
        )


        create_vault_credential_request.additional_properties = d
        return create_vault_credential_request

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
