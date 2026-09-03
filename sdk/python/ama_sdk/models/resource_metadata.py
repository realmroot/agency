from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from typing import cast
import datetime

if TYPE_CHECKING:
  from ..models.resource_metadata_annotations import ResourceMetadataAnnotations
  from ..models.resource_metadata_labels import ResourceMetadataLabels





T = TypeVar("T", bound="ResourceMetadata")



@_attrs_define
class ResourceMetadata:
    """
        Attributes:
            uid (str):  Example: 0195f5d6-7c20-7000-8000-000000000017.
            project_id (None | str):  Example: 0195f5d6-7c20-7000-8000-000000000001.
            name (str):  Example: Default resource.
            description (None | str):  Example: Default project resource..
            labels (ResourceMetadataLabels):
            annotations (ResourceMetadataAnnotations):
            created_by (None | str):
            created_at (datetime.datetime):
            updated_at (datetime.datetime):
     """

    uid: str
    project_id: None | str
    name: str
    description: None | str
    labels: ResourceMetadataLabels
    annotations: ResourceMetadataAnnotations
    created_by: None | str
    created_at: datetime.datetime
    updated_at: datetime.datetime
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)





    def to_dict(self) -> dict[str, Any]:
        from ..models.resource_metadata_annotations import ResourceMetadataAnnotations
        from ..models.resource_metadata_labels import ResourceMetadataLabels
        uid = self.uid

        project_id: None | str
        project_id = self.project_id

        name = self.name

        description: None | str
        description = self.description

        labels = self.labels.to_dict()

        annotations = self.annotations.to_dict()

        created_by: None | str
        created_by = self.created_by

        created_at = self.created_at.isoformat()

        updated_at = self.updated_at.isoformat()


        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({
            "uid": uid,
            "projectId": project_id,
            "name": name,
            "description": description,
            "labels": labels,
            "annotations": annotations,
            "createdBy": created_by,
            "createdAt": created_at,
            "updatedAt": updated_at,
        })

        return field_dict



    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.resource_metadata_annotations import ResourceMetadataAnnotations
        from ..models.resource_metadata_labels import ResourceMetadataLabels
        d = dict(src_dict)
        uid = d.pop("uid")

        def _parse_project_id(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        project_id = _parse_project_id(d.pop("projectId"))


        name = d.pop("name")

        def _parse_description(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        description = _parse_description(d.pop("description"))


        labels = ResourceMetadataLabels.from_dict(d.pop("labels"))




        annotations = ResourceMetadataAnnotations.from_dict(d.pop("annotations"))




        def _parse_created_by(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        created_by = _parse_created_by(d.pop("createdBy"))


        created_at = datetime.datetime.fromisoformat(d.pop("createdAt"))




        updated_at = datetime.datetime.fromisoformat(d.pop("updatedAt"))




        resource_metadata = cls(
            uid=uid,
            project_id=project_id,
            name=name,
            description=description,
            labels=labels,
            annotations=annotations,
            created_by=created_by,
            created_at=created_at,
            updated_at=updated_at,
        )


        resource_metadata.additional_properties = d
        return resource_metadata

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
