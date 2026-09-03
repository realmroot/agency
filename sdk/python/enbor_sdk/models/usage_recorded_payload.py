from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from ..types import UNSET, Unset
from typing import cast

if TYPE_CHECKING:
  from ..models.usage_recorded_payload_details import UsageRecordedPayloadDetails





T = TypeVar("T", bound="UsageRecordedPayload")



@_attrs_define
class UsageRecordedPayload:
    """
        Attributes:
            model (str):
            prompt_tokens (float | Unset):
            completion_tokens (float | Unset):
            total_tokens (float | Unset):
            input_tokens (float | Unset):
            output_tokens (float | Unset):
            cached_input_tokens (float | Unset):
            cache_creation_input_tokens (float | Unset):
            reasoning_tokens (float | Unset):
            tool_tokens (float | Unset):
            cost_micros (float | Unset):
            details (UsageRecordedPayloadDetails | Unset):
     """

    model: str
    prompt_tokens: float | Unset = UNSET
    completion_tokens: float | Unset = UNSET
    total_tokens: float | Unset = UNSET
    input_tokens: float | Unset = UNSET
    output_tokens: float | Unset = UNSET
    cached_input_tokens: float | Unset = UNSET
    cache_creation_input_tokens: float | Unset = UNSET
    reasoning_tokens: float | Unset = UNSET
    tool_tokens: float | Unset = UNSET
    cost_micros: float | Unset = UNSET
    details: UsageRecordedPayloadDetails | Unset = UNSET





    def to_dict(self) -> dict[str, Any]:
        from ..models.usage_recorded_payload_details import UsageRecordedPayloadDetails
        model = self.model

        prompt_tokens = self.prompt_tokens

        completion_tokens = self.completion_tokens

        total_tokens = self.total_tokens

        input_tokens = self.input_tokens

        output_tokens = self.output_tokens

        cached_input_tokens = self.cached_input_tokens

        cache_creation_input_tokens = self.cache_creation_input_tokens

        reasoning_tokens = self.reasoning_tokens

        tool_tokens = self.tool_tokens

        cost_micros = self.cost_micros

        details: dict[str, Any] | Unset = UNSET
        if not isinstance(self.details, Unset):
            details = self.details.to_dict()


        field_dict: dict[str, Any] = {}

        field_dict.update({
            "model": model,
        })
        if prompt_tokens is not UNSET:
            field_dict["promptTokens"] = prompt_tokens
        if completion_tokens is not UNSET:
            field_dict["completionTokens"] = completion_tokens
        if total_tokens is not UNSET:
            field_dict["totalTokens"] = total_tokens
        if input_tokens is not UNSET:
            field_dict["inputTokens"] = input_tokens
        if output_tokens is not UNSET:
            field_dict["outputTokens"] = output_tokens
        if cached_input_tokens is not UNSET:
            field_dict["cachedInputTokens"] = cached_input_tokens
        if cache_creation_input_tokens is not UNSET:
            field_dict["cacheCreationInputTokens"] = cache_creation_input_tokens
        if reasoning_tokens is not UNSET:
            field_dict["reasoningTokens"] = reasoning_tokens
        if tool_tokens is not UNSET:
            field_dict["toolTokens"] = tool_tokens
        if cost_micros is not UNSET:
            field_dict["costMicros"] = cost_micros
        if details is not UNSET:
            field_dict["details"] = details

        return field_dict



    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.usage_recorded_payload_details import UsageRecordedPayloadDetails
        d = dict(src_dict)
        model = d.pop("model")

        prompt_tokens = d.pop("promptTokens", UNSET)

        completion_tokens = d.pop("completionTokens", UNSET)

        total_tokens = d.pop("totalTokens", UNSET)

        input_tokens = d.pop("inputTokens", UNSET)

        output_tokens = d.pop("outputTokens", UNSET)

        cached_input_tokens = d.pop("cachedInputTokens", UNSET)

        cache_creation_input_tokens = d.pop("cacheCreationInputTokens", UNSET)

        reasoning_tokens = d.pop("reasoningTokens", UNSET)

        tool_tokens = d.pop("toolTokens", UNSET)

        cost_micros = d.pop("costMicros", UNSET)

        _details = d.pop("details", UNSET)
        details: UsageRecordedPayloadDetails | Unset
        if isinstance(_details,  Unset):
            details = UNSET
        else:
            details = UsageRecordedPayloadDetails.from_dict(_details)




        usage_recorded_payload = cls(
            model=model,
            prompt_tokens=prompt_tokens,
            completion_tokens=completion_tokens,
            total_tokens=total_tokens,
            input_tokens=input_tokens,
            output_tokens=output_tokens,
            cached_input_tokens=cached_input_tokens,
            cache_creation_input_tokens=cache_creation_input_tokens,
            reasoning_tokens=reasoning_tokens,
            tool_tokens=tool_tokens,
            cost_micros=cost_micros,
            details=details,
        )

        return usage_recorded_payload
