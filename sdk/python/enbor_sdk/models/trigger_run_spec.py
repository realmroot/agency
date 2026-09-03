from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from typing import cast
import datetime

if TYPE_CHECKING:
  from ..models.trigger_run_spec_metadata import TriggerRunSpecMetadata





T = TypeVar("T", bound="TriggerRunSpec")



@_attrs_define
class TriggerRunSpec:
    """
        Attributes:
            trigger_id (str):  Example: 0195f5d6-7c20-7000-8000-00000000000c.
            scheduled_for (datetime.datetime | None):  Example: 2026-05-26T12:00:00.000Z.
            metadata (TriggerRunSpecMetadata):  Example: {'source': 'trigger'}.
     """

    trigger_id: str
    scheduled_for: datetime.datetime | None
    metadata: TriggerRunSpecMetadata
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)





    def to_dict(self) -> dict[str, Any]:
        from ..models.trigger_run_spec_metadata import TriggerRunSpecMetadata
        trigger_id = self.trigger_id

        scheduled_for: None | str
        if isinstance(self.scheduled_for, datetime.datetime):
            scheduled_for = self.scheduled_for.isoformat()
        else:
            scheduled_for = self.scheduled_for

        metadata = self.metadata.to_dict()


        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({
            "triggerId": trigger_id,
            "scheduledFor": scheduled_for,
            "metadata": metadata,
        })

        return field_dict



    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.trigger_run_spec_metadata import TriggerRunSpecMetadata
        d = dict(src_dict)
        trigger_id = d.pop("triggerId")

        def _parse_scheduled_for(data: object) -> datetime.datetime | None:
            if data is None:
                return data
            try:
                if not isinstance(data, str):
                    raise TypeError()
                scheduled_for_type_0 = datetime.datetime.fromisoformat(data)



                return scheduled_for_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(datetime.datetime | None, data)

        scheduled_for = _parse_scheduled_for(d.pop("scheduledFor"))


        metadata = TriggerRunSpecMetadata.from_dict(d.pop("metadata"))




        trigger_run_spec = cls(
            trigger_id=trigger_id,
            scheduled_for=scheduled_for,
            metadata=metadata,
        )


        trigger_run_spec.additional_properties = d
        return trigger_run_spec

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
