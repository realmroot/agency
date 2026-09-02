from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from typing import cast

if TYPE_CHECKING:
  from ..models.trigger_template_metadata_annotations import TriggerTemplateMetadataAnnotations
  from ..models.trigger_template_metadata_labels import TriggerTemplateMetadataLabels





T = TypeVar("T", bound="TriggerTemplateMetadata")



@_attrs_define
class TriggerTemplateMetadata:
    """
        Attributes:
            labels (TriggerTemplateMetadataLabels):  Example: {'app': 'automation-service'}.
            annotations (TriggerTemplateMetadataAnnotations):  Example: {'owner': 'growth'}.
     """

    labels: TriggerTemplateMetadataLabels
    annotations: TriggerTemplateMetadataAnnotations
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)





    def to_dict(self) -> dict[str, Any]:
        from ..models.trigger_template_metadata_annotations import TriggerTemplateMetadataAnnotations
        from ..models.trigger_template_metadata_labels import TriggerTemplateMetadataLabels
        labels = self.labels.to_dict()

        annotations = self.annotations.to_dict()


        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({
            "labels": labels,
            "annotations": annotations,
        })

        return field_dict



    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.trigger_template_metadata_annotations import TriggerTemplateMetadataAnnotations
        from ..models.trigger_template_metadata_labels import TriggerTemplateMetadataLabels
        d = dict(src_dict)
        labels = TriggerTemplateMetadataLabels.from_dict(d.pop("labels"))




        annotations = TriggerTemplateMetadataAnnotations.from_dict(d.pop("annotations"))




        trigger_template_metadata = cls(
            labels=labels,
            annotations=annotations,
        )


        trigger_template_metadata.additional_properties = d
        return trigger_template_metadata

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
