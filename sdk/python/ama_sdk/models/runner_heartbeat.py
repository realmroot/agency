from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from ..models.runner_heartbeat_state import RunnerHeartbeatState
from typing import cast
import datetime

if TYPE_CHECKING:
  from ..models.runner_runtime import RunnerRuntime
  from ..models.runtime_usage import RuntimeUsage





T = TypeVar("T", bound="RunnerHeartbeat")



@_attrs_define
class RunnerHeartbeat:
    """ 
        Attributes:
            runner_id (str):  Example: runner_abc123.
            state (RunnerHeartbeatState):  Example: active.
            current_load (int):  Example: 1.
            runtime_usage (list[RuntimeUsage]):
            runtimes (list[RunnerRuntime]):
            last_heartbeat_at (datetime.datetime | None):
     """

    runner_id: str
    state: RunnerHeartbeatState
    current_load: int
    runtime_usage: list[RuntimeUsage]
    runtimes: list[RunnerRuntime]
    last_heartbeat_at: datetime.datetime | None
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)





    def to_dict(self) -> dict[str, Any]:
        from ..models.runner_runtime import RunnerRuntime
        from ..models.runtime_usage import RuntimeUsage
        runner_id = self.runner_id

        state = self.state.value

        current_load = self.current_load

        runtime_usage = []
        for runtime_usage_item_data in self.runtime_usage:
            runtime_usage_item = runtime_usage_item_data.to_dict()
            runtime_usage.append(runtime_usage_item)



        runtimes = []
        for runtimes_item_data in self.runtimes:
            runtimes_item = runtimes_item_data.to_dict()
            runtimes.append(runtimes_item)



        last_heartbeat_at: None | str
        if isinstance(self.last_heartbeat_at, datetime.datetime):
            last_heartbeat_at = self.last_heartbeat_at.isoformat()
        else:
            last_heartbeat_at = self.last_heartbeat_at


        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({
            "runnerId": runner_id,
            "state": state,
            "currentLoad": current_load,
            "runtimeUsage": runtime_usage,
            "runtimes": runtimes,
            "lastHeartbeatAt": last_heartbeat_at,
        })

        return field_dict



    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.runner_runtime import RunnerRuntime
        from ..models.runtime_usage import RuntimeUsage
        d = dict(src_dict)
        runner_id = d.pop("runnerId")

        state = RunnerHeartbeatState(d.pop("state"))




        current_load = d.pop("currentLoad")

        runtime_usage = []
        _runtime_usage = d.pop("runtimeUsage")
        for runtime_usage_item_data in (_runtime_usage):
            runtime_usage_item = RuntimeUsage.from_dict(runtime_usage_item_data)



            runtime_usage.append(runtime_usage_item)


        runtimes = []
        _runtimes = d.pop("runtimes")
        for runtimes_item_data in (_runtimes):
            runtimes_item = RunnerRuntime.from_dict(runtimes_item_data)



            runtimes.append(runtimes_item)


        def _parse_last_heartbeat_at(data: object) -> datetime.datetime | None:
            if data is None:
                return data
            try:
                if not isinstance(data, str):
                    raise TypeError()
                last_heartbeat_at_type_0 = datetime.datetime.fromisoformat(data)



                return last_heartbeat_at_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(datetime.datetime | None, data)

        last_heartbeat_at = _parse_last_heartbeat_at(d.pop("lastHeartbeatAt"))


        runner_heartbeat = cls(
            runner_id=runner_id,
            state=state,
            current_load=current_load,
            runtime_usage=runtime_usage,
            runtimes=runtimes,
            last_heartbeat_at=last_heartbeat_at,
        )


        runner_heartbeat.additional_properties = d
        return runner_heartbeat

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
