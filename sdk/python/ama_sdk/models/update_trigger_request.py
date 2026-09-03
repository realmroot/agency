from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from ..types import UNSET, Unset
from typing import cast

if TYPE_CHECKING:
  from ..models.trigger_update_metadata import TriggerUpdateMetadata
  from ..models.update_trigger_request_spec import UpdateTriggerRequestSpec





T = TypeVar("T", bound="UpdateTriggerRequest")



@_attrs_define
class UpdateTriggerRequest:
    """
        Attributes:
            metadata (TriggerUpdateMetadata | Unset):
            spec (UpdateTriggerRequestSpec | Unset):
     """

    metadata: TriggerUpdateMetadata | Unset = UNSET
    spec: UpdateTriggerRequestSpec | Unset = UNSET





    def to_dict(self) -> dict[str, Any]:
        from ..models.trigger_update_metadata import TriggerUpdateMetadata
        from ..models.update_trigger_request_spec import UpdateTriggerRequestSpec
        metadata: dict[str, Any] | Unset = UNSET
        if not isinstance(self.metadata, Unset):
            metadata = self.metadata.to_dict()

        spec: dict[str, Any] | Unset = UNSET
        if not isinstance(self.spec, Unset):
            spec = self.spec.to_dict()


        field_dict: dict[str, Any] = {}

        field_dict.update({
        })
        if metadata is not UNSET:
            field_dict["metadata"] = metadata
        if spec is not UNSET:
            field_dict["spec"] = spec

        return field_dict



    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.trigger_update_metadata import TriggerUpdateMetadata
        from ..models.update_trigger_request_spec import UpdateTriggerRequestSpec
        d = dict(src_dict)
        _metadata = d.pop("metadata", UNSET)
        metadata: TriggerUpdateMetadata | Unset
        if isinstance(_metadata,  Unset):
            metadata = UNSET
        else:
            metadata = TriggerUpdateMetadata.from_dict(_metadata)




        _spec = d.pop("spec", UNSET)
        spec: UpdateTriggerRequestSpec | Unset
        if isinstance(_spec,  Unset):
            spec = UNSET
        else:
            spec = UpdateTriggerRequestSpec.from_dict(_spec)




        update_trigger_request = cls(
            metadata=metadata,
            spec=spec,
        )

        return update_trigger_request
