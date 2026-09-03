from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from ..models.update_budget_request_window import UpdateBudgetRequestWindow
from ..types import UNSET, Unset
from typing import cast

if TYPE_CHECKING:
  from ..models.update_budget_request_metadata import UpdateBudgetRequestMetadata





T = TypeVar("T", bound="UpdateBudgetRequest")



@_attrs_define
class UpdateBudgetRequest:
    """
        Attributes:
            limit_value (int | Unset):
            window (UpdateBudgetRequestWindow | Unset):
            enabled (bool | Unset):
            metadata (UpdateBudgetRequestMetadata | Unset):
     """

    limit_value: int | Unset = UNSET
    window: UpdateBudgetRequestWindow | Unset = UNSET
    enabled: bool | Unset = UNSET
    metadata: UpdateBudgetRequestMetadata | Unset = UNSET





    def to_dict(self) -> dict[str, Any]:
        from ..models.update_budget_request_metadata import UpdateBudgetRequestMetadata
        limit_value = self.limit_value

        window: str | Unset = UNSET
        if not isinstance(self.window, Unset):
            window = self.window.value


        enabled = self.enabled

        metadata: dict[str, Any] | Unset = UNSET
        if not isinstance(self.metadata, Unset):
            metadata = self.metadata.to_dict()


        field_dict: dict[str, Any] = {}

        field_dict.update({
        })
        if limit_value is not UNSET:
            field_dict["limitValue"] = limit_value
        if window is not UNSET:
            field_dict["window"] = window
        if enabled is not UNSET:
            field_dict["enabled"] = enabled
        if metadata is not UNSET:
            field_dict["metadata"] = metadata

        return field_dict



    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.update_budget_request_metadata import UpdateBudgetRequestMetadata
        d = dict(src_dict)
        limit_value = d.pop("limitValue", UNSET)

        _window = d.pop("window", UNSET)
        window: UpdateBudgetRequestWindow | Unset
        if isinstance(_window,  Unset):
            window = UNSET
        else:
            window = UpdateBudgetRequestWindow(_window)




        enabled = d.pop("enabled", UNSET)

        _metadata = d.pop("metadata", UNSET)
        metadata: UpdateBudgetRequestMetadata | Unset
        if isinstance(_metadata,  Unset):
            metadata = UNSET
        else:
            metadata = UpdateBudgetRequestMetadata.from_dict(_metadata)




        update_budget_request = cls(
            limit_value=limit_value,
            window=window,
            enabled=enabled,
            metadata=metadata,
        )

        return update_budget_request
