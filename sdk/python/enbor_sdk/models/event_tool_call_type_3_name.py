from enum import Enum

class EventToolCallType3Name(str, Enum):
    EDIT = "edit"

    def __str__(self) -> str:
        return str(self.value)
