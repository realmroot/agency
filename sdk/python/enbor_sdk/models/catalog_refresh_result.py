from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from ..models.catalog_refresh_result_category import CatalogRefreshResultCategory
from ..models.catalog_refresh_result_outcome import CatalogRefreshResultOutcome
from ..types import UNSET, Unset






T = TypeVar("T", bound="CatalogRefreshResult")



@_attrs_define
class CatalogRefreshResult:
    """
        Attributes:
            outcome (CatalogRefreshResultOutcome):  Example: succeeded.
            discovered_count (int):  Example: 41.
            vendors (int):  Example: 3.
            category (CatalogRefreshResultCategory | Unset):
     """

    outcome: CatalogRefreshResultOutcome
    discovered_count: int
    vendors: int
    category: CatalogRefreshResultCategory | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)





    def to_dict(self) -> dict[str, Any]:
        outcome = self.outcome.value

        discovered_count = self.discovered_count

        vendors = self.vendors

        category: str | Unset = UNSET
        if not isinstance(self.category, Unset):
            category = self.category.value



        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({
            "outcome": outcome,
            "discoveredCount": discovered_count,
            "vendors": vendors,
        })
        if category is not UNSET:
            field_dict["category"] = category

        return field_dict



    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        outcome = CatalogRefreshResultOutcome(d.pop("outcome"))




        discovered_count = d.pop("discoveredCount")

        vendors = d.pop("vendors")

        _category = d.pop("category", UNSET)
        category: CatalogRefreshResultCategory | Unset
        if isinstance(_category,  Unset):
            category = UNSET
        else:
            category = CatalogRefreshResultCategory(_category)




        catalog_refresh_result = cls(
            outcome=outcome,
            discovered_count=discovered_count,
            vendors=vendors,
            category=category,
        )


        catalog_refresh_result.additional_properties = d
        return catalog_refresh_result

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
