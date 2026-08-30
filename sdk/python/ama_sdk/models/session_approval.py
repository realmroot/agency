from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from ..models.session_approval_state import SessionApprovalState
from typing import cast
import datetime

if TYPE_CHECKING:
  from ..models.session_approval_input import SessionApprovalInput
  from ..models.session_approval_result_type_0 import SessionApprovalResultType0





T = TypeVar("T", bound="SessionApproval")



@_attrs_define
class SessionApproval:
    """
        Attributes:
            id (str):  Example: 0195f5d6-7c20-7000-8000-000000000010.
            session_id (str):  Example: 0195f5d6-7c20-7000-8000-00000000000e.
            tool_call_id (str):  Example: call_git_status.
            tool_name (str):  Example: bash.
            input_ (SessionApprovalInput):
            related_event_ids (list[str]):  Example: ['0195f5d6-7c20-7000-8000-000000000018'].
            state (SessionApprovalState):  Example: pending.
            reason (None | str):  Example: Looks safe.
            result (None | SessionApprovalResultType0): Caller-provided custom tool result recorded instead of executing the
                tool.
            requested_at (datetime.datetime):  Example: 2026-06-12T12:00:00.000Z.
            decided_at (datetime.datetime | None):
            created_at (datetime.datetime):
            updated_at (datetime.datetime):
     """

    id: str
    session_id: str
    tool_call_id: str
    tool_name: str
    input_: SessionApprovalInput
    related_event_ids: list[str]
    state: SessionApprovalState
    reason: None | str
    result: None | SessionApprovalResultType0
    requested_at: datetime.datetime
    decided_at: datetime.datetime | None
    created_at: datetime.datetime
    updated_at: datetime.datetime
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)





    def to_dict(self) -> dict[str, Any]:
        from ..models.session_approval_input import SessionApprovalInput
        from ..models.session_approval_result_type_0 import SessionApprovalResultType0
        id = self.id

        session_id = self.session_id

        tool_call_id = self.tool_call_id

        tool_name = self.tool_name

        input_ = self.input_.to_dict()

        related_event_ids = self.related_event_ids



        state = self.state.value

        reason: None | str
        reason = self.reason

        result: dict[str, Any] | None
        if isinstance(self.result, SessionApprovalResultType0):
            result = self.result.to_dict()
        else:
            result = self.result

        requested_at = self.requested_at.isoformat()

        decided_at: None | str
        if isinstance(self.decided_at, datetime.datetime):
            decided_at = self.decided_at.isoformat()
        else:
            decided_at = self.decided_at

        created_at = self.created_at.isoformat()

        updated_at = self.updated_at.isoformat()


        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({
            "id": id,
            "sessionId": session_id,
            "toolCallId": tool_call_id,
            "toolName": tool_name,
            "input": input_,
            "relatedEventIds": related_event_ids,
            "state": state,
            "reason": reason,
            "result": result,
            "requestedAt": requested_at,
            "decidedAt": decided_at,
            "createdAt": created_at,
            "updatedAt": updated_at,
        })

        return field_dict



    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.session_approval_input import SessionApprovalInput
        from ..models.session_approval_result_type_0 import SessionApprovalResultType0
        d = dict(src_dict)
        id = d.pop("id")

        session_id = d.pop("sessionId")

        tool_call_id = d.pop("toolCallId")

        tool_name = d.pop("toolName")

        input_ = SessionApprovalInput.from_dict(d.pop("input"))




        related_event_ids = cast(list[str], d.pop("relatedEventIds"))


        state = SessionApprovalState(d.pop("state"))




        def _parse_reason(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        reason = _parse_reason(d.pop("reason"))


        def _parse_result(data: object) -> None | SessionApprovalResultType0:
            if data is None:
                return data
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                result_type_0 = SessionApprovalResultType0.from_dict(data)



                return result_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(None | SessionApprovalResultType0, data)

        result = _parse_result(d.pop("result"))


        requested_at = datetime.datetime.fromisoformat(d.pop("requestedAt"))




        def _parse_decided_at(data: object) -> datetime.datetime | None:
            if data is None:
                return data
            try:
                if not isinstance(data, str):
                    raise TypeError()
                decided_at_type_0 = datetime.datetime.fromisoformat(data)



                return decided_at_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(datetime.datetime | None, data)

        decided_at = _parse_decided_at(d.pop("decidedAt"))


        created_at = datetime.datetime.fromisoformat(d.pop("createdAt"))




        updated_at = datetime.datetime.fromisoformat(d.pop("updatedAt"))




        session_approval = cls(
            id=id,
            session_id=session_id,
            tool_call_id=tool_call_id,
            tool_name=tool_name,
            input_=input_,
            related_event_ids=related_event_ids,
            state=state,
            reason=reason,
            result=result,
            requested_at=requested_at,
            decided_at=decided_at,
            created_at=created_at,
            updated_at=updated_at,
        )


        session_approval.additional_properties = d
        return session_approval

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
