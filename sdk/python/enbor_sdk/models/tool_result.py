from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from ..types import UNSET, Unset
from typing import cast

if TYPE_CHECKING:
  from ..models.file_content_block import FileContentBlock
  from ..models.image_content_block import ImageContentBlock
  from ..models.json_content_block import JsonContentBlock
  from ..models.text_content_block import TextContentBlock
  from ..models.tool_result_structured_content import ToolResultStructuredContent





T = TypeVar("T", bound="ToolResult")



@_attrs_define
class ToolResult:
    """
        Attributes:
            content (list[FileContentBlock | ImageContentBlock | JsonContentBlock | TextContentBlock]):
            structured_content (ToolResultStructuredContent | Unset):
            exit_code (int | Unset):
     """

    content: list[FileContentBlock | ImageContentBlock | JsonContentBlock | TextContentBlock]
    structured_content: ToolResultStructuredContent | Unset = UNSET
    exit_code: int | Unset = UNSET





    def to_dict(self) -> dict[str, Any]:
        from ..models.file_content_block import FileContentBlock
        from ..models.image_content_block import ImageContentBlock
        from ..models.json_content_block import JsonContentBlock
        from ..models.text_content_block import TextContentBlock
        from ..models.tool_result_structured_content import ToolResultStructuredContent
        content = []
        for content_item_data in self.content:
            content_item: dict[str, Any]
            if isinstance(content_item_data, TextContentBlock):
                content_item = content_item_data.to_dict()
            elif isinstance(content_item_data, ImageContentBlock):
                content_item = content_item_data.to_dict()
            elif isinstance(content_item_data, FileContentBlock):
                content_item = content_item_data.to_dict()
            else:
                content_item = content_item_data.to_dict()

            content.append(content_item)



        structured_content: dict[str, Any] | Unset = UNSET
        if not isinstance(self.structured_content, Unset):
            structured_content = self.structured_content.to_dict()

        exit_code = self.exit_code


        field_dict: dict[str, Any] = {}

        field_dict.update({
            "content": content,
        })
        if structured_content is not UNSET:
            field_dict["structuredContent"] = structured_content
        if exit_code is not UNSET:
            field_dict["exitCode"] = exit_code

        return field_dict



    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.file_content_block import FileContentBlock
        from ..models.image_content_block import ImageContentBlock
        from ..models.json_content_block import JsonContentBlock
        from ..models.text_content_block import TextContentBlock
        from ..models.tool_result_structured_content import ToolResultStructuredContent
        d = dict(src_dict)
        content = []
        _content = d.pop("content")
        for content_item_data in (_content):
            def _parse_content_item(data: object) -> FileContentBlock | ImageContentBlock | JsonContentBlock | TextContentBlock:
                try:
                    if not isinstance(data, dict):
                        raise TypeError()
                    componentsschemas_tool_result_value_content_block_type_0 = TextContentBlock.from_dict(data)



                    return componentsschemas_tool_result_value_content_block_type_0
                except (TypeError, ValueError, AttributeError, KeyError):
                    pass
                try:
                    if not isinstance(data, dict):
                        raise TypeError()
                    componentsschemas_tool_result_value_content_block_type_1 = ImageContentBlock.from_dict(data)



                    return componentsschemas_tool_result_value_content_block_type_1
                except (TypeError, ValueError, AttributeError, KeyError):
                    pass
                try:
                    if not isinstance(data, dict):
                        raise TypeError()
                    componentsschemas_tool_result_value_content_block_type_2 = FileContentBlock.from_dict(data)



                    return componentsschemas_tool_result_value_content_block_type_2
                except (TypeError, ValueError, AttributeError, KeyError):
                    pass
                if not isinstance(data, dict):
                    raise TypeError()
                componentsschemas_tool_result_value_content_block_type_3 = JsonContentBlock.from_dict(data)



                return componentsschemas_tool_result_value_content_block_type_3

            content_item = _parse_content_item(content_item_data)

            content.append(content_item)


        _structured_content = d.pop("structuredContent", UNSET)
        structured_content: ToolResultStructuredContent | Unset
        if isinstance(_structured_content,  Unset):
            structured_content = UNSET
        else:
            structured_content = ToolResultStructuredContent.from_dict(_structured_content)




        exit_code = d.pop("exitCode", UNSET)

        tool_result = cls(
            content=content,
            structured_content=structured_content,
            exit_code=exit_code,
        )

        return tool_result
