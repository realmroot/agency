from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from ..models.session_message_delivery import SessionMessageDelivery
from ..models.session_message_state import SessionMessageState
from ..models.session_message_type import SessionMessageType
from typing import cast
import datetime






T = TypeVar("T", bound="SessionMessage")



@_attrs_define
class SessionMessage:
    """
        Attributes:
            id (str):  Example: 0195f5d6-7c20-7000-8000-00000000000f.
            session_id (str):  Example: 0195f5d6-7c20-7000-8000-00000000000e.
            type_ (SessionMessageType):  Example: prompt.
            content (str):  Example: Please continue the task and summarize the current blocker..
            delivery (SessionMessageDelivery):  Example: queued.
            state (SessionMessageState):  Example: accepted.
            error (None | str):
            created_at (datetime.datetime):
            updated_at (datetime.datetime):
     """

    id: str
    session_id: str
    type_: SessionMessageType
    content: str
    delivery: SessionMessageDelivery
    state: SessionMessageState
    error: None | str
    created_at: datetime.datetime
    updated_at: datetime.datetime
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)





    def to_dict(self) -> dict[str, Any]:
        id = self.id

        session_id = self.session_id

        type_ = self.type_.value

        content = self.content

        delivery = self.delivery.value

        state = self.state.value

        error: None | str
        error = self.error

        created_at = self.created_at.isoformat()

        updated_at = self.updated_at.isoformat()


        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({
            "id": id,
            "sessionId": session_id,
            "type": type_,
            "content": content,
            "delivery": delivery,
            "state": state,
            "error": error,
            "createdAt": created_at,
            "updatedAt": updated_at,
        })

        return field_dict



    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        id = d.pop("id")

        session_id = d.pop("sessionId")

        type_ = SessionMessageType(d.pop("type"))




        content = d.pop("content")

        delivery = SessionMessageDelivery(d.pop("delivery"))




        state = SessionMessageState(d.pop("state"))




        def _parse_error(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        error = _parse_error(d.pop("error"))


        created_at = datetime.datetime.fromisoformat(d.pop("createdAt"))




        updated_at = datetime.datetime.fromisoformat(d.pop("updatedAt"))




        session_message = cls(
            id=id,
            session_id=session_id,
            type_=type_,
            content=content,
            delivery=delivery,
            state=state,
            error=error,
            created_at=created_at,
            updated_at=updated_at,
        )


        session_message.additional_properties = d
        return session_message

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
