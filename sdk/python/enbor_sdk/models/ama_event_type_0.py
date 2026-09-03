from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from ..models.ama_event_type_0_type import AmaEventType0Type
from typing import cast

if TYPE_CHECKING:
  from ..models.runtime_lifecycle_payload import RuntimeLifecyclePayload





T = TypeVar("T", bound="AmaEventType0")



@_attrs_define
class AmaEventType0:
    """
        Attributes:
            type_ (AmaEventType0Type):
            payload (RuntimeLifecyclePayload):
     """

    type_: AmaEventType0Type
    payload: RuntimeLifecyclePayload





    def to_dict(self) -> dict[str, Any]:
        from ..models.runtime_lifecycle_payload import RuntimeLifecyclePayload
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
        from ..models.runtime_lifecycle_payload import RuntimeLifecyclePayload
        d = dict(src_dict)
        type_ = AmaEventType0Type(d.pop("type"))




        payload = RuntimeLifecyclePayload.from_dict(d.pop("payload"))




        ama_event_type_0 = cls(
            type_=type_,
            payload=payload,
        )

        return ama_event_type_0
