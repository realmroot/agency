from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from ..models.provider_model_availability import ProviderModelAvailability
from typing import cast
import datetime

if TYPE_CHECKING:
  from ..models.provider_model_metadata import ProviderModelMetadata
  from ..models.provider_model_pricing import ProviderModelPricing





T = TypeVar("T", bound="ProviderModel")



@_attrs_define
class ProviderModel:
    """
        Attributes:
            id (str):
            provider_id (str):
            model_id (str):
            display_name (str):
            capabilities (list[str]):
            context_window (int | None):
            pricing (ProviderModelPricing):
            availability (ProviderModelAvailability):
            metadata (ProviderModelMetadata):
            created_at (datetime.datetime):
            updated_at (datetime.datetime):
     """

    id: str
    provider_id: str
    model_id: str
    display_name: str
    capabilities: list[str]
    context_window: int | None
    pricing: ProviderModelPricing
    availability: ProviderModelAvailability
    metadata: ProviderModelMetadata
    created_at: datetime.datetime
    updated_at: datetime.datetime
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)





    def to_dict(self) -> dict[str, Any]:
        from ..models.provider_model_metadata import ProviderModelMetadata
        from ..models.provider_model_pricing import ProviderModelPricing
        id = self.id

        provider_id = self.provider_id

        model_id = self.model_id

        display_name = self.display_name

        capabilities = self.capabilities



        context_window: int | None
        context_window = self.context_window

        pricing = self.pricing.to_dict()

        availability = self.availability.value

        metadata = self.metadata.to_dict()

        created_at = self.created_at.isoformat()

        updated_at = self.updated_at.isoformat()


        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({
            "id": id,
            "providerId": provider_id,
            "modelId": model_id,
            "displayName": display_name,
            "capabilities": capabilities,
            "contextWindow": context_window,
            "pricing": pricing,
            "availability": availability,
            "metadata": metadata,
            "createdAt": created_at,
            "updatedAt": updated_at,
        })

        return field_dict



    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.provider_model_metadata import ProviderModelMetadata
        from ..models.provider_model_pricing import ProviderModelPricing
        d = dict(src_dict)
        id = d.pop("id")

        provider_id = d.pop("providerId")

        model_id = d.pop("modelId")

        display_name = d.pop("displayName")

        capabilities = cast(list[str], d.pop("capabilities"))


        def _parse_context_window(data: object) -> int | None:
            if data is None:
                return data
            return cast(int | None, data)

        context_window = _parse_context_window(d.pop("contextWindow"))


        pricing = ProviderModelPricing.from_dict(d.pop("pricing"))




        availability = ProviderModelAvailability(d.pop("availability"))




        metadata = ProviderModelMetadata.from_dict(d.pop("metadata"))




        created_at = datetime.datetime.fromisoformat(d.pop("createdAt"))




        updated_at = datetime.datetime.fromisoformat(d.pop("updatedAt"))




        provider_model = cls(
            id=id,
            provider_id=provider_id,
            model_id=model_id,
            display_name=display_name,
            capabilities=capabilities,
            context_window=context_window,
            pricing=pricing,
            availability=availability,
            metadata=metadata,
            created_at=created_at,
            updated_at=updated_at,
        )


        provider_model.additional_properties = d
        return provider_model

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
