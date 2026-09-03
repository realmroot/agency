from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from ..types import UNSET, Unset






T = TypeVar("T", bound="UpdateEnvironmentRequestSpecVariablesAdditionalProperty")



@_attrs_define
class UpdateEnvironmentRequestSpecVariablesAdditionalProperty:
    """
        Attributes:
            description (str | Unset):
            required (bool | Unset):
     """

    description: str | Unset = UNSET
    required: bool | Unset = UNSET





    def to_dict(self) -> dict[str, Any]:
        description = self.description

        required = self.required


        field_dict: dict[str, Any] = {}

        field_dict.update({
        })
        if description is not UNSET:
            field_dict["description"] = description
        if required is not UNSET:
            field_dict["required"] = required

        return field_dict



    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        description = d.pop("description", UNSET)

        required = d.pop("required", UNSET)

        update_environment_request_spec_variables_additional_property = cls(
            description=description,
            required=required,
        )

        return update_environment_request_spec_variables_additional_property
