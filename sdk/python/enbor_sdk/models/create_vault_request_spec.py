from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from ..models.create_vault_request_spec_scope import CreateVaultRequestSpecScope
from ..types import UNSET, Unset






T = TypeVar("T", bound="CreateVaultRequestSpec")



@_attrs_define
class CreateVaultRequestSpec:
    """
        Attributes:
            scope (CreateVaultRequestSpecScope | Unset):  Example: project.
     """

    scope: CreateVaultRequestSpecScope | Unset = UNSET





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
        scope: CreateVaultRequestSpecScope | Unset
        if isinstance(_scope,  Unset):
            scope = UNSET
        else:
            scope = CreateVaultRequestSpecScope(_scope)




        create_vault_request_spec = cls(
            scope=scope,
        )

        return create_vault_request_spec
