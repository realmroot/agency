from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from ..models.audit_record_actor_type import AuditRecordActorType
from ..models.audit_record_outcome import AuditRecordOutcome
from typing import cast
import datetime

if TYPE_CHECKING:
  from ..models.audit_record_after import AuditRecordAfter
  from ..models.audit_record_before import AuditRecordBefore
  from ..models.audit_record_metadata import AuditRecordMetadata





T = TypeVar("T", bound="AuditRecord")



@_attrs_define
class AuditRecord:
    """
        Attributes:
            id (str):
            project_id (None | str):
            actor_user_id (None | str):
            controller_user_id (None | str):
            actor_type (AuditRecordActorType):
            action (str):
            resource_type (str):
            resource_id (None | str):
            outcome (AuditRecordOutcome):
            request_id (None | str):
            correlation_id (None | str):
            session_id (None | str):
            policy_category (None | str):
            metadata (AuditRecordMetadata):
            before (AuditRecordBefore):
            after (AuditRecordAfter):
            created_at (datetime.datetime):
     """

    id: str
    project_id: None | str
    actor_user_id: None | str
    controller_user_id: None | str
    actor_type: AuditRecordActorType
    action: str
    resource_type: str
    resource_id: None | str
    outcome: AuditRecordOutcome
    request_id: None | str
    correlation_id: None | str
    session_id: None | str
    policy_category: None | str
    metadata: AuditRecordMetadata
    before: AuditRecordBefore
    after: AuditRecordAfter
    created_at: datetime.datetime
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)





    def to_dict(self) -> dict[str, Any]:
        from ..models.audit_record_after import AuditRecordAfter
        from ..models.audit_record_before import AuditRecordBefore
        from ..models.audit_record_metadata import AuditRecordMetadata
        id = self.id

        project_id: None | str
        project_id = self.project_id

        actor_user_id: None | str
        actor_user_id = self.actor_user_id

        controller_user_id: None | str
        controller_user_id = self.controller_user_id

        actor_type = self.actor_type.value

        action = self.action

        resource_type = self.resource_type

        resource_id: None | str
        resource_id = self.resource_id

        outcome = self.outcome.value

        request_id: None | str
        request_id = self.request_id

        correlation_id: None | str
        correlation_id = self.correlation_id

        session_id: None | str
        session_id = self.session_id

        policy_category: None | str
        policy_category = self.policy_category

        metadata = self.metadata.to_dict()

        before = self.before.to_dict()

        after = self.after.to_dict()

        created_at = self.created_at.isoformat()


        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({
            "id": id,
            "projectId": project_id,
            "actorUserId": actor_user_id,
            "controllerUserId": controller_user_id,
            "actorType": actor_type,
            "action": action,
            "resourceType": resource_type,
            "resourceId": resource_id,
            "outcome": outcome,
            "requestId": request_id,
            "correlationId": correlation_id,
            "sessionId": session_id,
            "policyCategory": policy_category,
            "metadata": metadata,
            "before": before,
            "after": after,
            "createdAt": created_at,
        })

        return field_dict



    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.audit_record_after import AuditRecordAfter
        from ..models.audit_record_before import AuditRecordBefore
        from ..models.audit_record_metadata import AuditRecordMetadata
        d = dict(src_dict)
        id = d.pop("id")

        def _parse_project_id(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        project_id = _parse_project_id(d.pop("projectId"))


        def _parse_actor_user_id(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        actor_user_id = _parse_actor_user_id(d.pop("actorUserId"))


        def _parse_controller_user_id(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        controller_user_id = _parse_controller_user_id(d.pop("controllerUserId"))


        actor_type = AuditRecordActorType(d.pop("actorType"))




        action = d.pop("action")

        resource_type = d.pop("resourceType")

        def _parse_resource_id(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        resource_id = _parse_resource_id(d.pop("resourceId"))


        outcome = AuditRecordOutcome(d.pop("outcome"))




        def _parse_request_id(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        request_id = _parse_request_id(d.pop("requestId"))


        def _parse_correlation_id(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        correlation_id = _parse_correlation_id(d.pop("correlationId"))


        def _parse_session_id(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        session_id = _parse_session_id(d.pop("sessionId"))


        def _parse_policy_category(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        policy_category = _parse_policy_category(d.pop("policyCategory"))


        metadata = AuditRecordMetadata.from_dict(d.pop("metadata"))




        before = AuditRecordBefore.from_dict(d.pop("before"))




        after = AuditRecordAfter.from_dict(d.pop("after"))




        created_at = datetime.datetime.fromisoformat(d.pop("createdAt"))




        audit_record = cls(
            id=id,
            project_id=project_id,
            actor_user_id=actor_user_id,
            controller_user_id=controller_user_id,
            actor_type=actor_type,
            action=action,
            resource_type=resource_type,
            resource_id=resource_id,
            outcome=outcome,
            request_id=request_id,
            correlation_id=correlation_id,
            session_id=session_id,
            policy_category=policy_category,
            metadata=metadata,
            before=before,
            after=after,
            created_at=created_at,
        )


        audit_record.additional_properties = d
        return audit_record

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
