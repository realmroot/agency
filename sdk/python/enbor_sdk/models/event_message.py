from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from ..models.event_message_role import EventMessageRole
from ..types import UNSET, Unset
from typing import cast

if TYPE_CHECKING:
  from ..models.file_content_block import FileContentBlock
  from ..models.image_content_block import ImageContentBlock
  from ..models.reasoning_content_block import ReasoningContentBlock
  from ..models.text_content_block import TextContentBlock
  from ..models.tool_call_content_block import ToolCallContentBlock
  from ..models.tool_result_content_block import ToolResultContentBlock





T = TypeVar("T", bound="EventMessage")



@_attrs_define
class EventMessage:
    """
        Attributes:
            id (str):
            role (EventMessageRole):
            content (list[FileContentBlock | ImageContentBlock | ReasoningContentBlock | TextContentBlock |
                ToolCallContentBlock | ToolResultContentBlock]):
            provider_message_id (str | Unset):
            parent_message_id (str | Unset):
            parent_tool_call_id (str | Unset):
            stop_reason (str | Unset):
     """

    id: str
    role: EventMessageRole
    content: list[FileContentBlock | ImageContentBlock | ReasoningContentBlock | TextContentBlock | ToolCallContentBlock | ToolResultContentBlock]
    provider_message_id: str | Unset = UNSET
    parent_message_id: str | Unset = UNSET
    parent_tool_call_id: str | Unset = UNSET
    stop_reason: str | Unset = UNSET





    def to_dict(self) -> dict[str, Any]:
        from ..models.file_content_block import FileContentBlock
        from ..models.image_content_block import ImageContentBlock
        from ..models.reasoning_content_block import ReasoningContentBlock
        from ..models.text_content_block import TextContentBlock
        from ..models.tool_call_content_block import ToolCallContentBlock
        from ..models.tool_result_content_block import ToolResultContentBlock
        id = self.id

        role = self.role.value

        content = []
        for content_item_data in self.content:
            content_item: dict[str, Any]
            if isinstance(content_item_data, TextContentBlock):
                content_item = content_item_data.to_dict()
            elif isinstance(content_item_data, ReasoningContentBlock):
                content_item = content_item_data.to_dict()
            elif isinstance(content_item_data, ToolCallContentBlock):
                content_item = content_item_data.to_dict()
            elif isinstance(content_item_data, ToolResultContentBlock):
                content_item = content_item_data.to_dict()
            elif isinstance(content_item_data, ImageContentBlock):
                content_item = content_item_data.to_dict()
            else:
                content_item = content_item_data.to_dict()

            content.append(content_item)



        provider_message_id = self.provider_message_id

        parent_message_id = self.parent_message_id

        parent_tool_call_id = self.parent_tool_call_id

        stop_reason = self.stop_reason


        field_dict: dict[str, Any] = {}

        field_dict.update({
            "id": id,
            "role": role,
            "content": content,
        })
        if provider_message_id is not UNSET:
            field_dict["providerMessageId"] = provider_message_id
        if parent_message_id is not UNSET:
            field_dict["parentMessageId"] = parent_message_id
        if parent_tool_call_id is not UNSET:
            field_dict["parentToolCallId"] = parent_tool_call_id
        if stop_reason is not UNSET:
            field_dict["stopReason"] = stop_reason

        return field_dict



    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.file_content_block import FileContentBlock
        from ..models.image_content_block import ImageContentBlock
        from ..models.reasoning_content_block import ReasoningContentBlock
        from ..models.text_content_block import TextContentBlock
        from ..models.tool_call_content_block import ToolCallContentBlock
        from ..models.tool_result_content_block import ToolResultContentBlock
        d = dict(src_dict)
        id = d.pop("id")

        role = EventMessageRole(d.pop("role"))




        content = []
        _content = d.pop("content")
        for content_item_data in (_content):
            def _parse_content_item(data: object) -> FileContentBlock | ImageContentBlock | ReasoningContentBlock | TextContentBlock | ToolCallContentBlock | ToolResultContentBlock:
                try:
                    if not isinstance(data, dict):
                        raise TypeError()
                    componentsschemas_message_content_block_type_0 = TextContentBlock.from_dict(data)



                    return componentsschemas_message_content_block_type_0
                except (TypeError, ValueError, AttributeError, KeyError):
                    pass
                try:
                    if not isinstance(data, dict):
                        raise TypeError()
                    componentsschemas_message_content_block_type_1 = ReasoningContentBlock.from_dict(data)



                    return componentsschemas_message_content_block_type_1
                except (TypeError, ValueError, AttributeError, KeyError):
                    pass
                try:
                    if not isinstance(data, dict):
                        raise TypeError()
                    componentsschemas_message_content_block_type_2 = ToolCallContentBlock.from_dict(data)



                    return componentsschemas_message_content_block_type_2
                except (TypeError, ValueError, AttributeError, KeyError):
                    pass
                try:
                    if not isinstance(data, dict):
                        raise TypeError()
                    componentsschemas_message_content_block_type_3 = ToolResultContentBlock.from_dict(data)



                    return componentsschemas_message_content_block_type_3
                except (TypeError, ValueError, AttributeError, KeyError):
                    pass
                try:
                    if not isinstance(data, dict):
                        raise TypeError()
                    componentsschemas_message_content_block_type_4 = ImageContentBlock.from_dict(data)



                    return componentsschemas_message_content_block_type_4
                except (TypeError, ValueError, AttributeError, KeyError):
                    pass
                if not isinstance(data, dict):
                    raise TypeError()
                componentsschemas_message_content_block_type_5 = FileContentBlock.from_dict(data)



                return componentsschemas_message_content_block_type_5

            content_item = _parse_content_item(content_item_data)

            content.append(content_item)


        provider_message_id = d.pop("providerMessageId", UNSET)

        parent_message_id = d.pop("parentMessageId", UNSET)

        parent_tool_call_id = d.pop("parentToolCallId", UNSET)

        stop_reason = d.pop("stopReason", UNSET)

        event_message = cls(
            id=id,
            role=role,
            content=content,
            provider_message_id=provider_message_id,
            parent_message_id=parent_message_id,
            parent_tool_call_id=parent_tool_call_id,
            stop_reason=stop_reason,
        )

        return event_message
