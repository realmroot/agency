from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from ..models.file_content_block_type import FileContentBlockType
from ..types import UNSET, Unset






T = TypeVar("T", bound="FileContentBlock")



@_attrs_define
class FileContentBlock:
    """
        Attributes:
            type_ (FileContentBlockType):
            path (str | Unset):
            name (str | Unset):
            media_type (str | Unset):
            data (str | Unset):
     """

    type_: FileContentBlockType
    path: str | Unset = UNSET
    name: str | Unset = UNSET
    media_type: str | Unset = UNSET
    data: str | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)





    def to_dict(self) -> dict[str, Any]:
        type_ = self.type_.value

        path = self.path

        name = self.name

        media_type = self.media_type

        data = self.data


        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({
            "type": type_,
        })
        if path is not UNSET:
            field_dict["path"] = path
        if name is not UNSET:
            field_dict["name"] = name
        if media_type is not UNSET:
            field_dict["mediaType"] = media_type
        if data is not UNSET:
            field_dict["data"] = data

        return field_dict



    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        type_ = FileContentBlockType(d.pop("type"))




        path = d.pop("path", UNSET)

        name = d.pop("name", UNSET)

        media_type = d.pop("mediaType", UNSET)

        data = d.pop("data", UNSET)

        file_content_block = cls(
            type_=type_,
            path=path,
            name=name,
            media_type=media_type,
            data=data,
        )


        file_content_block.additional_properties = d
        return file_content_block

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
