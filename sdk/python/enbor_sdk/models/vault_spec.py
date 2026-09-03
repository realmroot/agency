from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from ..models.vault_spec_scope import VaultSpecScope






T = TypeVar("T", bound="VaultSpec")



@_attrs_define
class VaultSpec:
    """
        Attributes:
            organization_id (str):  Example: org_abc123.
            scope (VaultSpecScope):  Example: project.
     """

    organization_id: str
    scope: VaultSpecScope
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)





    def to_dict(self) -> dict[str, Any]:
        organization_id = self.organization_id

        scope = self.scope.value


        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({
            "organizationId": organization_id,
            "scope": scope,
        })

        return field_dict



    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        organization_id = d.pop("organizationId")

        scope = VaultSpecScope(d.pop("scope"))




        vault_spec = cls(
            organization_id=organization_id,
            scope=scope,
        )


        vault_spec.additional_properties = d
        return vault_spec

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
