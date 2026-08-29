from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset







T = TypeVar("T", bound="UpdateIdentityRequest")



@_attrs_define
class UpdateIdentityRequest:
    """
        Attributes:
            archived (bool):
     """

    archived: bool





    def to_dict(self) -> dict[str, Any]:
        archived = self.archived


        field_dict: dict[str, Any] = {}

        field_dict.update({
            "archived": archived,
        })

        return field_dict



    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        archived = d.pop("archived")

        update_identity_request = cls(
            archived=archived,
        )

        return update_identity_request
