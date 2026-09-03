from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from ..models.provider_error_type_0_category import ProviderErrorType0Category
from ..types import UNSET, Unset
from typing import cast
import datetime






T = TypeVar("T", bound="ProviderErrorType0")



@_attrs_define
class ProviderErrorType0:
    """
        Attributes:
            type_ (str):  Example: provider_error.
            message (str):  Example: The provider rejected the request..
            category (ProviderErrorType0Category | Unset):  Example: network.
            retryable (bool | Unset):  Example: True.
            retry_after_seconds (int | Unset):  Example: 30.
            occurred_at (datetime.datetime | Unset):
     """

    type_: str
    message: str
    category: ProviderErrorType0Category | Unset = UNSET
    retryable: bool | Unset = UNSET
    retry_after_seconds: int | Unset = UNSET
    occurred_at: datetime.datetime | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)





    def to_dict(self) -> dict[str, Any]:
        type_ = self.type_

        message = self.message

        category: str | Unset = UNSET
        if not isinstance(self.category, Unset):
            category = self.category.value


        retryable = self.retryable

        retry_after_seconds = self.retry_after_seconds

        occurred_at: str | Unset = UNSET
        if not isinstance(self.occurred_at, Unset):
            occurred_at = self.occurred_at.isoformat()


        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({
            "type": type_,
            "message": message,
        })
        if category is not UNSET:
            field_dict["category"] = category
        if retryable is not UNSET:
            field_dict["retryable"] = retryable
        if retry_after_seconds is not UNSET:
            field_dict["retryAfterSeconds"] = retry_after_seconds
        if occurred_at is not UNSET:
            field_dict["occurredAt"] = occurred_at

        return field_dict



    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        type_ = d.pop("type")

        message = d.pop("message")

        _category = d.pop("category", UNSET)
        category: ProviderErrorType0Category | Unset
        if isinstance(_category,  Unset):
            category = UNSET
        else:
            category = ProviderErrorType0Category(_category)




        retryable = d.pop("retryable", UNSET)

        retry_after_seconds = d.pop("retryAfterSeconds", UNSET)

        _occurred_at = d.pop("occurredAt", UNSET)
        occurred_at: datetime.datetime | Unset
        if isinstance(_occurred_at,  Unset):
            occurred_at = UNSET
        else:
            occurred_at = datetime.datetime.fromisoformat(_occurred_at)




        provider_error_type_0 = cls(
            type_=type_,
            message=message,
            category=category,
            retryable=retryable,
            retry_after_seconds=retry_after_seconds,
            occurred_at=occurred_at,
        )


        provider_error_type_0.additional_properties = d
        return provider_error_type_0

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
