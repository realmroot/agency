from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from ..models.session_socket_prompt_message_type import SessionSocketPromptMessageType
from ..types import UNSET, Unset






T = TypeVar("T", bound="SessionSocketPromptMessage")



@_attrs_define
class SessionSocketPromptMessage:
    """
        Attributes:
            type_ (SessionSocketPromptMessageType):
            content (str):
            request_id (str | Unset):
     """

    type_: SessionSocketPromptMessageType
    content: str
    request_id: str | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)





    def to_dict(self) -> dict[str, Any]:
        type_ = self.type_.value

        content = self.content

        request_id = self.request_id


        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({
            "type": type_,
            "content": content,
        })
        if request_id is not UNSET:
            field_dict["requestId"] = request_id

        return field_dict



    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        type_ = SessionSocketPromptMessageType(d.pop("type"))




        content = d.pop("content")

        request_id = d.pop("requestId", UNSET)

        session_socket_prompt_message = cls(
            type_=type_,
            content=content,
            request_id=request_id,
        )


        session_socket_prompt_message.additional_properties = d
        return session_socket_prompt_message

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
