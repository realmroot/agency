from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from ..models.trigger_status_subscription_type_0_phase import TriggerStatusSubscriptionType0Phase
from typing import cast






T = TypeVar("T", bound="TriggerStatusSubscriptionType0")



@_attrs_define
class TriggerStatusSubscriptionType0:
    """
        Attributes:
            id (str):
            phase (TriggerStatusSubscriptionType0Phase):
            error_message (None | str):
     """

    id: str
    phase: TriggerStatusSubscriptionType0Phase
    error_message: None | str
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)





    def to_dict(self) -> dict[str, Any]:
        id = self.id

        phase = self.phase.value

        error_message: None | str
        error_message = self.error_message


        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({
            "id": id,
            "phase": phase,
            "errorMessage": error_message,
        })

        return field_dict



    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        id = d.pop("id")

        phase = TriggerStatusSubscriptionType0Phase(d.pop("phase"))




        def _parse_error_message(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        error_message = _parse_error_message(d.pop("errorMessage"))


        trigger_status_subscription_type_0 = cls(
            id=id,
            phase=phase,
            error_message=error_message,
        )


        trigger_status_subscription_type_0.additional_properties = d
        return trigger_status_subscription_type_0

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
