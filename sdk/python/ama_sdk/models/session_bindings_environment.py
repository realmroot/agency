from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from typing import cast

if TYPE_CHECKING:
  from ..models.session_environment_snapshot_type_0 import SessionEnvironmentSnapshotType0





T = TypeVar("T", bound="SessionBindingsEnvironment")



@_attrs_define
class SessionBindingsEnvironment:
    """
        Attributes:
            id (None | str):  Example: 0195f5d6-7c20-7000-8000-000000000005.
            version_id (None | str):  Example: 0195f5d6-7c20-7000-8000-000000000006.
            snapshot (None | SessionEnvironmentSnapshotType0):
     """

    id: None | str
    version_id: None | str
    snapshot: None | SessionEnvironmentSnapshotType0
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)





    def to_dict(self) -> dict[str, Any]:
        from ..models.session_environment_snapshot_type_0 import SessionEnvironmentSnapshotType0
        id: None | str
        id = self.id

        version_id: None | str
        version_id = self.version_id

        snapshot: dict[str, Any] | None
        if isinstance(self.snapshot, SessionEnvironmentSnapshotType0):
            snapshot = self.snapshot.to_dict()
        else:
            snapshot = self.snapshot


        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({
            "id": id,
            "versionId": version_id,
            "snapshot": snapshot,
        })

        return field_dict



    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.session_environment_snapshot_type_0 import SessionEnvironmentSnapshotType0
        d = dict(src_dict)
        def _parse_id(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        id = _parse_id(d.pop("id"))


        def _parse_version_id(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        version_id = _parse_version_id(d.pop("versionId"))


        def _parse_snapshot(data: object) -> None | SessionEnvironmentSnapshotType0:
            if data is None:
                return data
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                componentsschemas_session_environment_snapshot_type_0 = SessionEnvironmentSnapshotType0.from_dict(data)



                return componentsschemas_session_environment_snapshot_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(None | SessionEnvironmentSnapshotType0, data)

        snapshot = _parse_snapshot(d.pop("snapshot"))


        session_bindings_environment = cls(
            id=id,
            version_id=version_id,
            snapshot=snapshot,
        )


        session_bindings_environment.additional_properties = d
        return session_bindings_environment

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
