from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from ..models.session_status_phase import SessionStatusPhase
from typing import cast
import datetime

if TYPE_CHECKING:
  from ..models.session_bindings import SessionBindings
  from ..models.session_condition import SessionCondition
  from ..models.session_placement_type_0 import SessionPlacementType0





T = TypeVar("T", bound="SessionStatus")



@_attrs_define
class SessionStatus:
    """ 
        Attributes:
            phase (SessionStatusPhase):  Example: idle.
            reason (None | str):
            conditions (list[SessionCondition]):
            bindings (SessionBindings):
            placement (None | SessionPlacementType0):
            started_at (datetime.datetime | None):
            closed_at (datetime.datetime | None):
     """

    phase: SessionStatusPhase
    reason: None | str
    conditions: list[SessionCondition]
    bindings: SessionBindings
    placement: None | SessionPlacementType0
    started_at: datetime.datetime | None
    closed_at: datetime.datetime | None
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)





    def to_dict(self) -> dict[str, Any]:
        from ..models.session_bindings import SessionBindings
        from ..models.session_condition import SessionCondition
        from ..models.session_placement_type_0 import SessionPlacementType0
        phase = self.phase.value

        reason: None | str
        reason = self.reason

        conditions = []
        for conditions_item_data in self.conditions:
            conditions_item = conditions_item_data.to_dict()
            conditions.append(conditions_item)



        bindings = self.bindings.to_dict()

        placement: dict[str, Any] | None
        if isinstance(self.placement, SessionPlacementType0):
            placement = self.placement.to_dict()
        else:
            placement = self.placement

        started_at: None | str
        if isinstance(self.started_at, datetime.datetime):
            started_at = self.started_at.isoformat()
        else:
            started_at = self.started_at

        closed_at: None | str
        if isinstance(self.closed_at, datetime.datetime):
            closed_at = self.closed_at.isoformat()
        else:
            closed_at = self.closed_at


        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({
            "phase": phase,
            "reason": reason,
            "conditions": conditions,
            "bindings": bindings,
            "placement": placement,
            "startedAt": started_at,
            "closedAt": closed_at,
        })

        return field_dict



    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.session_bindings import SessionBindings
        from ..models.session_condition import SessionCondition
        from ..models.session_placement_type_0 import SessionPlacementType0
        d = dict(src_dict)
        phase = SessionStatusPhase(d.pop("phase"))




        def _parse_reason(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        reason = _parse_reason(d.pop("reason"))


        conditions = []
        _conditions = d.pop("conditions")
        for conditions_item_data in (_conditions):
            conditions_item = SessionCondition.from_dict(conditions_item_data)



            conditions.append(conditions_item)


        bindings = SessionBindings.from_dict(d.pop("bindings"))




        def _parse_placement(data: object) -> None | SessionPlacementType0:
            if data is None:
                return data
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                componentsschemas_session_placement_type_0 = SessionPlacementType0.from_dict(data)



                return componentsschemas_session_placement_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(None | SessionPlacementType0, data)

        placement = _parse_placement(d.pop("placement"))


        def _parse_started_at(data: object) -> datetime.datetime | None:
            if data is None:
                return data
            try:
                if not isinstance(data, str):
                    raise TypeError()
                started_at_type_0 = datetime.datetime.fromisoformat(data)



                return started_at_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(datetime.datetime | None, data)

        started_at = _parse_started_at(d.pop("startedAt"))


        def _parse_closed_at(data: object) -> datetime.datetime | None:
            if data is None:
                return data
            try:
                if not isinstance(data, str):
                    raise TypeError()
                closed_at_type_0 = datetime.datetime.fromisoformat(data)



                return closed_at_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(datetime.datetime | None, data)

        closed_at = _parse_closed_at(d.pop("closedAt"))


        session_status = cls(
            phase=phase,
            reason=reason,
            conditions=conditions,
            bindings=bindings,
            placement=placement,
            started_at=started_at,
            closed_at=closed_at,
        )


        session_status.additional_properties = d
        return session_status

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
