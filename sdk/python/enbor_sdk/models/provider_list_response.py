from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from typing import cast

if TYPE_CHECKING:
  from ..models.provider import Provider
  from ..models.provider_list_response_pagination import ProviderListResponsePagination





T = TypeVar("T", bound="ProviderListResponse")



@_attrs_define
class ProviderListResponse:
    """
        Attributes:
            data (list[Provider]):
            pagination (ProviderListResponsePagination):
     """

    data: list[Provider]
    pagination: ProviderListResponsePagination
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)





    def to_dict(self) -> dict[str, Any]:
        from ..models.provider import Provider
        from ..models.provider_list_response_pagination import ProviderListResponsePagination
        data = []
        for data_item_data in self.data:
            data_item = data_item_data.to_dict()
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
        from ..models.provider import Provider
        from ..models.provider_list_response_pagination import ProviderListResponsePagination
        d = dict(src_dict)
        data = []
        _data = d.pop("data")
        for data_item_data in (_data):
            data_item = Provider.from_dict(data_item_data)



            data.append(data_item)


        pagination = ProviderListResponsePagination.from_dict(d.pop("pagination"))




        provider_list_response = cls(
            data=data,
            pagination=pagination,
        )


        provider_list_response.additional_properties = d
        return provider_list_response

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
