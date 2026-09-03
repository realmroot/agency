from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from typing import cast

if TYPE_CHECKING:
  from ..models.create_trigger_request_spec import CreateTriggerRequestSpec
  from ..models.trigger_create_metadata import TriggerCreateMetadata





T = TypeVar("T", bound="CreateTriggerRequest")



@_attrs_define
class CreateTriggerRequest:
    """
        Attributes:
            metadata (TriggerCreateMetadata):  Example: {'name': 'Daily research heartbeat'}.
            spec (CreateTriggerRequestSpec):
     """

    metadata: TriggerCreateMetadata
    spec: CreateTriggerRequestSpec





    def to_dict(self) -> dict[str, Any]:
        from ..models.create_trigger_request_spec import CreateTriggerRequestSpec
        from ..models.trigger_create_metadata import TriggerCreateMetadata
        metadata = self.metadata.to_dict()

        spec = self.spec.to_dict()


        field_dict: dict[str, Any] = {}

        field_dict.update({
            "metadata": metadata,
            "spec": spec,
        })

        return field_dict



    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.create_trigger_request_spec import CreateTriggerRequestSpec
        from ..models.trigger_create_metadata import TriggerCreateMetadata
        d = dict(src_dict)
        metadata = TriggerCreateMetadata.from_dict(d.pop("metadata"))




        spec = CreateTriggerRequestSpec.from_dict(d.pop("spec"))




        create_trigger_request = cls(
            metadata=metadata,
            spec=spec,
        )

        return create_trigger_request
