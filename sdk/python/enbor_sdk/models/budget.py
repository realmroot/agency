from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from ..models.budget_limit_type import BudgetLimitType
from ..models.budget_scope import BudgetScope
from ..models.budget_window import BudgetWindow
from typing import cast
import datetime

if TYPE_CHECKING:
  from ..models.budget_metadata import BudgetMetadata





T = TypeVar("T", bound="Budget")



@_attrs_define
class Budget:
    """
        Attributes:
            id (str):
            scope (BudgetScope):
            provider_id (None | str):
            model_id (None | str):
            limit_type (BudgetLimitType):
            limit_value (int):
            window (BudgetWindow):
            enabled (bool):
            metadata (BudgetMetadata):
            created_at (datetime.datetime):
            updated_at (datetime.datetime):
     """

    id: str
    scope: BudgetScope
    provider_id: None | str
    model_id: None | str
    limit_type: BudgetLimitType
    limit_value: int
    window: BudgetWindow
    enabled: bool
    metadata: BudgetMetadata
    created_at: datetime.datetime
    updated_at: datetime.datetime
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)





    def to_dict(self) -> dict[str, Any]:
        from ..models.budget_metadata import BudgetMetadata
        id = self.id

        scope = self.scope.value

        provider_id: None | str
        provider_id = self.provider_id

        model_id: None | str
        model_id = self.model_id

        limit_type = self.limit_type.value

        limit_value = self.limit_value

        window = self.window.value

        enabled = self.enabled

        metadata = self.metadata.to_dict()

        created_at = self.created_at.isoformat()

        updated_at = self.updated_at.isoformat()


        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({
            "id": id,
            "scope": scope,
            "providerId": provider_id,
            "modelId": model_id,
            "limitType": limit_type,
            "limitValue": limit_value,
            "window": window,
            "enabled": enabled,
            "metadata": metadata,
            "createdAt": created_at,
            "updatedAt": updated_at,
        })

        return field_dict



    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.budget_metadata import BudgetMetadata
        d = dict(src_dict)
        id = d.pop("id")

        scope = BudgetScope(d.pop("scope"))




        def _parse_provider_id(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        provider_id = _parse_provider_id(d.pop("providerId"))


        def _parse_model_id(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        model_id = _parse_model_id(d.pop("modelId"))


        limit_type = BudgetLimitType(d.pop("limitType"))




        limit_value = d.pop("limitValue")

        window = BudgetWindow(d.pop("window"))




        enabled = d.pop("enabled")

        metadata = BudgetMetadata.from_dict(d.pop("metadata"))




        created_at = datetime.datetime.fromisoformat(d.pop("createdAt"))




        updated_at = datetime.datetime.fromisoformat(d.pop("updatedAt"))




        budget = cls(
            id=id,
            scope=scope,
            provider_id=provider_id,
            model_id=model_id,
            limit_type=limit_type,
            limit_value=limit_value,
            window=window,
            enabled=enabled,
            metadata=metadata,
            created_at=created_at,
            updated_at=updated_at,
        )


        budget.additional_properties = d
        return budget

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
