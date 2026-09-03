from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from ..types import UNSET, Unset






T = TypeVar("T", bound="ProviderModelPricing")



@_attrs_define
class ProviderModelPricing:
    """
        Attributes:
            input_micros_per_token (float | Unset):
            output_micros_per_token (float | Unset):
     """

    input_micros_per_token: float | Unset = UNSET
    output_micros_per_token: float | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)





    def to_dict(self) -> dict[str, Any]:
        input_micros_per_token = self.input_micros_per_token

        output_micros_per_token = self.output_micros_per_token


        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({
        })
        if input_micros_per_token is not UNSET:
            field_dict["inputMicrosPerToken"] = input_micros_per_token
        if output_micros_per_token is not UNSET:
            field_dict["outputMicrosPerToken"] = output_micros_per_token

        return field_dict



    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        input_micros_per_token = d.pop("inputMicrosPerToken", UNSET)

        output_micros_per_token = d.pop("outputMicrosPerToken", UNSET)

        provider_model_pricing = cls(
            input_micros_per_token=input_micros_per_token,
            output_micros_per_token=output_micros_per_token,
        )


        provider_model_pricing.additional_properties = d
        return provider_model_pricing

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
