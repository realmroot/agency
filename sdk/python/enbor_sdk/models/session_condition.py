from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from ..models.session_condition_status import SessionConditionStatus
from ..models.session_condition_type import SessionConditionType
from typing import cast
import datetime






T = TypeVar("T", bound="SessionCondition")



@_attrs_define
class SessionCondition:
    """
        Attributes:
            type_ (SessionConditionType):
            status (SessionConditionStatus):
            reason (None | str):
            message (None | str):
            last_transition_at (datetime.datetime):
     """

    type_: SessionConditionType
    status: SessionConditionStatus
    reason: None | str
    message: None | str
    last_transition_at: datetime.datetime
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)





    def to_dict(self) -> dict[str, Any]:
        type_ = self.type_.value

        status = self.status.value

        reason: None | str
        reason = self.reason

        message: None | str
        message = self.message

        last_transition_at = self.last_transition_at.isoformat()


        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({
            "type": type_,
            "status": status,
            "reason": reason,
            "message": message,
            "lastTransitionAt": last_transition_at,
        })

        return field_dict



    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        type_ = SessionConditionType(d.pop("type"))




        status = SessionConditionStatus(d.pop("status"))




        def _parse_reason(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        reason = _parse_reason(d.pop("reason"))


        def _parse_message(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        message = _parse_message(d.pop("message"))


        last_transition_at = datetime.datetime.fromisoformat(d.pop("lastTransitionAt"))




        session_condition = cls(
            type_=type_,
            status=status,
            reason=reason,
            message=message,
            last_transition_at=last_transition_at,
        )


        session_condition.additional_properties = d
        return session_condition

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
