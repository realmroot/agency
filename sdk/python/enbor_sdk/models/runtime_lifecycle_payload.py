from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from ..types import UNSET, Unset






T = TypeVar("T", bound="RuntimeLifecyclePayload")



@_attrs_define
class RuntimeLifecyclePayload:
    """
        Attributes:
            reason (str | Unset):
     """

    reason: str | Unset = UNSET





    def to_dict(self) -> dict[str, Any]:
        reason = self.reason


        field_dict: dict[str, Any] = {}

        field_dict.update({
        })
        if reason is not UNSET:
            field_dict["reason"] = reason

        return field_dict



    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        reason = d.pop("reason", UNSET)

        runtime_lifecycle_payload = cls(
            reason=reason,
        )

        return runtime_lifecycle_payload
