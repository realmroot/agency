from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from ..models.vault_credential_version_status_phase import VaultCredentialVersionStatusPhase
from typing import cast
import datetime






T = TypeVar("T", bound="VaultCredentialVersionStatus")



@_attrs_define
class VaultCredentialVersionStatus:
    """
        Attributes:
            phase (VaultCredentialVersionStatusPhase):  Example: active.
            superseded_at (datetime.datetime | None):  Example: 2026-05-24T01:00:00.000Z.
            revoked_at (datetime.datetime | None):
     """

    phase: VaultCredentialVersionStatusPhase
    superseded_at: datetime.datetime | None
    revoked_at: datetime.datetime | None
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)





    def to_dict(self) -> dict[str, Any]:
        phase = self.phase.value

        superseded_at: None | str
        if isinstance(self.superseded_at, datetime.datetime):
            superseded_at = self.superseded_at.isoformat()
        else:
            superseded_at = self.superseded_at

        revoked_at: None | str
        if isinstance(self.revoked_at, datetime.datetime):
            revoked_at = self.revoked_at.isoformat()
        else:
            revoked_at = self.revoked_at


        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({
            "phase": phase,
            "supersededAt": superseded_at,
            "revokedAt": revoked_at,
        })

        return field_dict



    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        phase = VaultCredentialVersionStatusPhase(d.pop("phase"))




        def _parse_superseded_at(data: object) -> datetime.datetime | None:
            if data is None:
                return data
            try:
                if not isinstance(data, str):
                    raise TypeError()
                superseded_at_type_0 = datetime.datetime.fromisoformat(data)



                return superseded_at_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(datetime.datetime | None, data)

        superseded_at = _parse_superseded_at(d.pop("supersededAt"))


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


        vault_credential_version_status = cls(
            phase=phase,
            superseded_at=superseded_at,
            revoked_at=revoked_at,
        )


        vault_credential_version_status.additional_properties = d
        return vault_credential_version_status

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
