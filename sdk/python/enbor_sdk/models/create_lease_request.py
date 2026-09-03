from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from ..types import UNSET, Unset






T = TypeVar("T", bound="CreateLeaseRequest")



@_attrs_define
class CreateLeaseRequest:
    """
        Attributes:
            work_item_id (str):  Example: 0195f5d6-7c20-7000-8000-000000000012.
            runner_id (str):  Example: 0195f5d6-7c20-7000-8000-000000000011.
            lease_duration_seconds (int | Unset):  Example: 60.
     """

    work_item_id: str
    runner_id: str
    lease_duration_seconds: int | Unset = UNSET





    def to_dict(self) -> dict[str, Any]:
        work_item_id = self.work_item_id

        runner_id = self.runner_id

        lease_duration_seconds = self.lease_duration_seconds


        field_dict: dict[str, Any] = {}

        field_dict.update({
            "workItemId": work_item_id,
            "runnerId": runner_id,
        })
        if lease_duration_seconds is not UNSET:
            field_dict["leaseDurationSeconds"] = lease_duration_seconds

        return field_dict



    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        work_item_id = d.pop("workItemId")

        runner_id = d.pop("runnerId")

        lease_duration_seconds = d.pop("leaseDurationSeconds", UNSET)

        create_lease_request = cls(
            work_item_id=work_item_id,
            runner_id=runner_id,
            lease_duration_seconds=lease_duration_seconds,
        )

        return create_lease_request
