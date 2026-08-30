from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from ..models.runner_auth_mode import RunnerAuthMode
from ..models.runner_state import RunnerState
from typing import cast
import datetime

if TYPE_CHECKING:
  from ..models.runner_metadata import RunnerMetadata
  from ..models.runner_runtime import RunnerRuntime
  from ..models.runtime_usage import RuntimeUsage





T = TypeVar("T", bound="Runner")



@_attrs_define
class Runner:
    """
        Attributes:
            id (str):  Example: 0195f5d6-7c20-7000-8000-000000000011.
            project_id (str):  Example: 0195f5d6-7c20-7000-8000-000000000001.
            name (str):  Example: mac-mini-build-runner.
            environment_id (None | str):  Example: 0195f5d6-7c20-7000-8000-000000000005.
            secret_ref (None | str):  Example:
                ama://vaults/0195f5d6-7c20-7000-8000-000000000007/credentials/0195f5d6-7c20-7000-8000-000000000008.
            auth_mode (RunnerAuthMode):  Example: realmroot.
            state (RunnerState):  Example: active.
            current_load (int):
            max_concurrent (int):  Example: 2.
            runtime_usage (list[RuntimeUsage]):
            runtimes (list[RunnerRuntime]):
            metadata (RunnerMetadata):  Example: {'pool': 'default'}.
            last_heartbeat_at (datetime.datetime | None):
            archived_at (datetime.datetime | None):
            created_at (datetime.datetime):
            updated_at (datetime.datetime):
     """

    id: str
    project_id: str
    name: str
    environment_id: None | str
    secret_ref: None | str
    auth_mode: RunnerAuthMode
    state: RunnerState
    current_load: int
    max_concurrent: int
    runtime_usage: list[RuntimeUsage]
    runtimes: list[RunnerRuntime]
    metadata: RunnerMetadata
    last_heartbeat_at: datetime.datetime | None
    archived_at: datetime.datetime | None
    created_at: datetime.datetime
    updated_at: datetime.datetime
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)





    def to_dict(self) -> dict[str, Any]:
        from ..models.runner_metadata import RunnerMetadata
        from ..models.runner_runtime import RunnerRuntime
        from ..models.runtime_usage import RuntimeUsage
        id = self.id

        project_id = self.project_id

        name = self.name

        environment_id: None | str
        environment_id = self.environment_id

        secret_ref: None | str
        secret_ref = self.secret_ref

        auth_mode = self.auth_mode.value

        state = self.state.value

        current_load = self.current_load

        max_concurrent = self.max_concurrent

        runtime_usage = []
        for runtime_usage_item_data in self.runtime_usage:
            runtime_usage_item = runtime_usage_item_data.to_dict()
            runtime_usage.append(runtime_usage_item)



        runtimes = []
        for runtimes_item_data in self.runtimes:
            runtimes_item = runtimes_item_data.to_dict()
            runtimes.append(runtimes_item)



        metadata = self.metadata.to_dict()

        last_heartbeat_at: None | str
        if isinstance(self.last_heartbeat_at, datetime.datetime):
            last_heartbeat_at = self.last_heartbeat_at.isoformat()
        else:
            last_heartbeat_at = self.last_heartbeat_at

        archived_at: None | str
        if isinstance(self.archived_at, datetime.datetime):
            archived_at = self.archived_at.isoformat()
        else:
            archived_at = self.archived_at

        created_at = self.created_at.isoformat()

        updated_at = self.updated_at.isoformat()


        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({
            "id": id,
            "projectId": project_id,
            "name": name,
            "environmentId": environment_id,
            "secretRef": secret_ref,
            "authMode": auth_mode,
            "state": state,
            "currentLoad": current_load,
            "maxConcurrent": max_concurrent,
            "runtimeUsage": runtime_usage,
            "runtimes": runtimes,
            "metadata": metadata,
            "lastHeartbeatAt": last_heartbeat_at,
            "archivedAt": archived_at,
            "createdAt": created_at,
            "updatedAt": updated_at,
        })

        return field_dict



    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.runner_metadata import RunnerMetadata
        from ..models.runner_runtime import RunnerRuntime
        from ..models.runtime_usage import RuntimeUsage
        d = dict(src_dict)
        id = d.pop("id")

        project_id = d.pop("projectId")

        name = d.pop("name")

        def _parse_environment_id(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        environment_id = _parse_environment_id(d.pop("environmentId"))


        def _parse_secret_ref(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        secret_ref = _parse_secret_ref(d.pop("secretRef"))


        auth_mode = RunnerAuthMode(d.pop("authMode"))




        state = RunnerState(d.pop("state"))




        current_load = d.pop("currentLoad")

        max_concurrent = d.pop("maxConcurrent")

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


        metadata = RunnerMetadata.from_dict(d.pop("metadata"))




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


        def _parse_archived_at(data: object) -> datetime.datetime | None:
            if data is None:
                return data
            try:
                if not isinstance(data, str):
                    raise TypeError()
                archived_at_type_0 = datetime.datetime.fromisoformat(data)



                return archived_at_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(datetime.datetime | None, data)

        archived_at = _parse_archived_at(d.pop("archivedAt"))


        created_at = datetime.datetime.fromisoformat(d.pop("createdAt"))




        updated_at = datetime.datetime.fromisoformat(d.pop("updatedAt"))




        runner = cls(
            id=id,
            project_id=project_id,
            name=name,
            environment_id=environment_id,
            secret_ref=secret_ref,
            auth_mode=auth_mode,
            state=state,
            current_load=current_load,
            max_concurrent=max_concurrent,
            runtime_usage=runtime_usage,
            runtimes=runtimes,
            metadata=metadata,
            last_heartbeat_at=last_heartbeat_at,
            archived_at=archived_at,
            created_at=created_at,
            updated_at=updated_at,
        )


        runner.additional_properties = d
        return runner

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
