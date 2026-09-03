from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from ..models.session_socket_runner_unavailable_message_type import SessionSocketRunnerUnavailableMessageType






T = TypeVar("T", bound="SessionSocketRunnerUnavailableMessage")



@_attrs_define
class SessionSocketRunnerUnavailableMessage:
    """
        Attributes:
            type_ (SessionSocketRunnerUnavailableMessageType):
            message (str):
     """

    type_: SessionSocketRunnerUnavailableMessageType
    message: str
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)





    def to_dict(self) -> dict[str, Any]:
        type_ = self.type_.value

        message = self.message


        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({
            "type": type_,
            "message": message,
        })

        return field_dict



    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        type_ = SessionSocketRunnerUnavailableMessageType(d.pop("type"))




        message = d.pop("message")

        session_socket_runner_unavailable_message = cls(
            type_=type_,
            message=message,
        )


        session_socket_runner_unavailable_message.additional_properties = d
        return session_socket_runner_unavailable_message

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
