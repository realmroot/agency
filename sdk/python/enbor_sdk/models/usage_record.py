from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from ..models.usage_record_provider_type import UsageRecordProviderType
from ..models.usage_record_state import UsageRecordState
from ..models.usage_record_usage_type import UsageRecordUsageType
from typing import cast
import datetime

if TYPE_CHECKING:
  from ..models.usage_record_metadata import UsageRecordMetadata





T = TypeVar("T", bound="UsageRecord")



@_attrs_define
class UsageRecord:
    """
        Attributes:
            id (str):
            project_id (str):
            agent_id (None | str):
            agent_version_id (None | str):
            session_id (None | str):
            session_event_id (None | str):
            correlation_id (None | str):
            provider_id (None | str):
            provider_type (UsageRecordProviderType):
            model_id (str):
            state (UsageRecordState):
            prompt_tokens (int):
            completion_tokens (int):
            total_tokens (int):
            duration_ms (int):
            cost_micros (int):
            currency (str):
            usage_type (UsageRecordUsageType):
            metadata (UsageRecordMetadata):
            created_at (datetime.datetime):
     """

    id: str
    project_id: str
    agent_id: None | str
    agent_version_id: None | str
    session_id: None | str
    session_event_id: None | str
    correlation_id: None | str
    provider_id: None | str
    provider_type: UsageRecordProviderType
    model_id: str
    state: UsageRecordState
    prompt_tokens: int
    completion_tokens: int
    total_tokens: int
    duration_ms: int
    cost_micros: int
    currency: str
    usage_type: UsageRecordUsageType
    metadata: UsageRecordMetadata
    created_at: datetime.datetime
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)





    def to_dict(self) -> dict[str, Any]:
        from ..models.usage_record_metadata import UsageRecordMetadata
        id = self.id

        project_id = self.project_id

        agent_id: None | str
        agent_id = self.agent_id

        agent_version_id: None | str
        agent_version_id = self.agent_version_id

        session_id: None | str
        session_id = self.session_id

        session_event_id: None | str
        session_event_id = self.session_event_id

        correlation_id: None | str
        correlation_id = self.correlation_id

        provider_id: None | str
        provider_id = self.provider_id

        provider_type = self.provider_type.value

        model_id = self.model_id

        state = self.state.value

        prompt_tokens = self.prompt_tokens

        completion_tokens = self.completion_tokens

        total_tokens = self.total_tokens

        duration_ms = self.duration_ms

        cost_micros = self.cost_micros

        currency = self.currency

        usage_type = self.usage_type.value

        metadata = self.metadata.to_dict()

        created_at = self.created_at.isoformat()


        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({
            "id": id,
            "projectId": project_id,
            "agentId": agent_id,
            "agentVersionId": agent_version_id,
            "sessionId": session_id,
            "sessionEventId": session_event_id,
            "correlationId": correlation_id,
            "providerId": provider_id,
            "providerType": provider_type,
            "modelId": model_id,
            "state": state,
            "promptTokens": prompt_tokens,
            "completionTokens": completion_tokens,
            "totalTokens": total_tokens,
            "durationMs": duration_ms,
            "costMicros": cost_micros,
            "currency": currency,
            "usageType": usage_type,
            "metadata": metadata,
            "createdAt": created_at,
        })

        return field_dict



    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.usage_record_metadata import UsageRecordMetadata
        d = dict(src_dict)
        id = d.pop("id")

        project_id = d.pop("projectId")

        def _parse_agent_id(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        agent_id = _parse_agent_id(d.pop("agentId"))


        def _parse_agent_version_id(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        agent_version_id = _parse_agent_version_id(d.pop("agentVersionId"))


        def _parse_session_id(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        session_id = _parse_session_id(d.pop("sessionId"))


        def _parse_session_event_id(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        session_event_id = _parse_session_event_id(d.pop("sessionEventId"))


        def _parse_correlation_id(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        correlation_id = _parse_correlation_id(d.pop("correlationId"))


        def _parse_provider_id(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        provider_id = _parse_provider_id(d.pop("providerId"))


        provider_type = UsageRecordProviderType(d.pop("providerType"))




        model_id = d.pop("modelId")

        state = UsageRecordState(d.pop("state"))




        prompt_tokens = d.pop("promptTokens")

        completion_tokens = d.pop("completionTokens")

        total_tokens = d.pop("totalTokens")

        duration_ms = d.pop("durationMs")

        cost_micros = d.pop("costMicros")

        currency = d.pop("currency")

        usage_type = UsageRecordUsageType(d.pop("usageType"))




        metadata = UsageRecordMetadata.from_dict(d.pop("metadata"))




        created_at = datetime.datetime.fromisoformat(d.pop("createdAt"))




        usage_record = cls(
            id=id,
            project_id=project_id,
            agent_id=agent_id,
            agent_version_id=agent_version_id,
            session_id=session_id,
            session_event_id=session_event_id,
            correlation_id=correlation_id,
            provider_id=provider_id,
            provider_type=provider_type,
            model_id=model_id,
            state=state,
            prompt_tokens=prompt_tokens,
            completion_tokens=completion_tokens,
            total_tokens=total_tokens,
            duration_ms=duration_ms,
            cost_micros=cost_micros,
            currency=currency,
            usage_type=usage_type,
            metadata=metadata,
            created_at=created_at,
        )


        usage_record.additional_properties = d
        return usage_record

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
