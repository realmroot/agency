from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from ..models.session_approval_decision_request_decision import SessionApprovalDecisionRequestDecision
from ..types import UNSET, Unset
from typing import cast

if TYPE_CHECKING:
  from ..models.session_approval_decision_request_result import SessionApprovalDecisionRequestResult





T = TypeVar("T", bound="SessionApprovalDecisionRequest")



@_attrs_define
class SessionApprovalDecisionRequest:
    """
        Attributes:
            decision (SessionApprovalDecisionRequestDecision):  Example: approve.
            reason (str | Unset):  Example: Looks safe.
            result (SessionApprovalDecisionRequestResult | Unset): Caller-provided custom tool result recorded instead of
                executing the tool
     """

    decision: SessionApprovalDecisionRequestDecision
    reason: str | Unset = UNSET
    result: SessionApprovalDecisionRequestResult | Unset = UNSET





    def to_dict(self) -> dict[str, Any]:
        from ..models.session_approval_decision_request_result import SessionApprovalDecisionRequestResult
        decision = self.decision.value

        reason = self.reason

        result: dict[str, Any] | Unset = UNSET
        if not isinstance(self.result, Unset):
            result = self.result.to_dict()


        field_dict: dict[str, Any] = {}

        field_dict.update({
            "decision": decision,
        })
        if reason is not UNSET:
            field_dict["reason"] = reason
        if result is not UNSET:
            field_dict["result"] = result

        return field_dict



    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.session_approval_decision_request_result import SessionApprovalDecisionRequestResult
        d = dict(src_dict)
        decision = SessionApprovalDecisionRequestDecision(d.pop("decision"))




        reason = d.pop("reason", UNSET)

        _result = d.pop("result", UNSET)
        result: SessionApprovalDecisionRequestResult | Unset
        if isinstance(_result,  Unset):
            result = UNSET
        else:
            result = SessionApprovalDecisionRequestResult.from_dict(_result)




        session_approval_decision_request = cls(
            decision=decision,
            reason=reason,
            result=result,
        )

        return session_approval_decision_request
