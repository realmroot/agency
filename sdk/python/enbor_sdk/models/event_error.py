from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from ..types import UNSET, Unset






T = TypeVar("T", bound="EventError")



@_attrs_define
class EventError:
    """
        Attributes:
            message (str):
            code (str | Unset):
            category (str | Unset):
            retryable (bool | Unset):
            retry_after_seconds (float | Unset):
            details (Any | Unset):
     """

    message: str
    code: str | Unset = UNSET
    category: str | Unset = UNSET
    retryable: bool | Unset = UNSET
    retry_after_seconds: float | Unset = UNSET
    details: Any | Unset = UNSET





    def to_dict(self) -> dict[str, Any]:
        message = self.message

        code = self.code

        category = self.category

        retryable = self.retryable

        retry_after_seconds = self.retry_after_seconds

        details = self.details


        field_dict: dict[str, Any] = {}

        field_dict.update({
            "message": message,
        })
        if code is not UNSET:
            field_dict["code"] = code
        if category is not UNSET:
            field_dict["category"] = category
        if retryable is not UNSET:
            field_dict["retryable"] = retryable
        if retry_after_seconds is not UNSET:
            field_dict["retryAfterSeconds"] = retry_after_seconds
        if details is not UNSET:
            field_dict["details"] = details

        return field_dict



    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        message = d.pop("message")

        code = d.pop("code", UNSET)

        category = d.pop("category", UNSET)

        retryable = d.pop("retryable", UNSET)

        retry_after_seconds = d.pop("retryAfterSeconds", UNSET)

        details = d.pop("details", UNSET)

        event_error = cls(
            message=message,
            code=code,
            category=category,
            retryable=retryable,
            retry_after_seconds=retry_after_seconds,
            details=details,
        )

        return event_error
