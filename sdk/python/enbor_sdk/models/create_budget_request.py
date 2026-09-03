from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from ..models.create_budget_request_limit_type import CreateBudgetRequestLimitType
from ..models.create_budget_request_scope import CreateBudgetRequestScope
from ..models.create_budget_request_window import CreateBudgetRequestWindow
from ..types import UNSET, Unset
from typing import cast

if TYPE_CHECKING:
  from ..models.create_budget_request_metadata import CreateBudgetRequestMetadata





T = TypeVar("T", bound="CreateBudgetRequest")



@_attrs_define
class CreateBudgetRequest:
    """
        Attributes:
            scope (CreateBudgetRequestScope):  Example: project.
            limit_type (CreateBudgetRequestLimitType):  Example: tokens.
            limit_value (int):  Example: 1000000.
            window (CreateBudgetRequestWindow):  Example: month.
            provider_id (str | Unset):  Example: workers-ai.
            model_id (str | Unset):  Example: @cf/moonshotai/kimi-k2.6.
            enabled (bool | Unset):  Example: True.
            metadata (CreateBudgetRequestMetadata | Unset):
     """

    scope: CreateBudgetRequestScope
    limit_type: CreateBudgetRequestLimitType
    limit_value: int
    window: CreateBudgetRequestWindow
    provider_id: str | Unset = UNSET
    model_id: str | Unset = UNSET
    enabled: bool | Unset = UNSET
    metadata: CreateBudgetRequestMetadata | Unset = UNSET





    def to_dict(self) -> dict[str, Any]:
        from ..models.create_budget_request_metadata import CreateBudgetRequestMetadata
        scope = self.scope.value

        limit_type = self.limit_type.value

        limit_value = self.limit_value

        window = self.window.value

        provider_id = self.provider_id

        model_id = self.model_id

        enabled = self.enabled

        metadata: dict[str, Any] | Unset = UNSET
        if not isinstance(self.metadata, Unset):
            metadata = self.metadata.to_dict()


        field_dict: dict[str, Any] = {}

        field_dict.update({
            "scope": scope,
            "limitType": limit_type,
            "limitValue": limit_value,
            "window": window,
        })
        if provider_id is not UNSET:
            field_dict["providerId"] = provider_id
        if model_id is not UNSET:
            field_dict["modelId"] = model_id
        if enabled is not UNSET:
            field_dict["enabled"] = enabled
        if metadata is not UNSET:
            field_dict["metadata"] = metadata

        return field_dict



    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.create_budget_request_metadata import CreateBudgetRequestMetadata
        d = dict(src_dict)
        scope = CreateBudgetRequestScope(d.pop("scope"))




        limit_type = CreateBudgetRequestLimitType(d.pop("limitType"))




        limit_value = d.pop("limitValue")

        window = CreateBudgetRequestWindow(d.pop("window"))




        provider_id = d.pop("providerId", UNSET)

        model_id = d.pop("modelId", UNSET)

        enabled = d.pop("enabled", UNSET)

        _metadata = d.pop("metadata", UNSET)
        metadata: CreateBudgetRequestMetadata | Unset
        if isinstance(_metadata,  Unset):
            metadata = UNSET
        else:
            metadata = CreateBudgetRequestMetadata.from_dict(_metadata)




        create_budget_request = cls(
            scope=scope,
            limit_type=limit_type,
            limit_value=limit_value,
            window=window,
            provider_id=provider_id,
            model_id=model_id,
            enabled=enabled,
            metadata=metadata,
        )

        return create_budget_request
