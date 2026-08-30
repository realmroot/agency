from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from ..models.lease_state import LeaseState
from typing import cast
import datetime






T = TypeVar("T", bound="Lease")



@_attrs_define
class Lease:
    """
        Attributes:
            id (str):  Example: 0195f5d6-7c20-7000-8000-000000000013.
            work_item_id (str):  Example: 0195f5d6-7c20-7000-8000-000000000012.
            runner_id (str):  Example: 0195f5d6-7c20-7000-8000-000000000011.
            state (LeaseState):  Example: active.
            expires_at (datetime.datetime):
            renewed_at (datetime.datetime | None):
            resume_token (None | str):  Example: runtime-session-uuid.
            created_at (datetime.datetime):
            updated_at (datetime.datetime):
     """

    id: str
    work_item_id: str
    runner_id: str
    state: LeaseState
    expires_at: datetime.datetime
    renewed_at: datetime.datetime | None
    resume_token: None | str
    created_at: datetime.datetime
    updated_at: datetime.datetime
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)





    def to_dict(self) -> dict[str, Any]:
        id = self.id

        work_item_id = self.work_item_id

        runner_id = self.runner_id

        state = self.state.value

        expires_at = self.expires_at.isoformat()

        renewed_at: None | str
        if isinstance(self.renewed_at, datetime.datetime):
            renewed_at = self.renewed_at.isoformat()
        else:
            renewed_at = self.renewed_at

        resume_token: None | str
        resume_token = self.resume_token

        created_at = self.created_at.isoformat()

        updated_at = self.updated_at.isoformat()


        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({
            "id": id,
            "workItemId": work_item_id,
            "runnerId": runner_id,
            "state": state,
            "expiresAt": expires_at,
            "renewedAt": renewed_at,
            "resumeToken": resume_token,
            "createdAt": created_at,
            "updatedAt": updated_at,
        })

        return field_dict



    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        id = d.pop("id")

        work_item_id = d.pop("workItemId")

        runner_id = d.pop("runnerId")

        state = LeaseState(d.pop("state"))




        expires_at = datetime.datetime.fromisoformat(d.pop("expiresAt"))




        def _parse_renewed_at(data: object) -> datetime.datetime | None:
            if data is None:
                return data
            try:
                if not isinstance(data, str):
                    raise TypeError()
                renewed_at_type_0 = datetime.datetime.fromisoformat(data)



                return renewed_at_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(datetime.datetime | None, data)

        renewed_at = _parse_renewed_at(d.pop("renewedAt"))


        def _parse_resume_token(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        resume_token = _parse_resume_token(d.pop("resumeToken"))


        created_at = datetime.datetime.fromisoformat(d.pop("createdAt"))




        updated_at = datetime.datetime.fromisoformat(d.pop("updatedAt"))




        lease = cls(
            id=id,
            work_item_id=work_item_id,
            runner_id=runner_id,
            state=state,
            expires_at=expires_at,
            renewed_at=renewed_at,
            resume_token=resume_token,
            created_at=created_at,
            updated_at=updated_at,
        )


        lease.additional_properties = d
        return lease

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
