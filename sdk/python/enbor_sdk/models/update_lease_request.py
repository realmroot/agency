from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from ..models.update_lease_request_state import UpdateLeaseRequestState
from ..types import UNSET, Unset
from typing import cast
import datetime

if TYPE_CHECKING:
  from ..models.update_lease_request_error import UpdateLeaseRequestError
  from ..models.update_lease_request_result import UpdateLeaseRequestResult





T = TypeVar("T", bound="UpdateLeaseRequest")



@_attrs_define
class UpdateLeaseRequest:
    """
        Attributes:
            state (UpdateLeaseRequestState | Unset): Lease transition. `interrupted` is an action, not a resting state: it
                requeues the work item for recovery and the lease settles as `expired` in the resource.
            lease_duration_seconds (int | Unset):  Example: 60.
            expires_at (datetime.datetime | Unset):
            resume_token (str | Unset):  Example: runtime-session-uuid.
            result (UpdateLeaseRequestResult | Unset):  Example: {'exitCode': 0}.
            error (UpdateLeaseRequestError | Unset):  Example: {'message': 'Command failed'}.
     """

    state: UpdateLeaseRequestState | Unset = UNSET
    lease_duration_seconds: int | Unset = UNSET
    expires_at: datetime.datetime | Unset = UNSET
    resume_token: str | Unset = UNSET
    result: UpdateLeaseRequestResult | Unset = UNSET
    error: UpdateLeaseRequestError | Unset = UNSET





    def to_dict(self) -> dict[str, Any]:
        from ..models.update_lease_request_error import UpdateLeaseRequestError
        from ..models.update_lease_request_result import UpdateLeaseRequestResult
        state: str | Unset = UNSET
        if not isinstance(self.state, Unset):
            state = self.state.value


        lease_duration_seconds = self.lease_duration_seconds

        expires_at: str | Unset = UNSET
        if not isinstance(self.expires_at, Unset):
            expires_at = self.expires_at.isoformat()

        resume_token = self.resume_token

        result: dict[str, Any] | Unset = UNSET
        if not isinstance(self.result, Unset):
            result = self.result.to_dict()

        error: dict[str, Any] | Unset = UNSET
        if not isinstance(self.error, Unset):
            error = self.error.to_dict()


        field_dict: dict[str, Any] = {}

        field_dict.update({
        })
        if state is not UNSET:
            field_dict["state"] = state
        if lease_duration_seconds is not UNSET:
            field_dict["leaseDurationSeconds"] = lease_duration_seconds
        if expires_at is not UNSET:
            field_dict["expiresAt"] = expires_at
        if resume_token is not UNSET:
            field_dict["resumeToken"] = resume_token
        if result is not UNSET:
            field_dict["result"] = result
        if error is not UNSET:
            field_dict["error"] = error

        return field_dict



    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.update_lease_request_error import UpdateLeaseRequestError
        from ..models.update_lease_request_result import UpdateLeaseRequestResult
        d = dict(src_dict)
        _state = d.pop("state", UNSET)
        state: UpdateLeaseRequestState | Unset
        if isinstance(_state,  Unset):
            state = UNSET
        else:
            state = UpdateLeaseRequestState(_state)




        lease_duration_seconds = d.pop("leaseDurationSeconds", UNSET)

        _expires_at = d.pop("expiresAt", UNSET)
        expires_at: datetime.datetime | Unset
        if isinstance(_expires_at,  Unset):
            expires_at = UNSET
        else:
            expires_at = datetime.datetime.fromisoformat(_expires_at)




        resume_token = d.pop("resumeToken", UNSET)

        _result = d.pop("result", UNSET)
        result: UpdateLeaseRequestResult | Unset
        if isinstance(_result,  Unset):
            result = UNSET
        else:
            result = UpdateLeaseRequestResult.from_dict(_result)




        _error = d.pop("error", UNSET)
        error: UpdateLeaseRequestError | Unset
        if isinstance(_error,  Unset):
            error = UNSET
        else:
            error = UpdateLeaseRequestError.from_dict(_error)




        update_lease_request = cls(
            state=state,
            lease_duration_seconds=lease_duration_seconds,
            expires_at=expires_at,
            resume_token=resume_token,
            result=result,
            error=error,
        )

        return update_lease_request
