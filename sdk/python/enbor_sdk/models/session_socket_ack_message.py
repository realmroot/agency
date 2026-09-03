from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from ..models.session_socket_ack_message_type import SessionSocketAckMessageType






T = TypeVar("T", bound="SessionSocketAckMessage")



@_attrs_define
class SessionSocketAckMessage:
    """
        Attributes:
            type_ (SessionSocketAckMessageType):
            request_id (str):
     """

    type_: SessionSocketAckMessageType
    request_id: str
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)





    def to_dict(self) -> dict[str, Any]:
        type_ = self.type_.value

        request_id = self.request_id


        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({
            "type": type_,
            "requestId": request_id,
        })

        return field_dict



    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        type_ = SessionSocketAckMessageType(d.pop("type"))




        request_id = d.pop("requestId")

        session_socket_ack_message = cls(
            type_=type_,
            request_id=request_id,
        )


        session_socket_ack_message.additional_properties = d
        return session_socket_ack_message

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
