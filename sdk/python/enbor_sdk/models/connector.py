from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from ..models.connector_availability import ConnectorAvailability
from ..models.connector_category import ConnectorCategory
from ..models.connector_supported_auth_modes_item import ConnectorSupportedAuthModesItem
from ..models.connector_trust_level import ConnectorTrustLevel
from typing import cast
import datetime

if TYPE_CHECKING:
  from ..models.connector_metadata import ConnectorMetadata
  from ..models.connector_tool import ConnectorTool





T = TypeVar("T", bound="Connector")



@_attrs_define
class Connector:
    """
        Attributes:
            id (str):
            name (str):
            description (str):
            category (ConnectorCategory):
            trust_level (ConnectorTrustLevel):
            capabilities (list[str]):
            supported_auth_modes (list[ConnectorSupportedAuthModesItem]):
            setup_requirements (list[str]):
            tools (list[ConnectorTool]):
            metadata (ConnectorMetadata):
            availability (ConnectorAvailability):
            created_at (datetime.datetime):
            updated_at (datetime.datetime):
     """

    id: str
    name: str
    description: str
    category: ConnectorCategory
    trust_level: ConnectorTrustLevel
    capabilities: list[str]
    supported_auth_modes: list[ConnectorSupportedAuthModesItem]
    setup_requirements: list[str]
    tools: list[ConnectorTool]
    metadata: ConnectorMetadata
    availability: ConnectorAvailability
    created_at: datetime.datetime
    updated_at: datetime.datetime
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)





    def to_dict(self) -> dict[str, Any]:
        from ..models.connector_metadata import ConnectorMetadata
        from ..models.connector_tool import ConnectorTool
        id = self.id

        name = self.name

        description = self.description

        category = self.category.value

        trust_level = self.trust_level.value

        capabilities = self.capabilities



        supported_auth_modes = []
        for supported_auth_modes_item_data in self.supported_auth_modes:
            supported_auth_modes_item = supported_auth_modes_item_data.value
            supported_auth_modes.append(supported_auth_modes_item)



        setup_requirements = self.setup_requirements



        tools = []
        for tools_item_data in self.tools:
            tools_item = tools_item_data.to_dict()
            tools.append(tools_item)



        metadata = self.metadata.to_dict()

        availability = self.availability.value

        created_at = self.created_at.isoformat()

        updated_at = self.updated_at.isoformat()


        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({
            "id": id,
            "name": name,
            "description": description,
            "category": category,
            "trustLevel": trust_level,
            "capabilities": capabilities,
            "supportedAuthModes": supported_auth_modes,
            "setupRequirements": setup_requirements,
            "tools": tools,
            "metadata": metadata,
            "availability": availability,
            "createdAt": created_at,
            "updatedAt": updated_at,
        })

        return field_dict



    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.connector_metadata import ConnectorMetadata
        from ..models.connector_tool import ConnectorTool
        d = dict(src_dict)
        id = d.pop("id")

        name = d.pop("name")

        description = d.pop("description")

        category = ConnectorCategory(d.pop("category"))




        trust_level = ConnectorTrustLevel(d.pop("trustLevel"))




        capabilities = cast(list[str], d.pop("capabilities"))


        supported_auth_modes = []
        _supported_auth_modes = d.pop("supportedAuthModes")
        for supported_auth_modes_item_data in (_supported_auth_modes):
            supported_auth_modes_item = ConnectorSupportedAuthModesItem(supported_auth_modes_item_data)



            supported_auth_modes.append(supported_auth_modes_item)


        setup_requirements = cast(list[str], d.pop("setupRequirements"))


        tools = []
        _tools = d.pop("tools")
        for tools_item_data in (_tools):
            tools_item = ConnectorTool.from_dict(tools_item_data)



            tools.append(tools_item)


        metadata = ConnectorMetadata.from_dict(d.pop("metadata"))




        availability = ConnectorAvailability(d.pop("availability"))




        created_at = datetime.datetime.fromisoformat(d.pop("createdAt"))




        updated_at = datetime.datetime.fromisoformat(d.pop("updatedAt"))




        connector = cls(
            id=id,
            name=name,
            description=description,
            category=category,
            trust_level=trust_level,
            capabilities=capabilities,
            supported_auth_modes=supported_auth_modes,
            setup_requirements=setup_requirements,
            tools=tools,
            metadata=metadata,
            availability=availability,
            created_at=created_at,
            updated_at=updated_at,
        )


        connector.additional_properties = d
        return connector

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
