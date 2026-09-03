from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from ..models.vault_credential_status_phase import VaultCredentialStatusPhase
from typing import cast
import datetime

if TYPE_CHECKING:
  from ..models.vault_credential_version_type_0 import VaultCredentialVersionType0





T = TypeVar("T", bound="VaultCredentialStatus")



@_attrs_define
class VaultCredentialStatus:
    """
        Attributes:
            phase (VaultCredentialStatusPhase):  Example: active.
            active_version_id (None | str):  Example: 0195f5d6-7c20-7000-8000-000000000009.
            active_version (None | VaultCredentialVersionType0):
            revoked_at (datetime.datetime | None):
            revoked_by_user_id (None | str):
            revoke_reason (None | str):
     """

    phase: VaultCredentialStatusPhase
    active_version_id: None | str
    active_version: None | VaultCredentialVersionType0
    revoked_at: datetime.datetime | None
    revoked_by_user_id: None | str
    revoke_reason: None | str
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)





    def to_dict(self) -> dict[str, Any]:
        from ..models.vault_credential_version_type_0 import VaultCredentialVersionType0
        phase = self.phase.value

        active_version_id: None | str
        active_version_id = self.active_version_id

        active_version: dict[str, Any] | None
        if isinstance(self.active_version, VaultCredentialVersionType0):
            active_version = self.active_version.to_dict()
        else:
            active_version = self.active_version

        revoked_at: None | str
        if isinstance(self.revoked_at, datetime.datetime):
            revoked_at = self.revoked_at.isoformat()
        else:
            revoked_at = self.revoked_at

        revoked_by_user_id: None | str
        revoked_by_user_id = self.revoked_by_user_id

        revoke_reason: None | str
        revoke_reason = self.revoke_reason


        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({
            "phase": phase,
            "activeVersionId": active_version_id,
            "activeVersion": active_version,
            "revokedAt": revoked_at,
            "revokedByUserId": revoked_by_user_id,
            "revokeReason": revoke_reason,
        })

        return field_dict



    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.vault_credential_version_type_0 import VaultCredentialVersionType0
        d = dict(src_dict)
        phase = VaultCredentialStatusPhase(d.pop("phase"))




        def _parse_active_version_id(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        active_version_id = _parse_active_version_id(d.pop("activeVersionId"))


        def _parse_active_version(data: object) -> None | VaultCredentialVersionType0:
            if data is None:
                return data
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                componentsschemas_vault_credential_version_type_0 = VaultCredentialVersionType0.from_dict(data)



                return componentsschemas_vault_credential_version_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(None | VaultCredentialVersionType0, data)

        active_version = _parse_active_version(d.pop("activeVersion"))


        def _parse_revoked_at(data: object) -> datetime.datetime | None:
            if data is None:
                return data
            try:
                if not isinstance(data, str):
                    raise TypeError()
                revoked_at_type_0 = datetime.datetime.fromisoformat(data)



                return revoked_at_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(datetime.datetime | None, data)

        revoked_at = _parse_revoked_at(d.pop("revokedAt"))


        def _parse_revoked_by_user_id(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        revoked_by_user_id = _parse_revoked_by_user_id(d.pop("revokedByUserId"))


        def _parse_revoke_reason(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        revoke_reason = _parse_revoke_reason(d.pop("revokeReason"))


        vault_credential_status = cls(
            phase=phase,
            active_version_id=active_version_id,
            active_version=active_version,
            revoked_at=revoked_at,
            revoked_by_user_id=revoked_by_user_id,
            revoke_reason=revoke_reason,
        )


        vault_credential_status.additional_properties = d
        return vault_credential_status

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
