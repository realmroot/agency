from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from ..models.ama_event_type_8_type import AmaEventType8Type
from typing import cast

if TYPE_CHECKING:
  from ..models.permission_request_payload import PermissionRequestPayload





T = TypeVar("T", bound="AmaEventType8")



@_attrs_define
class AmaEventType8:
    """
        Attributes:
            type_ (AmaEventType8Type):
            payload (PermissionRequestPayload):
     """

    type_: AmaEventType8Type
    payload: PermissionRequestPayload





    def to_dict(self) -> dict[str, Any]:
        from ..models.permission_request_payload import PermissionRequestPayload
        type_ = self.type_.value

        payload = self.payload.to_dict()


        field_dict: dict[str, Any] = {}

        field_dict.update({
            "type": type_,
            "payload": payload,
        })

        return field_dict



    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.permission_request_payload import PermissionRequestPayload
        d = dict(src_dict)
        type_ = AmaEventType8Type(d.pop("type"))




        payload = PermissionRequestPayload.from_dict(d.pop("payload"))




        ama_event_type_8 = cls(
            type_=type_,
            payload=payload,
        )

        return ama_event_type_8
