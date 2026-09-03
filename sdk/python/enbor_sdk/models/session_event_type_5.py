from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from ..models.session_event_type_5_type import SessionEventType5Type
from typing import cast
import datetime

if TYPE_CHECKING:
  from ..models.message_event_payload import MessageEventPayload





T = TypeVar("T", bound="SessionEventType5")



@_attrs_define
class SessionEventType5:
    """
        Attributes:
            id (str):
            session_id (str):
            sequence (int):
            created_at (datetime.datetime):
            type_ (SessionEventType5Type):
            payload (MessageEventPayload):
     """

    id: str
    session_id: str
    sequence: int
    created_at: datetime.datetime
    type_: SessionEventType5Type
    payload: MessageEventPayload





    def to_dict(self) -> dict[str, Any]:
        from ..models.message_event_payload import MessageEventPayload
        id = self.id

        session_id = self.session_id

        sequence = self.sequence

        created_at = self.created_at.isoformat()

        type_ = self.type_.value

        payload = self.payload.to_dict()


        field_dict: dict[str, Any] = {}

        field_dict.update({
            "id": id,
            "sessionId": session_id,
            "sequence": sequence,
            "createdAt": created_at,
            "type": type_,
            "payload": payload,
        })

        return field_dict



    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.message_event_payload import MessageEventPayload
        d = dict(src_dict)
        id = d.pop("id")

        session_id = d.pop("sessionId")

        sequence = d.pop("sequence")

        created_at = datetime.datetime.fromisoformat(d.pop("createdAt"))




        type_ = SessionEventType5Type(d.pop("type"))




        payload = MessageEventPayload.from_dict(d.pop("payload"))




        session_event_type_5 = cls(
            id=id,
            session_id=session_id,
            sequence=sequence,
            created_at=created_at,
            type_=type_,
            payload=payload,
        )

        return session_event_type_5
