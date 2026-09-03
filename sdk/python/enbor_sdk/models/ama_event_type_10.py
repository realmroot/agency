from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from ..models.ama_event_type_10_type import AmaEventType10Type
from typing import cast

if TYPE_CHECKING:
  from ..models.permission_denied_payload import PermissionDeniedPayload





T = TypeVar("T", bound="AmaEventType10")



@_attrs_define
class AmaEventType10:
    """
        Attributes:
            type_ (AmaEventType10Type):
            payload (PermissionDeniedPayload):
     """

    type_: AmaEventType10Type
    payload: PermissionDeniedPayload





    def to_dict(self) -> dict[str, Any]:
        from ..models.permission_denied_payload import PermissionDeniedPayload
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
        from ..models.permission_denied_payload import PermissionDeniedPayload
        d = dict(src_dict)
        type_ = AmaEventType10Type(d.pop("type"))




        payload = PermissionDeniedPayload.from_dict(d.pop("payload"))




        ama_event_type_10 = cls(
            type_=type_,
            payload=payload,
        )

        return ama_event_type_10
