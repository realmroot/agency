from enum import Enum

class ToolCallContentBlockType(str, Enum):
    TOOL_CALL = "tool_call"

    def __str__(self) -> str:
        return str(self.value)
