from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from ..models.resource_phase import ResourcePhase
from typing import cast
import datetime






T = TypeVar("T", bound="TriggerStatus")



@_attrs_define
class TriggerStatus:
    """
        Attributes:
            phase (ResourcePhase):
            next_due_at (datetime.datetime | None):  Example: 2026-05-26T12:00:00.000Z.
            last_dispatched_at (datetime.datetime | None):
            last_run_id (None | str):  Example: 0195f5d6-7c20-7000-8000-00000000000d.
     """

    phase: ResourcePhase
    next_due_at: datetime.datetime | None
    last_dispatched_at: datetime.datetime | None
    last_run_id: None | str
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)





    def to_dict(self) -> dict[str, Any]:
        phase = self.phase.value

        next_due_at: None | str
        if isinstance(self.next_due_at, datetime.datetime):
            next_due_at = self.next_due_at.isoformat()
        else:
            next_due_at = self.next_due_at

        last_dispatched_at: None | str
        if isinstance(self.last_dispatched_at, datetime.datetime):
            last_dispatched_at = self.last_dispatched_at.isoformat()
        else:
            last_dispatched_at = self.last_dispatched_at

        last_run_id: None | str
        last_run_id = self.last_run_id


        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({
            "phase": phase,
            "nextDueAt": next_due_at,
            "lastDispatchedAt": last_dispatched_at,
            "lastRunId": last_run_id,
        })

        return field_dict



    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        phase = ResourcePhase(d.pop("phase"))




        def _parse_next_due_at(data: object) -> datetime.datetime | None:
            if data is None:
                return data
            try:
                if not isinstance(data, str):
                    raise TypeError()
                next_due_at_type_0 = datetime.datetime.fromisoformat(data)



                return next_due_at_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(datetime.datetime | None, data)

        next_due_at = _parse_next_due_at(d.pop("nextDueAt"))


        def _parse_last_dispatched_at(data: object) -> datetime.datetime | None:
            if data is None:
                return data
            try:
                if not isinstance(data, str):
                    raise TypeError()
                last_dispatched_at_type_0 = datetime.datetime.fromisoformat(data)



                return last_dispatched_at_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(datetime.datetime | None, data)

        last_dispatched_at = _parse_last_dispatched_at(d.pop("lastDispatchedAt"))


        def _parse_last_run_id(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        last_run_id = _parse_last_run_id(d.pop("lastRunId"))


        trigger_status = cls(
            phase=phase,
            next_due_at=next_due_at,
            last_dispatched_at=last_dispatched_at,
            last_run_id=last_run_id,
        )


        trigger_status.additional_properties = d
        return trigger_status

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
