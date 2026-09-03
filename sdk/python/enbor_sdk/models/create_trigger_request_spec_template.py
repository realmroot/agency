from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from ..types import UNSET, Unset
from typing import cast

if TYPE_CHECKING:
  from ..models.create_trigger_request_spec_template_metadata import CreateTriggerRequestSpecTemplateMetadata
  from ..models.create_trigger_request_spec_template_spec import CreateTriggerRequestSpecTemplateSpec





T = TypeVar("T", bound="CreateTriggerRequestSpecTemplate")



@_attrs_define
class CreateTriggerRequestSpecTemplate:
    """
        Attributes:
            spec (CreateTriggerRequestSpecTemplateSpec):
            metadata (CreateTriggerRequestSpecTemplateMetadata | Unset):
     """

    spec: CreateTriggerRequestSpecTemplateSpec
    metadata: CreateTriggerRequestSpecTemplateMetadata | Unset = UNSET





    def to_dict(self) -> dict[str, Any]:
        from ..models.create_trigger_request_spec_template_metadata import CreateTriggerRequestSpecTemplateMetadata
        from ..models.create_trigger_request_spec_template_spec import CreateTriggerRequestSpecTemplateSpec
        spec = self.spec.to_dict()

        metadata: dict[str, Any] | Unset = UNSET
        if not isinstance(self.metadata, Unset):
            metadata = self.metadata.to_dict()


        field_dict: dict[str, Any] = {}

        field_dict.update({
            "spec": spec,
        })
        if metadata is not UNSET:
            field_dict["metadata"] = metadata

        return field_dict



    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.create_trigger_request_spec_template_metadata import CreateTriggerRequestSpecTemplateMetadata
        from ..models.create_trigger_request_spec_template_spec import CreateTriggerRequestSpecTemplateSpec
        d = dict(src_dict)
        spec = CreateTriggerRequestSpecTemplateSpec.from_dict(d.pop("spec"))




        _metadata = d.pop("metadata", UNSET)
        metadata: CreateTriggerRequestSpecTemplateMetadata | Unset
        if isinstance(_metadata,  Unset):
            metadata = UNSET
        else:
            metadata = CreateTriggerRequestSpecTemplateMetadata.from_dict(_metadata)




        create_trigger_request_spec_template = cls(
            spec=spec,
            metadata=metadata,
        )

        return create_trigger_request_spec_template
