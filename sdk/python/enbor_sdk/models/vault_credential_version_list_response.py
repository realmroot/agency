from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from typing import cast

if TYPE_CHECKING:
  from ..models.list_pagination import ListPagination
  from ..models.vault_credential_version_type_0 import VaultCredentialVersionType0





T = TypeVar("T", bound="VaultCredentialVersionListResponse")



@_attrs_define
class VaultCredentialVersionListResponse:
    """
        Attributes:
            data (list[None | VaultCredentialVersionType0]):
            pagination (ListPagination):
     """

    data: list[None | VaultCredentialVersionType0]
    pagination: ListPagination
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)





    def to_dict(self) -> dict[str, Any]:
        from ..models.list_pagination import ListPagination
        from ..models.vault_credential_version_type_0 import VaultCredentialVersionType0
        data = []
        for data_item_data in self.data:
            data_item: dict[str, Any] | None
            if isinstance(data_item_data, VaultCredentialVersionType0):
                data_item = data_item_data.to_dict()
            else:
                data_item = data_item_data
            data.append(data_item)



        pagination = self.pagination.to_dict()


        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({
            "data": data,
            "pagination": pagination,
        })

        return field_dict



    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.list_pagination import ListPagination
        from ..models.vault_credential_version_type_0 import VaultCredentialVersionType0
        d = dict(src_dict)
        data = []
        _data = d.pop("data")
        for data_item_data in (_data):
            def _parse_data_item(data: object) -> None | VaultCredentialVersionType0:
                if data is None:
                    return data
                try:
                    if not isinstance(data, dict):
                        raise TypeError()
                    componentsschemas_vault_credential_version_type_0 = VaultCredentialVersionType0.from_dict(data)



                    return componentsschemas_vault_credential_version_type_0
                except (TypeError, ValueError, AttributeError, KeyError):
                    pass
                return cast(None | VaultCredentialVersionType0, data)

            data_item = _parse_data_item(data_item_data)

            data.append(data_item)


        pagination = ListPagination.from_dict(d.pop("pagination"))




        vault_credential_version_list_response = cls(
            data=data,
            pagination=pagination,
        )


        vault_credential_version_list_response.additional_properties = d
        return vault_credential_version_list_response

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
