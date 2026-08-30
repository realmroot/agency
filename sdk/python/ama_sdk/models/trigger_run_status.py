from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from ..models.trigger_run_status_phase import TriggerRunStatusPhase
from typing import cast
import datetime






T = TypeVar("T", bound="TriggerRunStatus")



@_attrs_define
class TriggerRunStatus:
    """
        Attributes:
            phase (TriggerRunStatusPhase):  Example: dispatched.
            idempotency_key (str):  Example: 0195f5d6-7c20-7000-8000-00000000000c:2026-05-26T12:00:00.000Z.
            correlation_id (str):  Example: schedule:0195f5d6-7c20-7000-8000-00000000000c:2026-05-26T12:00:00.000Z.
            heartbeat_at (datetime.datetime | None):  Example: 2026-05-26T12:01:00.000Z.
            triggered_at (datetime.datetime):  Example: 2026-05-26T12:01:00.000Z.
            session_id (None | str):  Example: 0195f5d6-7c20-7000-8000-00000000000e.
            error_message (None | str):
     """

    phase: TriggerRunStatusPhase
    idempotency_key: str
    correlation_id: str
    heartbeat_at: datetime.datetime | None
    triggered_at: datetime.datetime
    session_id: None | str
    error_message: None | str
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)





    def to_dict(self) -> dict[str, Any]:
        phase = self.phase.value

        idempotency_key = self.idempotency_key

        correlation_id = self.correlation_id

        heartbeat_at: None | str
        if isinstance(self.heartbeat_at, datetime.datetime):
            heartbeat_at = self.heartbeat_at.isoformat()
        else:
            heartbeat_at = self.heartbeat_at

        triggered_at = self.triggered_at.isoformat()

        session_id: None | str
        session_id = self.session_id

        error_message: None | str
        error_message = self.error_message


        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({
            "phase": phase,
            "idempotencyKey": idempotency_key,
            "correlationId": correlation_id,
            "heartbeatAt": heartbeat_at,
            "triggeredAt": triggered_at,
            "sessionId": session_id,
            "errorMessage": error_message,
        })

        return field_dict



    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        phase = TriggerRunStatusPhase(d.pop("phase"))




        idempotency_key = d.pop("idempotencyKey")

        correlation_id = d.pop("correlationId")

        def _parse_heartbeat_at(data: object) -> datetime.datetime | None:
            if data is None:
                return data
            try:
                if not isinstance(data, str):
                    raise TypeError()
                heartbeat_at_type_0 = datetime.datetime.fromisoformat(data)



                return heartbeat_at_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(datetime.datetime | None, data)

        heartbeat_at = _parse_heartbeat_at(d.pop("heartbeatAt"))


        triggered_at = datetime.datetime.fromisoformat(d.pop("triggeredAt"))




        def _parse_session_id(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        session_id = _parse_session_id(d.pop("sessionId"))


        def _parse_error_message(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        error_message = _parse_error_message(d.pop("errorMessage"))


        trigger_run_status = cls(
            phase=phase,
            idempotency_key=idempotency_key,
            correlation_id=correlation_id,
            heartbeat_at=heartbeat_at,
            triggered_at=triggered_at,
            session_id=session_id,
            error_message=error_message,
        )


        trigger_run_status.additional_properties = d
        return trigger_run_status

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
