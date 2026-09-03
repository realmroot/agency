from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from ..models.session_socket_backfill_request_message_type import SessionSocketBackfillRequestMessageType
from ..types import UNSET, Unset






T = TypeVar("T", bound="SessionSocketBackfillRequestMessage")



@_attrs_define
class SessionSocketBackfillRequestMessage:
    """
        Attributes:
            type_ (SessionSocketBackfillRequestMessageType):
            request_id (str | Unset):
            cursor (int | Unset):
            limit (int | Unset):
            event_type (str | Unset):
     """

    type_: SessionSocketBackfillRequestMessageType
    request_id: str | Unset = UNSET
    cursor: int | Unset = UNSET
    limit: int | Unset = UNSET
    event_type: str | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)





    def to_dict(self) -> dict[str, Any]:
        type_ = self.type_.value

        request_id = self.request_id

        cursor = self.cursor

        limit = self.limit

        event_type = self.event_type


        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({
            "type": type_,
        })
        if request_id is not UNSET:
            field_dict["requestId"] = request_id
        if cursor is not UNSET:
            field_dict["cursor"] = cursor
        if limit is not UNSET:
            field_dict["limit"] = limit
        if event_type is not UNSET:
            field_dict["eventType"] = event_type

        return field_dict



    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        type_ = SessionSocketBackfillRequestMessageType(d.pop("type"))




        request_id = d.pop("requestId", UNSET)

        cursor = d.pop("cursor", UNSET)

        limit = d.pop("limit", UNSET)

        event_type = d.pop("eventType", UNSET)

        session_socket_backfill_request_message = cls(
            type_=type_,
            request_id=request_id,
            cursor=cursor,
            limit=limit,
            event_type=event_type,
        )


        session_socket_backfill_request_message.additional_properties = d
        return session_socket_backfill_request_message

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
