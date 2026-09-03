from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset







T = TypeVar("T", bound="UsageSummaryTotals")



@_attrs_define
class UsageSummaryTotals:
    """
        Attributes:
            records (int):
            prompt_tokens (int):
            completion_tokens (int):
            total_tokens (int):
            duration_ms (int):
            cost_micros (int):
            currency (str):  Example: USD.
     """

    records: int
    prompt_tokens: int
    completion_tokens: int
    total_tokens: int
    duration_ms: int
    cost_micros: int
    currency: str
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)





    def to_dict(self) -> dict[str, Any]:
        records = self.records

        prompt_tokens = self.prompt_tokens

        completion_tokens = self.completion_tokens

        total_tokens = self.total_tokens

        duration_ms = self.duration_ms

        cost_micros = self.cost_micros

        currency = self.currency


        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({
            "records": records,
            "promptTokens": prompt_tokens,
            "completionTokens": completion_tokens,
            "totalTokens": total_tokens,
            "durationMs": duration_ms,
            "costMicros": cost_micros,
            "currency": currency,
        })

        return field_dict



    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        records = d.pop("records")

        prompt_tokens = d.pop("promptTokens")

        completion_tokens = d.pop("completionTokens")

        total_tokens = d.pop("totalTokens")

        duration_ms = d.pop("durationMs")

        cost_micros = d.pop("costMicros")

        currency = d.pop("currency")

        usage_summary_totals = cls(
            records=records,
            prompt_tokens=prompt_tokens,
            completion_tokens=completion_tokens,
            total_tokens=total_tokens,
            duration_ms=duration_ms,
            cost_micros=cost_micros,
            currency=currency,
        )


        usage_summary_totals.additional_properties = d
        return usage_summary_totals

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
