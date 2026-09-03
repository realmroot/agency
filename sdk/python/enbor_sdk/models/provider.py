from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from ..models.provider_model_catalog_state import ProviderModelCatalogState
from typing import cast
import datetime

if TYPE_CHECKING:
  from ..models.provider_error_type_0 import ProviderErrorType0
  from ..models.provider_metadata import ProviderMetadata





T = TypeVar("T", bound="Provider")



@_attrs_define
class Provider:
    """
        Attributes:
            id (str):  Example: anthropic.
            slug (str):  Example: anthropic.
            display_name (str):  Example: Anthropic.
            enabled (bool):  Example: True.
            metadata (ProviderMetadata):
            model_catalog_state (ProviderModelCatalogState):  Example: ready.
            last_error (None | ProviderErrorType0):
            created_at (datetime.datetime):
            updated_at (datetime.datetime):
     """

    id: str
    slug: str
    display_name: str
    enabled: bool
    metadata: ProviderMetadata
    model_catalog_state: ProviderModelCatalogState
    last_error: None | ProviderErrorType0
    created_at: datetime.datetime
    updated_at: datetime.datetime
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)





    def to_dict(self) -> dict[str, Any]:
        from ..models.provider_error_type_0 import ProviderErrorType0
        from ..models.provider_metadata import ProviderMetadata
        id = self.id

        slug = self.slug

        display_name = self.display_name

        enabled = self.enabled

        metadata = self.metadata.to_dict()

        model_catalog_state = self.model_catalog_state.value

        last_error: dict[str, Any] | None
        if isinstance(self.last_error, ProviderErrorType0):
            last_error = self.last_error.to_dict()
        else:
            last_error = self.last_error

        created_at = self.created_at.isoformat()

        updated_at = self.updated_at.isoformat()


        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({
            "id": id,
            "slug": slug,
            "displayName": display_name,
            "enabled": enabled,
            "metadata": metadata,
            "modelCatalogState": model_catalog_state,
            "lastError": last_error,
            "createdAt": created_at,
            "updatedAt": updated_at,
        })

        return field_dict



    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.provider_error_type_0 import ProviderErrorType0
        from ..models.provider_metadata import ProviderMetadata
        d = dict(src_dict)
        id = d.pop("id")

        slug = d.pop("slug")

        display_name = d.pop("displayName")

        enabled = d.pop("enabled")

        metadata = ProviderMetadata.from_dict(d.pop("metadata"))




        model_catalog_state = ProviderModelCatalogState(d.pop("modelCatalogState"))




        def _parse_last_error(data: object) -> None | ProviderErrorType0:
            if data is None:
                return data
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                componentsschemas_provider_error_type_0 = ProviderErrorType0.from_dict(data)



                return componentsschemas_provider_error_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(None | ProviderErrorType0, data)

        last_error = _parse_last_error(d.pop("lastError"))


        created_at = datetime.datetime.fromisoformat(d.pop("createdAt"))




        updated_at = datetime.datetime.fromisoformat(d.pop("updatedAt"))




        provider = cls(
            id=id,
            slug=slug,
            display_name=display_name,
            enabled=enabled,
            metadata=metadata,
            model_catalog_state=model_catalog_state,
            last_error=last_error,
            created_at=created_at,
            updated_at=updated_at,
        )


        provider.additional_properties = d
        return provider

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
