from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from ..models.update_vault_credential_request_state import UpdateVaultCredentialRequestState
from ..types import UNSET, Unset
from typing import cast

if TYPE_CHECKING:
  from ..models.update_vault_credential_request_metadata import UpdateVaultCredentialRequestMetadata





T = TypeVar("T", bound="UpdateVaultCredentialRequest")



@_attrs_define
class UpdateVaultCredentialRequest:
    """
        Attributes:
            state (UpdateVaultCredentialRequestState | Unset):  Example: revoked.
            revoke_reason (str | Unset):  Example: Replaced by scoped credential..
            metadata (UpdateVaultCredentialRequestMetadata | Unset):  Example: {'owner': 'platform'}.
     """

    state: UpdateVaultCredentialRequestState | Unset = UNSET
    revoke_reason: str | Unset = UNSET
    metadata: UpdateVaultCredentialRequestMetadata | Unset = UNSET





    def to_dict(self) -> dict[str, Any]:
        from ..models.update_vault_credential_request_metadata import UpdateVaultCredentialRequestMetadata
        state: str | Unset = UNSET
        if not isinstance(self.state, Unset):
            state = self.state.value


        revoke_reason = self.revoke_reason

        metadata: dict[str, Any] | Unset = UNSET
        if not isinstance(self.metadata, Unset):
            metadata = self.metadata.to_dict()


        field_dict: dict[str, Any] = {}

        field_dict.update({
        })
        if state is not UNSET:
            field_dict["state"] = state
        if revoke_reason is not UNSET:
            field_dict["revokeReason"] = revoke_reason
        if metadata is not UNSET:
            field_dict["metadata"] = metadata

        return field_dict



    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.update_vault_credential_request_metadata import UpdateVaultCredentialRequestMetadata
        d = dict(src_dict)
        _state = d.pop("state", UNSET)
        state: UpdateVaultCredentialRequestState | Unset
        if isinstance(_state,  Unset):
            state = UNSET
        else:
            state = UpdateVaultCredentialRequestState(_state)




        revoke_reason = d.pop("revokeReason", UNSET)

        _metadata = d.pop("metadata", UNSET)
        metadata: UpdateVaultCredentialRequestMetadata | Unset
        if isinstance(_metadata,  Unset):
            metadata = UNSET
        else:
            metadata = UpdateVaultCredentialRequestMetadata.from_dict(_metadata)




        update_vault_credential_request = cls(
            state=state,
            revoke_reason=revoke_reason,
            metadata=metadata,
        )

        return update_vault_credential_request
