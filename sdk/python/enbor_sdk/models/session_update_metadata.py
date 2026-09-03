from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from ..types import UNSET, Unset
from typing import cast

if TYPE_CHECKING:
  from ..models.session_update_metadata_annotations import SessionUpdateMetadataAnnotations
  from ..models.session_update_metadata_labels import SessionUpdateMetadataLabels





T = TypeVar("T", bound="SessionUpdateMetadata")



@_attrs_define
class SessionUpdateMetadata:
    """
        Attributes:
            name (str | Unset):  Example: Implement billing export.
            labels (SessionUpdateMetadataLabels | Unset):  Example: {'app': 'automation-service'}.
            annotations (SessionUpdateMetadataAnnotations | Unset):  Example: {'ticket': 'Enbor-123'}.
     """

    name: str | Unset = UNSET
    labels: SessionUpdateMetadataLabels | Unset = UNSET
    annotations: SessionUpdateMetadataAnnotations | Unset = UNSET





    def to_dict(self) -> dict[str, Any]:
        from ..models.session_update_metadata_annotations import SessionUpdateMetadataAnnotations
        from ..models.session_update_metadata_labels import SessionUpdateMetadataLabels
        name = self.name

        labels: dict[str, Any] | Unset = UNSET
        if not isinstance(self.labels, Unset):
            labels = self.labels.to_dict()

        annotations: dict[str, Any] | Unset = UNSET
        if not isinstance(self.annotations, Unset):
            annotations = self.annotations.to_dict()


        field_dict: dict[str, Any] = {}

        field_dict.update({
        })
        if name is not UNSET:
            field_dict["name"] = name
        if labels is not UNSET:
            field_dict["labels"] = labels
        if annotations is not UNSET:
            field_dict["annotations"] = annotations

        return field_dict



    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.session_update_metadata_annotations import SessionUpdateMetadataAnnotations
        from ..models.session_update_metadata_labels import SessionUpdateMetadataLabels
        d = dict(src_dict)
        name = d.pop("name", UNSET)

        _labels = d.pop("labels", UNSET)
        labels: SessionUpdateMetadataLabels | Unset
        if isinstance(_labels,  Unset):
            labels = UNSET
        else:
            labels = SessionUpdateMetadataLabels.from_dict(_labels)




        _annotations = d.pop("annotations", UNSET)
        annotations: SessionUpdateMetadataAnnotations | Unset
        if isinstance(_annotations,  Unset):
            annotations = UNSET
        else:
            annotations = SessionUpdateMetadataAnnotations.from_dict(_annotations)




        session_update_metadata = cls(
            name=name,
            labels=labels,
            annotations=annotations,
        )

        return session_update_metadata
