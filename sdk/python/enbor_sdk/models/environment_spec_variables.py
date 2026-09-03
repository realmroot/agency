from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from typing import cast

if TYPE_CHECKING:
  from ..models.environment_spec_variables_additional_property import EnvironmentSpecVariablesAdditionalProperty





T = TypeVar("T", bound="EnvironmentSpecVariables")



@_attrs_define
class EnvironmentSpecVariables:
    """
        Example:
            {'NODE_ENV': {'description': 'Runtime mode'}}

     """

    additional_properties: dict[str, EnvironmentSpecVariablesAdditionalProperty] = _attrs_field(init=False, factory=dict)





    def to_dict(self) -> dict[str, Any]:
        from ..models.environment_spec_variables_additional_property import EnvironmentSpecVariablesAdditionalProperty

        field_dict: dict[str, Any] = {}
        for prop_name, prop in self.additional_properties.items():
            field_dict[prop_name] = prop.to_dict()


        return field_dict



    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.environment_spec_variables_additional_property import EnvironmentSpecVariablesAdditionalProperty
        d = dict(src_dict)
        environment_spec_variables = cls(
        )


        additional_properties = {}
        for prop_name, prop_dict in d.items():
            additional_property = EnvironmentSpecVariablesAdditionalProperty.from_dict(prop_dict)



            additional_properties[prop_name] = additional_property

        environment_spec_variables.additional_properties = additional_properties
        return environment_spec_variables

    @property
    def additional_keys(self) -> list[str]:
        return list(self.additional_properties.keys())

    def __getitem__(self, key: str) -> EnvironmentSpecVariablesAdditionalProperty:
        return self.additional_properties[key]

    def __setitem__(self, key: str, value: EnvironmentSpecVariablesAdditionalProperty) -> None:
        self.additional_properties[key] = value

    def __delitem__(self, key: str) -> None:
        del self.additional_properties[key]

    def __contains__(self, key: str) -> bool:
        return key in self.additional_properties
