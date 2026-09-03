from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from ..models.update_vault_request_spec_scope import UpdateVaultRequestSpecScope
from ..types import UNSET, Unset






T = TypeVar("T", bound="UpdateVaultRequestSpec")



@_attrs_define
class UpdateVaultRequestSpec:
    """
        Attributes:
            scope (UpdateVaultRequestSpecScope | Unset):  Example: project.
     """

    scope: UpdateVaultRequestSpecScope | Unset = UNSET





    def to_dict(self) -> dict[str, Any]:
        scope: str | Unset = UNSET
        if not isinstance(self.scope, Unset):
            scope = self.scope.value



        field_dict: dict[str, Any] = {}

        field_dict.update({
        })
        if scope is not UNSET:
            field_dict["scope"] = scope

        return field_dict



    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        _scope = d.pop("scope", UNSET)
        scope: UpdateVaultRequestSpecScope | Unset
        if isinstance(_scope,  Unset):
            scope = UNSET
        else:
            scope = UpdateVaultRequestSpecScope(_scope)




        update_vault_request_spec = cls(
            scope=scope,
        )

        return update_vault_request_spec
