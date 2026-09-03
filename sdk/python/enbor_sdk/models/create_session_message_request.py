from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from ..models.create_session_message_request_type import CreateSessionMessageRequestType
from ..types import UNSET, Unset






T = TypeVar("T", bound="CreateSessionMessageRequest")



@_attrs_define
class CreateSessionMessageRequest:
    """
        Attributes:
            type_ (CreateSessionMessageRequestType):  Example: prompt.
            content (str):  Example: Please continue the task and summarize the current blocker..
            request_id (str | Unset):
     """

    type_: CreateSessionMessageRequestType
    content: str
    request_id: str | Unset = UNSET





    def to_dict(self) -> dict[str, Any]:
        type_ = self.type_.value

        content = self.content

        request_id = self.request_id


        field_dict: dict[str, Any] = {}

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
        type_ = CreateSessionMessageRequestType(d.pop("type"))




        content = d.pop("content")

        request_id = d.pop("requestId", UNSET)

        create_session_message_request = cls(
            type_=type_,
            content=content,
            request_id=request_id,
        )

        return create_session_message_request
