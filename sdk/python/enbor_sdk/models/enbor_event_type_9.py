from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from ..models.enbor_event_type_9_type import EnborEventType9Type
from typing import cast

if TYPE_CHECKING:
  from ..models.permission_resolved_payload import PermissionResolvedPayload





T = TypeVar("T", bound="EnborEventType9")



@_attrs_define
class EnborEventType9:
    """
        Attributes:
            type_ (EnborEventType9Type):
            payload (PermissionResolvedPayload):
     """

    type_: EnborEventType9Type
    payload: PermissionResolvedPayload





    def to_dict(self) -> dict[str, Any]:
        from ..models.permission_resolved_payload import PermissionResolvedPayload
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
        from ..models.permission_resolved_payload import PermissionResolvedPayload
        d = dict(src_dict)
        type_ = EnborEventType9Type(d.pop("type"))




        payload = PermissionResolvedPayload.from_dict(d.pop("payload"))




        enbor_event_type_9 = cls(
            type_=type_,
            payload=payload,
        )

        return enbor_event_type_9
