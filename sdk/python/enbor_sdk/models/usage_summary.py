from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from ..models.usage_summary_group_by import UsageSummaryGroupBy
from typing import cast

if TYPE_CHECKING:
  from ..models.usage_summary_group import UsageSummaryGroup
  from ..models.usage_summary_totals import UsageSummaryTotals





T = TypeVar("T", bound="UsageSummary")



@_attrs_define
class UsageSummary:
    """
        Attributes:
            group_by (UsageSummaryGroupBy):
            totals (UsageSummaryTotals):
            groups (list[UsageSummaryGroup]):
     """

    group_by: UsageSummaryGroupBy
    totals: UsageSummaryTotals
    groups: list[UsageSummaryGroup]
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)





    def to_dict(self) -> dict[str, Any]:
        from ..models.usage_summary_group import UsageSummaryGroup
        from ..models.usage_summary_totals import UsageSummaryTotals
        group_by = self.group_by.value

        totals = self.totals.to_dict()

        groups = []
        for groups_item_data in self.groups:
            groups_item = groups_item_data.to_dict()
            groups.append(groups_item)




        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({
            "groupBy": group_by,
            "totals": totals,
            "groups": groups,
        })

        return field_dict



    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.usage_summary_group import UsageSummaryGroup
        from ..models.usage_summary_totals import UsageSummaryTotals
        d = dict(src_dict)
        group_by = UsageSummaryGroupBy(d.pop("groupBy"))




        totals = UsageSummaryTotals.from_dict(d.pop("totals"))




        groups = []
        _groups = d.pop("groups")
        for groups_item_data in (_groups):
            groups_item = UsageSummaryGroup.from_dict(groups_item_data)



            groups.append(groups_item)


        usage_summary = cls(
            group_by=group_by,
            totals=totals,
            groups=groups,
        )


        usage_summary.additional_properties = d
        return usage_summary

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
