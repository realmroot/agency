from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from ..models.work_item_state import WorkItemState
from typing import cast
import datetime

if TYPE_CHECKING:
  from ..models.work_item_error_type_0 import WorkItemErrorType0
  from ..models.work_item_payload import WorkItemPayload
  from ..models.work_item_result_type_0 import WorkItemResultType0





T = TypeVar("T", bound="WorkItem")



@_attrs_define
class WorkItem:
    """
        Attributes:
            id (str):  Example: 0195f5d6-7c20-7000-8000-000000000012.
            project_id (str):  Example: 0195f5d6-7c20-7000-8000-000000000001.
            session_id (None | str):  Example: 0195f5d6-7c20-7000-8000-00000000000e.
            environment_id (None | str):  Example: 0195f5d6-7c20-7000-8000-000000000005.
            runner_id (None | str):  Example: 0195f5d6-7c20-7000-8000-000000000011.
            lease_id (None | str):  Example: 0195f5d6-7c20-7000-8000-000000000013.
            type_ (str):  Example: session.start.
            state (WorkItemState):  Example: available.
            priority (int):
            attempts (int):  Example: 1.
            max_attempts (int):  Example: 3.
            payload (WorkItemPayload):
            result (None | WorkItemResultType0):
            error (None | WorkItemErrorType0):
            available_at (datetime.datetime):
            created_at (datetime.datetime):
            updated_at (datetime.datetime):
     """

    id: str
    project_id: str
    session_id: None | str
    environment_id: None | str
    runner_id: None | str
    lease_id: None | str
    type_: str
    state: WorkItemState
    priority: int
    attempts: int
    max_attempts: int
    payload: WorkItemPayload
    result: None | WorkItemResultType0
    error: None | WorkItemErrorType0
    available_at: datetime.datetime
    created_at: datetime.datetime
    updated_at: datetime.datetime
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)





    def to_dict(self) -> dict[str, Any]:
        from ..models.work_item_error_type_0 import WorkItemErrorType0
        from ..models.work_item_payload import WorkItemPayload
        from ..models.work_item_result_type_0 import WorkItemResultType0
        id = self.id

        project_id = self.project_id

        session_id: None | str
        session_id = self.session_id

        environment_id: None | str
        environment_id = self.environment_id

        runner_id: None | str
        runner_id = self.runner_id

        lease_id: None | str
        lease_id = self.lease_id

        type_ = self.type_

        state = self.state.value

        priority = self.priority

        attempts = self.attempts

        max_attempts = self.max_attempts

        payload = self.payload.to_dict()

        result: dict[str, Any] | None
        if isinstance(self.result, WorkItemResultType0):
            result = self.result.to_dict()
        else:
            result = self.result

        error: dict[str, Any] | None
        if isinstance(self.error, WorkItemErrorType0):
            error = self.error.to_dict()
        else:
            error = self.error

        available_at = self.available_at.isoformat()

        created_at = self.created_at.isoformat()

        updated_at = self.updated_at.isoformat()


        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({
            "id": id,
            "projectId": project_id,
            "sessionId": session_id,
            "environmentId": environment_id,
            "runnerId": runner_id,
            "leaseId": lease_id,
            "type": type_,
            "state": state,
            "priority": priority,
            "attempts": attempts,
            "maxAttempts": max_attempts,
            "payload": payload,
            "result": result,
            "error": error,
            "availableAt": available_at,
            "createdAt": created_at,
            "updatedAt": updated_at,
        })

        return field_dict



    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.work_item_error_type_0 import WorkItemErrorType0
        from ..models.work_item_payload import WorkItemPayload
        from ..models.work_item_result_type_0 import WorkItemResultType0
        d = dict(src_dict)
        id = d.pop("id")

        project_id = d.pop("projectId")

        def _parse_session_id(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        session_id = _parse_session_id(d.pop("sessionId"))


        def _parse_environment_id(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        environment_id = _parse_environment_id(d.pop("environmentId"))


        def _parse_runner_id(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        runner_id = _parse_runner_id(d.pop("runnerId"))


        def _parse_lease_id(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        lease_id = _parse_lease_id(d.pop("leaseId"))


        type_ = d.pop("type")

        state = WorkItemState(d.pop("state"))




        priority = d.pop("priority")

        attempts = d.pop("attempts")

        max_attempts = d.pop("maxAttempts")

        payload = WorkItemPayload.from_dict(d.pop("payload"))




        def _parse_result(data: object) -> None | WorkItemResultType0:
            if data is None:
                return data
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                result_type_0 = WorkItemResultType0.from_dict(data)



                return result_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(None | WorkItemResultType0, data)

        result = _parse_result(d.pop("result"))


        def _parse_error(data: object) -> None | WorkItemErrorType0:
            if data is None:
                return data
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                error_type_0 = WorkItemErrorType0.from_dict(data)



                return error_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(None | WorkItemErrorType0, data)

        error = _parse_error(d.pop("error"))


        available_at = datetime.datetime.fromisoformat(d.pop("availableAt"))




        created_at = datetime.datetime.fromisoformat(d.pop("createdAt"))




        updated_at = datetime.datetime.fromisoformat(d.pop("updatedAt"))




        work_item = cls(
            id=id,
            project_id=project_id,
            session_id=session_id,
            environment_id=environment_id,
            runner_id=runner_id,
            lease_id=lease_id,
            type_=type_,
            state=state,
            priority=priority,
            attempts=attempts,
            max_attempts=max_attempts,
            payload=payload,
            result=result,
            error=error,
            available_at=available_at,
            created_at=created_at,
            updated_at=updated_at,
        )


        work_item.additional_properties = d
        return work_item

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
